import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"

import { loadConfig } from "../server/config.mjs"
import { createDesk } from "../server/index.mjs"
import { addPermissions, confirmKind } from "../server/permissions.mjs"
import { linksFrom, modelLabel, needsFromReply, Progress, ruleFor } from "../server/progress.mjs"

const FAKE = join(import.meta.dirname, "fake-claude.mjs")
const FAKE_CODEX = join(import.meta.dirname, "fake-codex.mjs")

describe("progress", () => {
  it("labels models", () => {
    assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5")
    assert.equal(modelLabel("claude-haiku-4-5-20251001"), "Haiku 4.5")
    assert.equal(modelLabel("other"), "other")
  })
  it("reads the to-do list from a reply", () => {
    assert.deepEqual(needsFromReply("Done.\n\n## What you need to do\n1. Sign in\n2. Approve\n   the PR\n\n## Notes\n- not this"), ["Sign in", "Approve the PR"])
    assert.deepEqual(needsFromReply("**What you need to do**\n- Nothing"), [])
    assert.deepEqual(needsFromReply("No section here.\n- item"), [])
  })
  it("collects links once", () => {
    assert.deepEqual(linksFrom("See https://a.com/x. And (https://a.com/x) https://b.org"), [
      { url: "https://a.com/x", label: "a.com/x" }, { url: "https://b.org", label: "b.org" }])
  })
  it("streams the draft and ignores subagent text", () => {
    const p = new Progress()
    p.feed(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }))
    p.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } }))
    p.feed(JSON.stringify({ type: "stream_event", parent_tool_use_id: "x", event: { type: "content_block_delta", delta: { type: "text_delta", text: "sub" } } }))
    p.feed("not json")
    assert.equal(p.out().draft, "Hi")
  })
  it("suggests a rule for a refused action", () => {
    assert.equal(ruleFor("Bash", { command: "npm test" }), "Bash(npm test)")
    assert.equal(ruleFor("Bash", { command: "echo $(whoami)" }), "")
    assert.equal(ruleFor("Bash", { command: "npm test 2>&1 | tail -5" }), "")
    assert.equal(ruleFor("mcp__linear__save_issue", {}), "mcp__linear__save_issue")
    assert.equal(ruleFor("Write", { file_path: "/x" }), "")
  })
  it("reads a Codex run: steps, reply, tokens, and a notice that is not a failure", () => {
    const p = new Progress()
    for (const e of [
      { type: "thread.started", thread_id: "abc" },
      { type: "item.completed", item: { id: "i0", type: "error", message: "only a notice" } },
      { type: "item.started", item: { id: "i1", type: "command_execution", command: "/bin/zsh -lc 'ls -la'" } },
      { type: "item.completed", item: { id: "i1", type: "command_execution", command: "/bin/zsh -lc 'ls -la'" } },
      { type: "item.completed", item: { id: "i2", type: "agent_message", text: "All done" } },
      { type: "turn.completed", usage: { input_tokens: 900, output_tokens: 100 } },
    ]) p.feed(JSON.stringify(e))
    const o = p.out()
    assert.equal(o.session, "abc")
    assert.deepEqual(o.steps, [{ tool: "Bash", detail: "'ls -la'" }, { say: "All done" }])
    assert.deepEqual([o.result.text, o.result.isError, o.usage.tokens, o.usage.outputTokens], ["All done", false, 1000, 100])
  })
})

describe("desk end to end with a fake claude", () => {
  let dir, server, base, desk
  const asked = [] // what the confirmation dialog was asked, and what "the person at the screen" answers
  let answer = true
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "desk-"))
    process.env.CODEX_HOME = join(dir, "codex-home") // the fake codex writes its session files here
    const config = loadConfig({ DESK_DATA: dir, DESK_CLAUDE: FAKE, DESK_WORKDIR: dir, DESK_MAX_PARALLEL: "2", DESK_PORT: "1",
      DESK_CODEX: FAKE_CODEX, CODEX_HOME: join(dir, "codex-home"), DESK_OPENAI_MODELS: "gpt-test=GPT Test", DESK_CLAUDE_HOME: join(dir, "claude-home") })
    const made = createDesk(config, { confirm: async (message) => { asked.push(message); return answer } })
    server = made.server
    desk = made.desk
    desk.recover()
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => { desk.stopAll(); server.close(); rmSync(dir, { recursive: true, force: true }) })

  const post = (path, body, headers = { "X-Desk": "1" }) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  const state = async () => (await fetch(`${base}/api/state`)).json()
  async function until(check, ms = 8000) {
    const end = Date.now() + ms
    for (;;) {
      const s = await state()
      if (check(s)) return s
      if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(s.requests.map((r) => r.status))}`)
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it("refuses writes without the X-Desk header", async () => {
    assert.equal((await post("/api/send", { text: "hi" }, {})).status, 403)
  })

  it("runs a message, resumes the session for a follow-up, and titles the conversation", async () => {
    const sent = await (await post("/api/send", { text: "first task", model: "opus" })).json()
    assert.equal(sent.ok, true)
    let s = await until((s) => s.requests.find((r) => r.id === sent.id)?.status === "done")
    let r = s.requests.find((x) => x.id === sent.id)
    assert.match(r.result, /Done \(new\): first task/)
    assert.equal(r.modelLabel, "Opus 5.5")
    assert.deepEqual(r.needs, ["Approve the PR", "Sign in to the dashboard"])
    assert.equal(r.links[0].url, "https://example.com/pr/1")
    assert.equal(r.tokens, 240)
    assert.equal(r.contextWindow, 200000)
    await until((s) => s.titles[sent.thread] === "Fake Title For Test")

    const d = await (await fetch(`${base}/api/request/${sent.id}`)).json()
    assert.equal(d.steps[0].tool, "Bash")
    assert.equal(d.steps[0].detail, "List files")

    const follow = await (await post("/api/send", { text: "second", model: "haiku", thread: sent.thread })).json()
    s = await until((s) => s.requests.find((r) => r.id === follow.id)?.status === "done")
    assert.match(s.requests.find((x) => x.id === follow.id).result, /Done \(resumed\): second/)

    assert.equal((await (await post("/api/needs-done", { id: sent.id })).json()).ok, true)
    s = await state()
    assert.equal(s.requests.find((x) => x.id === sent.id).needs, undefined)
  })

  it("reports failures, refusals and runs that end without a reply", async () => {
    const a = await (await post("/api/send", { text: "fail refuse" })).json()
    const b = await (await post("/api/send", { text: "die" })).json()
    const s = await until((s) => ["failed"].includes(s.requests.find((r) => r.id === a.id)?.status)
      && s.requests.find((r) => r.id === b.id)?.status === "failed")
    assert.equal(s.requests.find((r) => r.id === a.id).result, "It broke.")
    assert.match(s.requests.find((r) => r.id === b.id).result, /without a reply/)
    const d = await (await fetch(`${base}/api/request/${a.id}`)).json()
    assert.equal(d.refused[0].tool, "Bash")
  })

  it("queues a follow-up behind a running reply and stops on request", async () => {
    const a = await (await post("/api/send", { text: "sleep please" })).json()
    const b = await (await post("/api/send", { text: "after", thread: a.thread })).json()
    let s = await until((s) => s.requests.find((r) => r.id === a.id)?.lastStep?.tool === "Bash")
    assert.equal(s.requests.find((r) => r.id === b.id).status, "queued")
    assert.equal(s.requests.find((r) => r.id === a.id).lastStep.tool, "Bash")
    assert.equal((await (await post("/api/stop", { id: a.id })).json()).ok, true)
    s = await until((s) => s.requests.find((r) => r.id === a.id)?.status === "stopped"
      && s.requests.find((r) => r.id === b.id)?.status === "done")
  })

  it("offers OpenAI models, runs one through codex, and hands the conversation over on a switch", async () => {
    let s = await state()
    assert.equal(s.models["gpt-test"], "GPT Test")
    assert.deepEqual([s.providers.opus, s.providers["gpt-test"]], ["claude", "openai"])

    const a = await (await post("/api/send", { text: "alpha task", model: "sonnet" })).json()
    await until((s) => s.requests.find((r) => r.id === a.id)?.status === "done")
    const b = await (await post("/api/send", { text: "beta task", model: "gpt-test", thread: a.thread })).json()
    s = await until((s) => s.requests.find((r) => r.id === b.id)?.status === "done")
    let r = s.requests.find((x) => x.id === b.id)
    assert.equal(r.provider, "openai")
    assert.equal(r.modelLabel, "GPT Test")
    assert.deepEqual([r.tokens, r.outputTokens, r.contextTokens, r.contextWindow], [5050, 50, 2600, 260000])
    assert.equal(r.runCostUsd, undefined)
    const full = (await (await fetch(`${base}/api/request/${b.id}`)).json())
    assert.match(full.result, /^Codex new \[exec --json --skip-git-repo-check --model gpt-test -c sandbox_mode='workspace-write' -\]/)
    assert.match(full.result, /You are running inside Agent Desk/) // a new Codex session reads the desk's rules
    assert.match(full.result, /answered by another model[\s\S]*alpha task[\s\S]*Done \(new\): alpha task[\s\S]*new message:\nbeta task/)
    assert.equal(full.steps[0].tool, "Bash")

    // A second OpenAI message resumes the Codex session and repeats nothing.
    const c = await (await post("/api/send", { text: "gamma task", model: "gpt-test", thread: a.thread })).json()
    await until((s) => s.requests.find((r) => r.id === c.id)?.status === "done")
    const third = (await (await fetch(`${base}/api/request/${c.id}`)).json()).result
    assert.match(third, /^Codex resumed \[exec resume .* 0a1b2c3d-0000-7000-8000-00000000c0de -\] saw: gamma task$/)

    // Back on Claude: its own session resumes, and it is told what Codex did meanwhile.
    const d = await (await post("/api/send", { text: "delta task", model: "sonnet", thread: a.thread })).json()
    await until((s) => s.requests.find((r) => r.id === d.id)?.status === "done")
    const fourth = (await (await fetch(`${base}/api/request/${d.id}`)).json()).result
    assert.match(fourth, /^Done \(resumed\): Earlier in this conversation/)
    assert.match(fourth, /beta task[\s\S]*gamma task[\s\S]*new message:\ndelta task/)
    assert.match(fourth, /do not redo that work\.\n\nUser:\nbeta task/) // starts at what Claude has not seen, not at alpha

    const e = await (await post("/api/send", { text: "codexfail", model: "gpt-test" })).json()
    s = await until((s) => s.requests.find((r) => r.id === e.id)?.status === "failed")
    assert.equal(s.requests.find((r) => r.id === e.id).result, "The model refused.")
  })

  it("adds permission rules only after the on-screen confirmation, with a backup", async () => {
    const file = join(dir, ".claude", "settings.json")
    const userFile = join(dir, "claude-home", "settings.json")
    mkdirSync(join(dir, ".claude"), { recursive: true })
    writeFileSync(file, JSON.stringify({ env: { KEEP: "1" }, permissions: { allow: ["Bash(ls *)"] } }))
    const add = async (body) => (await post("/api/permissions", body)).json()

    assert.match((await add({ rules: ["not a rule!"], scope: "project" })).message, /does not look like a rule/)
    assert.match((await add({ rules: ["Bash(*)"], scope: "project" })).message, /switch the safety check off/)
    assert.equal(asked.length, 0) // nothing invalid reaches the dialog

    answer = false
    let res = await add({ rules: ["Bash(npm test *)"], scope: "project" })
    assert.equal(res.ok, false)
    assert.match(res.message, /not confirmed/)
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).permissions.allow, ["Bash(ls *)"])

    answer = true
    res = await add({ rules: ["Bash(npm test *)", "Bash(ls *)"], autoMode: ["Pushing to my own feature branches is approved."], scope: "project" })
    assert.equal(res.ok, true)
    assert.match(asked.at(-1), /Bash\(npm test \*\)/)
    assert.doesNotMatch(asked.at(-1), /Bash\(ls \*\)/) // already there, so not asked about again
    const saved = JSON.parse(readFileSync(file, "utf8"))
    assert.deepEqual(saved.permissions.allow, ["Bash(ls *)", "Bash(npm test *)"])
    assert.equal(saved.env.KEEP, "1")
    assert.deepEqual(JSON.parse(readFileSync(userFile, "utf8")).autoMode.allow, ["Pushing to my own feature branches is approved."])
    assert.equal(readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("settings.json.bak-desk-")).length, 1)

    const before = asked.length
    assert.match((await add({ rules: ["Bash(npm test *)"], scope: "project" })).message, /already there/)
    assert.equal(asked.length, before)
    // "This desk's runs only" is the default: kept in the desk's data folder and passed to every Claude run.
    const first = desk.store.requests[0]
    assert.equal(desk.args(first).includes("--settings"), false)
    assert.equal((await add({ rules: ["Bash(./scripts/check.sh)"] })).ok, true)
    const args = desk.args(first)
    assert.deepEqual(JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8")).permissions.allow, ["Bash(./scripts/check.sh)"])
    assert.match((await add({ rules: ["Read"], scope: "local" })).message, /trusted/)
    assert.equal((await post("/api/permissions", { rules: ["Edit"], scope: "local" }, {})).status, 403)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8")).permissions.allow, ["Read"])
  })

  it("renames and archives conversations", async () => {
    const s = await state()
    const thread = s.requests[0].thread
    assert.equal((await (await post("/api/title", { thread, title: "  My   title " })).json()).ok, true)
    assert.equal((await post("/api/archive", { thread })).status, 200)
    const after = await state()
    assert.equal(after.titles[thread], "My title")
    assert.ok(after.archived[thread])
  })
})

describe("permission confirmation", () => {
  it("is a dialog on macOS, needs zenity on Linux, and never writes when it cannot ask", async () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-perm-"))
    const config = { permissionConfirm: "dialog", claudeHome: join(dir, "home"), workdir: dir, data: join(dir, "data") }
    assert.equal(confirmKind(config, "darwin"), "dialog")
    assert.equal(confirmKind(config, "linux", () => false), "unavailable")
    assert.equal(confirmKind(config, "linux", () => true), "dialog")
    assert.equal(confirmKind({ ...config, permissionConfirm: "none" }, "linux", () => false), "none")
    const res = await addPermissions(config, { rules: ["Read"], scope: "user" }, { kindOfConfirm: "unavailable" })
    assert.equal(res.ok, false)
    assert.equal(existsSync(join(dir, "home", "settings.json")), false)
    const none = await addPermissions(config, { rules: ["Read"], kind: "deny", scope: "user" }, { kindOfConfirm: "none" })
    assert.equal(none.ok, true)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "home", "settings.json"), "utf8")).permissions.deny, ["Read"])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("config", () => {
  it("hides OpenAI models when the Codex CLI is missing or switched off", () => {
    assert.deepEqual(Object.keys(loadConfig({ DESK_CODEX: "/nonexistent/codex", DESK_OPENAI_MODELS: "gpt-x" }).models), ["opus", "sonnet", "haiku"])
    assert.deepEqual(Object.keys(loadConfig({ DESK_CODEX: FAKE_CODEX, DESK_OPENAI_MODELS: "off" }).models), ["opus", "sonnet", "haiku"])
    assert.equal(loadConfig({ DESK_CODEX: FAKE_CODEX, DESK_OPENAI_MODELS: "gpt-x=GPT X" }).models["gpt-x"].label, "GPT X")
  })
  it("refuses a reachable host without a token", () => {
    assert.throws(() => loadConfig({ DESK_HOST: "0.0.0.0" }), /DESK_TOKEN/)
  })
})

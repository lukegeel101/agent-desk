import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"

import { loadConfig } from "../server/config.mjs"
import { createDesk } from "../server/index.mjs"
import { linksFrom, modelLabel, needsFromReply, Progress } from "../server/progress.mjs"

const FAKE = join(import.meta.dirname, "fake-claude.mjs")

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
})

describe("desk end to end with a fake claude", () => {
  let dir, server, base, desk
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "desk-"))
    const config = loadConfig({ DESK_DATA: dir, DESK_CLAUDE: FAKE, DESK_WORKDIR: dir, DESK_MAX_PARALLEL: "2", DESK_PORT: "1" })
    const made = createDesk(config)
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

describe("config", () => {
  it("refuses a reachable host without a token", () => {
    assert.throws(() => loadConfig({ DESK_HOST: "0.0.0.0" }), /DESK_TOKEN/)
  })
})

// The runner: a queue of messages, each answered by one headless run: `claude -p` for a Claude model, `codex exec` for
// an OpenAI model. A conversation keeps one session per provider (Claude: --session-id, then --resume; Codex: its own
// thread id, then `exec resume`), so the agent remembers the thread. Switching provider mid-conversation hands the
// new one the messages it has not seen. Conversations answer one message at a time; up to maxParallel run at once.
import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, statSync } from "node:fs"

import { deskSettingsFile } from "./permissions.mjs"
import { codexContext, linksFrom, modelLabel, needsFromReply, readProgress, short } from "./progress.mjs"

const LIST_CUT = 600 // characters of each reply sent with the list; the page fetches the rest per message
const KILL_GRACE_MS = 5000
const TITLE_PROMPT = "Write a title of 3 to 7 words for the request below, as a to-do list would name it. Reply with the title only: no quotes, no punctuation at the end."

const HANDOVER_KEEP = 24000 // characters of earlier messages handed to a model that has not seen them

const now = () => new Date().toISOString()
const isActive = (r) => r.status === "queued" || r.status === "running"

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal) } catch { try { process.kill(pid, signal) } catch { /* already gone */ } }
}

// The child's environment: without CLAUDECODE, so a desk started from inside a Claude Code session can still run it.
function childEnv(extra) {
  const env = { ...process.env, ...extra }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  return env
}

export class Desk {
  constructor(config, store, { onChange } = {}) {
    this.config = config
    this.store = store
    this.models = config.models
    this.jobs = new Map() // request id -> { child, timer, timedOut }
    this.onChange = onChange || (() => {})
  }

  // A restart leaves nothing running: stop any run the previous process left behind and mark it interrupted.
  recover() {
    for (const r of this.store.requests) {
      if (r.status !== "running") continue
      if (alive(r.pid)) killGroup(r.pid, "SIGKILL")
      this.settle(r, { status: "failed", error: "Interrupted: the server restarted while this was running. Send it again to retry." })
    }
    this.pump()
  }

  send({ text, model, thread }) {
    const body = String(text || "").trim()
    if (!body) return { ok: false, message: "Type a message first." }
    if (body.length > 20000) return { ok: false, message: "That message is over 20,000 characters." }
    const pick = this.models[model] ? model : this.chosenModel()
    if (thread && !this.store.thread(thread).length) return { ok: false, message: "That conversation no longer exists." }
    const id = randomBytes(6).toString("hex")
    const threadId = thread || randomUUID()
    if (this.store.state.archived[threadId]) { delete this.store.state.archived[threadId] }
    this.store.add({ id, thread: threadId, text: body, model: pick, provider: this.models[pick].provider, at: now(), status: "queued" })
    this.pump()
    return { ok: true, id, thread: threadId }
  }

  stop(id) {
    const r = this.store.find(id)
    if (!r || !isActive(r)) return { ok: false, message: "That message is not queued or running." }
    if (r.status === "queued") {
      this.store.update(id, { status: "cancelled", finishedAt: now() })
      this.onChange()
      return { ok: true, message: "Cancelled." }
    }
    this.store.update(id, { stopRequested: true })
    const job = this.jobs.get(id)
    if (job) {
      killGroup(job.child.pid, "SIGTERM")
      setTimeout(() => { if (this.jobs.has(id)) killGroup(job.child.pid, "SIGKILL") }, KILL_GRACE_MS).unref()
    }
    return { ok: true, message: "Stopping." }
  }

  stopAll() {
    for (const [id, job] of this.jobs) { this.store.update(id, { stopRequested: true }); killGroup(job.child.pid, "SIGTERM") }
  }

  chosenModel() {
    const m = this.store.state.model || this.config.defaultModel
    return this.models[m] ? m : "sonnet"
  }

  setModel(model) {
    if (!this.models[model]) return { ok: false, message: "Unknown model." }
    this.store.state.model = model
    this.store.save()
    return { ok: true }
  }

  setTitle(thread, title) {
    const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 160)
    if (!this.store.thread(thread).length) return { ok: false, message: "That conversation no longer exists." }
    if (clean) this.store.state.titles[thread] = clean
    else delete this.store.state.titles[thread]
    this.store.save()
    return { ok: true, message: "Renamed." }
  }

  needsDone(id) {
    if (!this.store.find(id)) return { ok: false, message: "Unknown message." }
    this.store.state.needsDone[id] = now()
    this.store.save()
    return { ok: true, message: "Marked done." }
  }

  archive(thread, archived) {
    if (!this.store.thread(thread).length) return { ok: false, message: "That conversation no longer exists." }
    if (archived) this.store.state.archived[thread] = now()
    else delete this.store.state.archived[thread]
    this.store.save()
    return { ok: true, message: archived ? "Archived. A follow-up brings it back." : "Restored." }
  }

  // Start the oldest queued messages while slots are free, one per conversation.
  pump() {
    const busy = new Set(this.store.requests.filter((r) => r.status === "running").map((r) => r.thread))
    for (const r of this.store.requests) {
      if (this.jobs.size >= this.config.maxParallel) break
      if (r.status !== "queued" || busy.has(r.thread)) continue
      // A queued message waits behind any earlier message of its conversation that is still queued.
      busy.add(r.thread)
      this.start(r)
    }
    this.onChange()
  }

  providerOf(r) { return r.provider || this.models[r.model]?.provider || "claude" }

  // Earlier messages of the conversation that ran on this message's provider and left a session to resume.
  sameProvider(r) {
    const all = this.store.thread(r.thread)
    return all.slice(0, all.findIndex((x) => x.id === r.id)).filter((x) => x.session && this.providerOf(x) === this.providerOf(r))
  }

  // What the run is sent. After a switch of provider the new one has not seen what the other was asked and answered
  // since its own last turn, so those messages go first, newest kept when they are long.
  prompt(r) {
    const all = this.store.thread(r.thread)
    const earlier = all.slice(0, all.findIndex((x) => x.id === r.id))
    const mine = this.sameProvider(r)
    const from = mine.length ? earlier.findIndex((x) => x.id === mine[mine.length - 1].id) + 1 : 0
    const unseen = earlier.slice(from).filter((x) => x.result && (x.status === "done" || x.status === "stopped"))
    let text = r.text
    if (unseen.length) {
      let story = unseen.map((x) => `User:\n${x.text}\n\nReply (${x.modelLabel || x.model}):\n${x.result}`).join("\n\n---\n\n")
      if (story.length > HANDOVER_KEEP) story = `[earlier messages left out]\n${story.slice(-HANDOVER_KEEP)}`
      text = `Earlier in this conversation, answered by another model. Treat it as context you already know; do not redo that work.\n\n${story}\n\n---\n\nThe user's new message:\n${r.text}`
    }
    // Codex has no flag for extra instructions, so a new Codex session reads the desk's rules ahead of the message.
    if (this.providerOf(r) === "openai" && !mine.length) text = `${this.config.systemPrompt}\n\n---\n\n${text}`
    return text
  }

  // `codex exec` (or `codex exec resume <session>`): the permission mode picks the sandbox. acceptEdits may write in the
  // working folder and has no network; auto also sends anything beyond that to Codex's automatic approval review;
  // bypassPermissions removes the sandbox.
  codexArgs(r) {
    const mine = this.sameProvider(r)
    const session = mine.length ? mine[mine.length - 1].session : ""
    const mode = this.config.permissionMode
    const args = ["exec", ...(session ? ["resume"] : []), "--json", "--skip-git-repo-check", "--model", r.model]
    if (mode === "bypassPermissions") args.push("--dangerously-bypass-approvals-and-sandbox")
    else {
      args.push("-c", "sandbox_mode='workspace-write'")
      if (mode === "auto") args.push("-c", "approval_policy='on-request'", "-c", "approvals_reviewer='auto_review'")
    }
    if (this.config.effort) args.push("-c", `model_reasoning_effort='${this.config.effort}'`)
    return [...args, ...(session ? [session] : []), "-"]
  }

  args(r) {
    if (this.providerOf(r) === "openai") return this.codexArgs(r)
    const resume = this.sameProvider(r).length > 0
    const args = ["-p", "--model", r.model, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--permission-mode", this.config.permissionMode, "--append-system-prompt", this.config.systemPrompt]
    if (this.config.effort) args.push("--effort", this.config.effort)
    // Rules added from the page for "this desk's runs only" (permissions.mjs).
    if (existsSync(deskSettingsFile(this.config))) args.push("--settings", deskSettingsFile(this.config))
    args.push(...(resume ? ["--resume", r.thread] : ["--session-id", r.thread]), ...this.config.extraArgs)
    return args
  }

  start(r) {
    const out = openSync(this.store.runFile(r.id), "a")
    const err = openSync(this.store.errFile(r.id), "a")
    const binary = this.providerOf(r) === "openai" ? this.config.codex : this.config.claude
    let child
    try {
      child = spawn(binary, this.args(r), {
        cwd: this.config.workdir, detached: true, stdio: ["pipe", out, err],
        env: childEnv({ DESK_REQUEST_ID: r.id, DESK_THREAD_ID: r.thread }),
      })
    } catch (e) {
      closeSync(out); closeSync(err)
      this.settle(r, { status: "failed", error: `Could not start ${binary}: ${e.message}` })
      return
    }
    closeSync(out); closeSync(err) // the child holds its own copies
    const job = { child, timedOut: false }
    job.timer = setTimeout(() => {
      job.timedOut = true
      killGroup(child.pid, "SIGTERM")
      setTimeout(() => { if (this.jobs.has(r.id)) killGroup(child.pid, "SIGKILL") }, KILL_GRACE_MS).unref()
    }, this.config.timeoutSeconds * 1000)
    this.jobs.set(r.id, job)
    this.store.update(r.id, { status: "running", startedAt: now(), pid: child.pid })
    child.on("error", (e) => this.finish(r.id, null, `Could not start ${binary}: ${e.message}`))
    child.on("close", (code) => this.finish(r.id, code))
    child.stdin.on("error", () => {}) // a run that dies at once closes stdin under us
    child.stdin.end(this.prompt(r))
  }

  finish(id, code, startError) {
    const job = this.jobs.get(id)
    if (!job) return
    clearTimeout(job.timer)
    this.jobs.delete(id)
    const r = this.store.find(id)
    const p = readProgress(this.store.runFile(id))
    const res = p.result
    let status = "done"
    let error = startError || ""
    if (r.stopRequested) status = "stopped"
    else if (job.timedOut) { status = "failed"; error = `Stopped at the ${Math.round(this.config.timeoutSeconds / 60)}-minute time limit.` }
    else if (!res) { status = "failed"; error = error || `The run ended (exit ${code}) without a reply.` }
    else if (res.isError) status = "failed"
    this.settle(r, { status, error, exitCode: code, progress: p })
    this.pump()
  }

  settle(r, { status, error = "", exitCode = null, progress = null }) {
    const p = progress || readProgress(this.store.runFile(r.id))
    const res = p.result
    const text = res?.text || error || (status === "stopped" ? "Stopped before it finished." : "")
    const openai = this.providerOf(r) === "openai"
    const session = p.session || (openai ? undefined : r.session)
    // Codex events carry no model name, run time or context size: the label is the picker's, the time is measured here
    // and the context comes from the session file the Codex CLI keeps.
    const held = openai && session ? codexContext(this.config.codexHome, session) : null
    const patch = {
      status, finishedAt: now(), exitCode, result: text, pid: undefined,
      session, turns: res?.turns ?? undefined,
      durationMs: res?.durationMs ?? (openai && r.startedAt ? Date.now() - Date.parse(r.startedAt) : undefined),
      runCostUsd: res?.costUsd ?? undefined, tokens: p.usage.tokens || undefined, outputTokens: p.usage.outputTokens || undefined,
      contextTokens: held?.tokens || p.usage.contextTokens || undefined,
      contextWindow: held?.window || p.usage.contextWindow || this.models[r.model]?.window || undefined,
      modelLabel: (openai ? this.models[r.model]?.label || r.model : modelLabel(p.usage.modelId)) || undefined, browserCalls: p.usage.browserCalls || undefined,
      subagents: p.usage.subagents || undefined, refused: res?.refused?.length ? res.refused.slice(0, 20) : undefined,
      needs: status === "done" ? needsFromReply(text) : undefined, links: linksFrom(text),
    }
    this.store.update(r.id, patch)
    if (status === "done" && this.config.autoTitle && !this.store.state.titles[r.thread] && this.store.thread(r.thread)[0].id === r.id) {
      this.makeTitle(r)
    }
    this.onChange()
  }

  // A short title for a new conversation, from a quick no-tools Haiku call. The first words of the message stand in
  // until it answers, and stay if it fails.
  makeTitle(r) {
    const args = ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--no-session-persistence",
      "--output-format", "text", "--system-prompt", TITLE_PROMPT]
    let out = ""
    try {
      const child = spawn(this.config.claude, args, { cwd: this.config.workdir, stdio: ["pipe", "pipe", "ignore"], env: childEnv({}) })
      const timer = setTimeout(() => child.kill("SIGKILL"), 60000)
      child.stdout.on("data", (b) => { out += b })
      child.on("error", () => clearTimeout(timer))
      child.on("close", (code) => {
        clearTimeout(timer)
        const title = out.trim().split("\n")[0].replace(/^["'#*\s]+|["'.*\s]+$/g, "")
        if (code === 0 && title && title.length <= 80 && !this.store.state.titles[r.thread]) {
          this.store.state.titles[r.thread] = title
          this.store.save()
          this.onChange()
        }
      })
      child.stdin.on("error", () => {})
      child.stdin.end(short(r.text, 2000))
    } catch { /* keep the stand-in title */ }
  }

  // What the page polls: every message (newest first, replies cut), titles, open to-dos and settings.
  snapshot() {
    const s = this.store.state
    const live = {}
    const requests = [...s.requests].reverse().map((r) => {
      const row = { ...r, pid: undefined, session: undefined }
      if (r.status === "running") {
        const p = readProgress(this.store.runFile(r.id), 1)
        row.lastStep = p.steps[0] || null
        row.modelLabel = (this.providerOf(r) === "openai" ? this.models[r.model]?.label : modelLabel(p.usage.modelId)) || undefined
        row.contextTokens = p.usage.contextTokens || undefined
        live[r.id] = true
      }
      if (row.result && row.result.length > LIST_CUT) row.result = row.result.slice(0, LIST_CUT)
      if (s.needsDone[r.id]) row.needs = undefined
      return row
    })
    const labels = {}, providers = {}
    for (const [id, m] of Object.entries(this.models)) { labels[id] = m.label; providers[id] = m.provider }
    for (const r of s.requests) if (r.modelLabel && this.models[r.model]) labels[r.model] = r.modelLabel
    return {
      generatedAt: now(), requests, titles: s.titles, archived: s.archived, models: labels, providers,
      chosenModel: this.chosenModel(), timeoutSeconds: this.config.timeoutSeconds, maxParallel: this.config.maxParallel,
      workdir: this.config.workdir, permissionMode: this.config.permissionMode,
    }
  }

  detail(id) {
    const r = this.store.find(id)
    if (!r) return null
    const p = readProgress(this.store.runFile(id), 300)
    let stderr = ""
    try {
      const file = this.store.errFile(id)
      const size = statSync(file).size
      stderr = readFileSync(file, "utf8").slice(Math.max(0, size - 8000))
    } catch { /* no error output */ }
    return {
      ...r, pid: undefined, session: undefined, needs: this.store.state.needsDone[id] ? undefined : r.needs,
      steps: p.steps, stepCount: p.stepCount, draft: p.draft, stderr,
    }
  }
}

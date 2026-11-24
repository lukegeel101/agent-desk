// Parses one run's events into what the page shows: the steps taken, the reply being written, the final result and
// token usage. Claude runs print `claude -p --output-format stream-json` events, OpenAI runs `codex exec --json` events. Files are read incrementally, so polling a running reply
// every second only parses the lines added since the last read.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs"
import { join } from "node:path"

const DRAFT_KEEP = 30000 // characters of the reply being written that the page is sent
const STREAM_PREFIX = '{"type":"stream_event"'

export function short(value, limit = 160) {
  const text = String(value ?? "").split(/\s+/).filter(Boolean).join(" ")
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

// One readable line for a tool call: what it is doing, never the full payload.
export function toolDetail(input) {
  const data = input && typeof input === "object" ? input : {}
  for (const key of ["description", "file_path", "path", "pattern", "query", "url", "skill", "prompt", "command"]) {
    if (data[key]) return short(data[key])
  }
  return ""
}

// "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5"; anything else is returned as given.
export function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(String(id || ""))
  if (!m) return String(id || "")
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`
}

const CODEX_EVENTS = new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "error"])

// The permission rule that would allow a refused action, offered on the page as a starting point for "Add permission":
// the exact shell command for a plain Bash call, the tool's name for an MCP or web tool. File edits get none (the mode covers them).
export function ruleFor(tool, input) {
  const name = String(tool || "")
  if (name === "Bash") {
    const command = String(input?.command || "").trim()
    // Only a single plain command: a pipe, chain, redirect or substitution would not match one allow rule anyway.
    return command && command.length <= 200 && !/[\n()|;&<>`$]/.test(command) ? `Bash(${command})` : ""
  }
  return /^(mcp__[A-Za-z0-9_.-]+|WebFetch|WebSearch)$/.test(name) ? name : ""
}

const sumTokens = (u) => ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]
  .reduce((a, k) => a + (Number(u?.[k]) || 0), 0)

export class Progress {
  constructor() {
    this.steps = []
    this.result = null
    this.session = null
    this.draft = ""
    this.modelId = null
    this.contextTokens = null
    this.contextWindow = null
    this.browserCalls = 0
    this.subagents = 0
    this.messages = new Map() // message id -> [tokens held, output tokens]; a message streams as several events
    this.final = null
    this.codex = null // set by the first Codex event: { said, error, done, items, tokens, output }
  }

  feed(line) {
    // Thinking, signature and tool-input deltas carry nothing the page shows; skip them without decoding.
    if (line.startsWith(STREAM_PREFIX) && !line.includes('"text_delta"') && !line.includes('"message_start"')
      && !line.includes('"content_block_start"')) return
    let event
    try { event = JSON.parse(line) } catch { return }
    if (!event || typeof event !== "object") return
    const kind = event.type
    if (CODEX_EVENTS.has(kind)) return this.feedCodex(kind, event)
    this.session = event.session_id || this.session
    if (kind === "stream_event") {
      if (!event.parent_tool_use_id) this.stream(event.event || {})
      return
    }
    if (kind === "system" && event.subtype === "init") this.modelId = event.model || this.modelId
    if (kind === "assistant") {
      const message = event.message || {}
      if (!event.parent_tool_use_id) {
        const held = sumTokens(message.usage)
        if (held) {
          this.contextTokens = held
          this.messages.set(message.id, [held, Number(message.usage?.output_tokens) || 0])
        }
        this.modelId = message.model || this.modelId
        for (const item of message.content || []) {
          const name = item?.type === "tool_use" ? String(item.name || "") : ""
          if (name.startsWith("mcp__claude-in-chrome__") || name.startsWith("mcp__computer-use__")) this.browserCalls++
          else if (name === "Agent" || name === "Task") this.subagents++
        }
      }
      for (const item of message.content || []) {
        if (!item || typeof item !== "object") continue
        if (item.type === "tool_use") this.steps.push({ tool: item.name || "tool", detail: toolDetail(item.input) })
        else if (item.type === "text" && String(item.text || "").trim()) this.steps.push({ say: short(item.text, 400) })
      }
    } else if (kind === "result") {
      this.result = {
        text: event.result || "",
        isError: !!event.is_error,
        subtype: event.subtype,
        turns: event.num_turns ?? null,
        durationMs: event.duration_ms ?? null,
        costUsd: event.total_cost_usd ?? null,
        refused: (event.permission_denials || []).map((d) => ({ tool: d.tool_name || "tool", what: toolDetail(d.tool_input), rule: ruleFor(d.tool_name, d.tool_input) })),
      }
      const windows = event.modelUsage || {}
      const main = windows[this.modelId] || Object.values(windows)[0]
      this.contextWindow = main?.contextWindow || this.contextWindow
      // This run's own totals (modelUsage is cumulative for the session).
      if (event.usage) this.final = [sumTokens(event.usage), Number(event.usage.output_tokens) || 0]
    }
  }

  // One `codex exec --json` event. Codex reports tokens but no dollar cost, turn count or refused actions; the sandbox
  // and its own approval policy decide what a Codex run may do.
  feedCodex(kind, event) {
    const c = this.codex ||= { said: "", error: "", done: "", items: new Set(), tokens: 0, output: 0 }
    const item = event.item && typeof event.item === "object" ? event.item : {}
    if (kind === "thread.started") this.session = event.thread_id || this.session
    else if (kind === "item.started" || kind === "item.completed") {
      if (item.type === "agent_message") {
        if (kind === "item.completed" && String(item.text || "").trim()) {
          c.said = item.text
          this.draft = item.text
          this.steps.push({ say: short(item.text, 400) })
        }
      } else if (["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(item.type) && !c.items.has(item.id)) {
        c.items.add(item.id) // one step per call, shown as soon as it starts
        if (item.type === "command_execution") this.steps.push({ tool: "Bash", detail: short(String(item.command || "").replace(/^\S*sh -lc /, "")) })
        else if (item.type === "mcp_tool_call") this.steps.push({ tool: `mcp__${item.server || "server"}__${item.tool || "tool"}`, detail: toolDetail(item.arguments) })
        else if (item.type === "web_search") this.steps.push({ tool: "WebSearch", detail: short(item.query) })
        else this.steps.push({ tool: "Edit", detail: short((item.changes || []).map((x) => x?.path || "").filter(Boolean).join(", ")) })
      }
    } else if (kind === "turn.completed") {
      const u = event.usage || {}
      const held = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0) // input_tokens already includes cached
      c.tokens += held
      c.output += Number(u.output_tokens) || 0
      c.done = "completed"
    } else if (kind === "turn.failed" || kind === "error") {
      const err = event.error && typeof event.error === "object" ? event.error : {}
      c.error = String(err.message || event.message || "Codex reported an error")
      if (kind === "turn.failed") c.done = "failed"
    }
    if (c.done) {
      const failed = c.done === "failed"
      this.result = { text: (failed ? c.error : c.said) || "", isError: failed, subtype: failed ? "error" : "success", turns: null, durationMs: null, costUsd: null, refused: [] }
      this.final = [c.tokens, c.output]
    }
  }

  // The main agent's message being written: its text so far (a new model call starts it over).
  stream(inner) {
    if (inner.type === "message_start") this.draft = ""
    else if (inner.type === "content_block_start" && inner.content_block?.type === "text" && this.draft) this.draft += "\n\n"
    else if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") this.draft += inner.delta.text || ""
  }

  out(limit) {
    let tokens = 0, outputTokens = 0
    if (this.final) [tokens, outputTokens] = this.final
    else for (const [h, o] of this.messages.values()) { tokens += h; outputTokens += o }
    return {
      steps: limit ? this.steps.slice(-limit) : [...this.steps],
      stepCount: this.steps.length,
      result: this.result,
      session: this.session,
      draft: this.result ? "" : this.draft.slice(-DRAFT_KEEP),
      usage: {
        modelId: this.modelId, contextTokens: this.contextTokens, contextWindow: this.contextWindow,
        tokens, outputTokens, browserCalls: this.browserCalls, subagents: this.subagents,
      },
    }
  }
}

// path -> { offset, carry, progress }; the parsed state of recent runs is kept so each read parses only new lines.
const CACHE = new Map()
const CACHE_SIZE = 64

export function readProgress(path, limit = null) {
  let entry = CACHE.get(path)
  let size
  try { size = statSync(path).size } catch { return new Progress().out(limit) }
  if (!entry || size < entry.offset) entry = { offset: 0, carry: "", progress: new Progress() }
  if (size > entry.offset) {
    const fd = openSync(path, "r")
    try {
      const buf = Buffer.alloc(size - entry.offset)
      readSync(fd, buf, 0, buf.length, entry.offset)
      entry.offset = size
      const lines = (entry.carry + buf.toString("utf8")).split("\n")
      entry.carry = lines.pop() // a line still being written
      for (const line of lines) if (line.trim()) entry.progress.feed(line)
    } finally { closeSync(fd) }
  }
  CACHE.delete(path)
  CACHE.set(path, entry)
  if (CACHE.size > CACHE_SIZE) CACHE.delete(CACHE.keys().next().value)
  return entry.progress.out(limit)
}

// "What you need to do" items from a finished reply: the list under a heading or bold line that says so.
const NEEDS_HEADING = /^\s*(?:#{1,6}\s*|\*\*)\s*(what you need to do|needs you|action items for you|your next steps)\b/i

export function needsFromReply(text) {
  const lines = String(text || "").split("\n")
  const at = lines.findIndex((l) => NEEDS_HEADING.test(l))
  if (at < 0) return []
  const items = []
  for (const line of lines.slice(at + 1)) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*\s*$/.test(line)) break
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line)
    if (m) items.push(m[1])
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`
  }
  return items.filter((i) => !/^(nothing|none)\b/i.test(i))
}

// Every link a reply mentions, each once, labelled by host and path.
export function linksFrom(text) {
  const seen = new Set()
  const out = []
  for (const m of String(text || "").matchAll(/https?:\/\/[^\s)<>\]"'`]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "")
    if (seen.has(url)) continue
    seen.add(url)
    let label = url
    try { const u = new URL(url); label = `${u.host}${u.pathname === "/" ? "" : u.pathname}` } catch { /* keep the raw text */ }
    out.push({ url, label: short(label, 80) })
  }
  return out
}

// How full a Codex session's context is: the newest token count in the session file the Codex CLI keeps under
// <CODEX_HOME>/sessions (its JSON events only give a turn's total across every model call). Null when it is not found.
export function codexContext(codexHome, session, finishedAt = new Date()) {
  if (!/^[0-9a-f-]{16,64}$/i.test(String(session || ""))) return null
  const day = (d) => [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")]
  const walk = (dir, depth) => {
    let names = []
    try { names = readdirSync(dir) } catch { return null }
    for (const name of names.sort().reverse()) {
      const path = join(dir, name)
      if (depth === 0) { if (name.endsWith(`${session}.jsonl`)) return path } else { const hit = walk(path, depth - 1); if (hit) return hit }
    }
    return null
  }
  const root = join(codexHome, "sessions")
  // A resumed session keeps the file of the day it started on; today's and yesterday's folders first, then all of them.
  const file = walk(join(root, ...day(finishedAt)), 0) || walk(join(root, ...day(new Date(finishedAt.getTime() - 86400000))), 0) || walk(root, 3)
  if (!file) return null
  let text = ""
  try { text = readFileSync(file, "utf8") } catch { return null }
  const at = text.lastIndexOf('"type":"token_count"')
  if (at < 0) return null
  try {
    const info = JSON.parse(text.slice(text.lastIndexOf("\n", at) + 1, (text.indexOf("\n", at) + 1 || text.length + 1) - 1)).payload.info
    const tokens = Number(info.last_token_usage?.total_tokens) || 0
    return tokens ? { tokens, window: Number(info.model_context_window) || null } : null
  } catch { return null }
}

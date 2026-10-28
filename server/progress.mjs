// Parses one run's `claude -p --output-format stream-json` events into what the page shows: the steps taken, the
// reply being written, the final result and token usage. Files are read incrementally, so polling a running reply
// every second only parses the lines added since the last read.
import { closeSync, openSync, readSync, statSync } from "node:fs"

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
  }

  feed(line) {
    // Thinking, signature and tool-input deltas carry nothing the page shows; skip them without decoding.
    if (line.startsWith(STREAM_PREFIX) && !line.includes('"text_delta"') && !line.includes('"message_start"')
      && !line.includes('"content_block_start"')) return
    let event
    try { event = JSON.parse(line) } catch { return }
    if (!event || typeof event !== "object") return
    this.session = event.session_id || this.session
    const kind = event.type
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
        refused: (event.permission_denials || []).map((d) => ({ tool: d.tool_name || "tool", what: toolDetail(d.tool_input) })),
      }
      const windows = event.modelUsage || {}
      const main = windows[this.modelId] || Object.values(windows)[0]
      this.contextWindow = main?.contextWindow || this.contextWindow
      // This run's own totals (modelUsage is cumulative for the session).
      if (event.usage) this.final = [sumTokens(event.usage), Number(event.usage.output_tokens) || 0]
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

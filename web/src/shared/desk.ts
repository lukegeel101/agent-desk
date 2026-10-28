// Data layer: polls the server's /api/state, groups messages into conversations, and loads full replies and live
// steps per message from /api/request/<id>. Writes live in actions.ts.
import DOMPurify from "dompurify"
import { marked } from "marked"
import { useEffect, useMemo, useRef, useState } from "react"

export type Status = "queued" | "running" | "done" | "failed" | "stopped" | "cancelled"

export interface Step { tool?: string; detail?: string; say?: string }
export interface Link { url: string; label: string }

export interface Request {
  id: string
  thread: string
  text: string
  model: string
  modelLabel?: string
  at: string
  startedAt?: string
  finishedAt?: string
  status: Status
  result?: string
  exitCode?: number | null
  durationMs?: number
  turns?: number
  tokens?: number
  outputTokens?: number
  contextTokens?: number
  contextWindow?: number
  runCostUsd?: number
  browserCalls?: number
  subagents?: number
  refused?: { tool: string; what?: string }[]
  needs?: string[]
  links?: Link[]
  lastStep?: Step | null
  stopRequested?: boolean
}

export interface Detail extends Request { steps?: Step[]; stepCount?: number; draft?: string; stderr?: string }

export interface State {
  generatedAt: string
  requests: Request[] // newest first
  titles: Record<string, string>
  archived: Record<string, string>
  models: Record<string, string> // alias -> label, e.g. opus -> "Opus 5.5"
  chosenModel: string
  timeoutSeconds: number
  maxParallel: number
  workdir: string
  permissionMode: string
}

export interface Usage { tokens: number; output: number; cost: number; ms: number; model: string; ctx: number; window: number; pct: number | null }

export interface Thread {
  id: string
  title: string
  items: Request[] // oldest first
  first: Request
  last: Request
  chip: Request // the running reply, else the newest message
  active: boolean
  archived: boolean
  needs: { id: string; items: string[] } | null
  refused: number
  usage: Usage
  when: string
}

const ACTIVE = new Set<Status>(["queued", "running"])
export const isActive = (r: Request) => ACTIVE.has(r.status)

export function threadUsage(items: Request[]): Usage {
  const u: Usage = { tokens: 0, output: 0, cost: 0, ms: 0, model: "", ctx: 0, window: 0, pct: null }
  for (const r of items) { u.tokens += r.tokens || 0; u.output += r.outputTokens || 0; u.cost += r.runCostUsd || 0; u.ms += r.durationMs || 0 }
  const rev = [...items].reverse()
  u.model = rev.find((r) => r.modelLabel)?.modelLabel || ""
  const withCtx = rev.find((r) => r.contextTokens)
  if (withCtx) { u.ctx = withCtx.contextTokens || 0; u.window = rev.find((r) => r.contextWindow)?.contextWindow || 0 }
  u.pct = u.ctx && u.window ? Math.round((100 * u.ctx) / u.window) : null
  return u
}

// Conversations newest first, messages oldest first inside one.
export function group(state: State): Thread[] {
  const map = new Map<string, Request[]>()
  for (const r of [...state.requests].reverse()) {
    if (!map.has(r.thread)) map.set(r.thread, [])
    map.get(r.thread)!.push(r)
  }
  return [...map.entries()].map(([id, items]) => {
    const last = items[items.length - 1]
    const chip = items.find((r) => r.status === "running") || last
    const finished = [...items].reverse().find((r) => r.status === "done" || r.status === "failed")
    const needs = finished?.needs?.length ? { id: finished.id, items: finished.needs } : null
    return {
      id, items, first: items[0], last, chip, needs,
      title: state.titles[id] || items[0].text,
      active: items.some(isActive),
      archived: !!state.archived[id],
      refused: finished?.refused?.length || 0,
      usage: threadUsage(items),
      when: last.finishedAt || last.startedAt || last.at,
    }
  }).sort((a, b) => String(b.when).localeCompare(String(a.when)))
}

export function statusLabel(r: Request): string {
  return ({ queued: "queued", running: "working", done: "done", failed: "failed", stopped: "stopped", cancelled: "cancelled" } as Record<string, string>)[r.status] || r.status
}

export const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0)

export function ago(iso?: string, now = Date.now()): string {
  if (!iso) return ""
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const local = (iso?: string) => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""

export function duration(ms?: number): string {
  if (!ms) return ""
  return ms >= 120000 ? `${Math.round(ms / 60000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`
}

// Replies are Markdown written by the agent; render and sanitise them. Finished replies never change, so the HTML is
// cached by text and a poll does not re-parse every visible reply.
const MD_CACHE = new Map<string, string>()
function cached(key: string, make: () => string): string {
  let html = MD_CACHE.get(key)
  if (html === undefined) {
    html = make()
    if (MD_CACHE.size > 600) MD_CACHE.delete(MD_CACHE.keys().next().value as string)
    MD_CACHE.set(key, html)
  }
  return html
}

export function markdownHtml(text: string): string {
  return cached(`b:${text || ""}`, () =>
    DOMPurify.sanitize(marked.parse(text || "", { async: false, gfm: true, breaks: false }) as string, { ADD_ATTR: ["target"] }))
}

export function inlineMarkdownHtml(text: string): string {
  return cached(`i:${text || ""}`, () => DOMPurify.sanitize(marked.parseInline(text || "", { async: false, gfm: true }) as string))
}

// Keep the previous object for every message that did not change, so components (and React.memo) skip their work.
function sameJson(a: unknown, b: unknown) { return a === b || JSON.stringify(a) === JSON.stringify(b) }

function shareRequests(prev: State | null, next: State): State {
  if (!prev) return next
  const old = new Map(prev.requests.map((r) => [r.id, r]))
  return { ...next, requests: next.requests.map((r) => { const o = old.get(r.id); return o && sameJson(o, r) ? o : r }) }
}

function shareThreads(prev: Thread[], next: Thread[]): Thread[] {
  const old = new Map(prev.map((t) => [t.id, t]))
  return next.map((t) => {
    const o = old.get(t.id)
    if (!o || o.title !== t.title || o.archived !== t.archived || o.items.length !== t.items.length || o.items.some((r, i) => r !== t.items[i])) return t
    return o
  })
}

// Polls every second while anything is queued or running, else every 10 s, and at once after an action
// (the "desk-refresh" event from actions.ts). A hidden tab polls every 10 s.
export function useDesk() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let busy = true
    const tick = async () => {
      clearTimeout(timer)
      try {
        const res = await fetch("/api/state", { cache: "no-store" })
        if (!res.ok) throw new Error(`the server answered ${res.status}`)
        const body = (await res.json()) as State
        busy = body.requests.some(isActive)
        if (!stop) { setState((prev) => shareRequests(prev, body)); setError(null) }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e))
      }
      if (!stop) timer = setTimeout(tick, document.hidden || !busy ? 10000 : 1000)
    }
    const now = () => { if (!stop) void tick() }
    void tick()
    window.addEventListener("desk-refresh", now)
    document.addEventListener("visibilitychange", now)
    return () => { stop = true; clearTimeout(timer); window.removeEventListener("desk-refresh", now); document.removeEventListener("visibilitychange", now) }
  }, [])
  const last = useRef<Thread[]>([])
  const threads = useMemo(() => {
    const next = state ? shareThreads(last.current, group(state)) : []
    last.current = next
    return next
  }, [state])
  return { state, threads, error }
}

// Full detail (steps, live draft) for a conversation's newest `recent` messages and any still running; running ones
// refresh every second. Older messages fall back to their list row.
export function useDetails(thread: Thread | undefined, recent = 40) {
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const cache = useRef<Record<string, Detail>>({})
  const threadRef = useRef(thread)
  threadRef.current = thread
  // Restart only when a message is added or changes status, not on every poll, so slow fetches are not dropped.
  const sig = thread ? `${thread.id}|${thread.items.slice(-recent).map((r) => `${r.id}:${r.status}`).join(",")}` : ""
  useEffect(() => {
    const t = threadRef.current
    if (!t) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const now = threadRef.current || t
      const wanted = now.items.filter((r, i) => i >= now.items.length - recent || isActive(r))
      await Promise.all(wanted.map(async (r) => {
        const had = cache.current[r.id]
        if (had && had.status === r.status && !isActive(r) && sameJson(had.needs, r.needs)) return
        try {
          const d = (await (await fetch(`/api/request/${r.id}`, { cache: "no-store" })).json()) as Detail
          cache.current[r.id] = d
          if (alive) setDetails((prev) => ({ ...prev, [r.id]: d }))
        } catch { /* keep the list row; the next load tries again */ }
      }))
      if (alive && (threadRef.current || t).items.some((r) => r.status === "running")) timer = setTimeout(load, 1000)
    }
    setDetails({ ...cache.current })
    void load()
    return () => { alive = false; clearTimeout(timer) }
  }, [sig, recent])
  return details
}

export type Filter = "all" | "active" | "needs" | "archived"
export function filterThreads(threads: Thread[], filter: Filter): Thread[] {
  if (filter === "archived") return threads.filter((t) => t.archived)
  const open = threads.filter((t) => !t.archived)
  if (filter === "active") return open.filter((t) => t.active)
  if (filter === "needs") return open.filter((t) => !!t.needs)
  return open
}

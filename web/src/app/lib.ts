// Helpers for the page. Pure functions only (no components), so the component files stay Fast Refresh friendly.
import { statusLabel, type Link, type Request, type Thread } from "@/shared/desk"

export type Tone = "sky" | "amber" | "pink" | "violet" | "neutral" | "green" | "red"

// Colour of a status label: "working" reads blue, "done" green, "failed" red.
export function statusTone(r: Request): { tone: Tone; live: boolean } {
  switch (statusLabel(r)) {
    case "working": return { tone: "sky", live: true }
    case "done": return { tone: "green", live: false }
    case "failed": case "stopped": return { tone: "red", live: false }
    default: return { tone: "neutral", live: false }
  }
}

export const ctxTone = (pct: number | null) => (pct ?? 0) >= 90 ? "text-red-600 dark:text-red-400 font-semibold" : (pct ?? 0) >= 70 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
export const ctxBar = (pct: number | null) => (pct ?? 0) >= 90 ? "bg-red-500" : (pct ?? 0) >= 70 ? "bg-amber-500" : "bg-sky-500"

// "mcp__claude-in-chrome__navigate" reads better as "claude-in-chrome / navigate".
export function shortTool(tool: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1].replace(/^claude_ai_/, "")} / ${m[2]}` : tool
}

export function stepText(s?: { tool?: string; detail?: string; say?: string } | null): string {
  if (!s) return "Starting up..."
  return s.tool ? `${shortTool(s.tool)}${s.detail ? `: ${s.detail}` : ""}` : s.say || "Thinking..."
}

// Why a queued message has not started: the earlier reply it waits for, else a free run slot.
export function queuedWhy(t: Thread, r: Request, slots: number): string {
  const before = t.items.slice(0, t.items.findIndex((x) => x.id === r.id))
  if (before.some((x) => x.status === "running" || x.status === "queued")) return "Starts when the reply above finishes; a conversation answers one message at a time."
  return `Waiting its turn; it starts when one of the ${slots} run slots frees up.`
}

export function runTime(ms: number): string {
  const mins = Math.round(ms / 60000)
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.max(1, mins)} min`
}

export function sumOf(t: Thread, key: "turns" | "browserCalls" | "subagents") {
  return t.items.reduce((a, r) => a + (r[key] || 0), 0)
}

const HINTS: Record<string, string> = { opus: "deepest", sonnet: "balanced", haiku: "quick" }
export function modelOptions(models: Record<string, string>) {
  return [{ label: "Claude", options: Object.entries(models).map(([value, label]) => ({ value, label: `${label}${HINTS[value] ? ` (${HINTS[value]})` : ""}` })) }]
}
export const modelName = (models: Record<string, string>, key: string) => models[key] || key

// The newest reply that ran on a model, for "your next message uses another model".
export const lastModelRun = (t: Thread) => [...t.items].reverse().find((r) => r.finishedAt && r.model)

export const IDEAS = [
  "Summarise what changed in my projects' git history this week, with links.",
  "Find every TODO in this folder and group them by how urgent they look.",
  "Review the open pull request on my main repo and list anything risky.",
  "Draft a short status update from my last few days of commits.",
]

// Every link the replies mentioned, newest first, each once.
export function allLinks(t: Thread): Link[] {
  const seen = new Set<string>()
  const out: Link[] = []
  for (const r of [...t.items].reverse()) for (const l of r.links || []) if (!seen.has(l.url)) { seen.add(l.url); out.push(l) }
  return out
}

// Small shared pieces built on the UI kit in ./ui.
import { useMemo } from "react"
import { MessageSquare, Sparkles, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { markdownHtml, statusLabel, type Request, type Thread } from "@/shared/desk"
import { ctxBar, statusTone } from "./lib"
import Avatar9 from "./ui/avatar-9"
import Badge12 from "./ui/badge-12"
import Badge13 from "./ui/badge-13"
import Badge15 from "./ui/badge-15"

// One status pill for every message: green for done, red for failed, tints for the rest.
export function StatusBadge({ r, className }: { r: Request; className?: string }) {
  const label = statusLabel(r)
  const { tone, live } = statusTone(r)
  if (tone === "green") return <Badge15>{label}</Badge15>
  if (tone === "red") return <Badge13>{label}</Badge13>
  return <Badge12 tone={tone} live={live} className={className}>{label}</Badge12>
}

// Agent replies are Markdown; render once per text change.
export function Markdown({ text, draft = false, className }: { text: string; draft?: boolean; className?: string }) {
  const html = useMemo(() => markdownHtml(text), [text])
  return <div className={cn("wm-md", draft && "wm-draft", className)} dangerouslySetInnerHTML={{ __html: html }} />
}

// The conversation's mark in the list, with a dot when it is working or queued.
export function ThreadMark({ t }: { t: Thread }) {
  const running = t.items.some((r) => r.status === "running")
  const status = running ? "sky" : t.active ? "amber" : t.chip.status === "failed" ? "red" : undefined
  return (
    <Avatar9 status={status} live={running} statusLabel={running ? "working" : t.active ? "queued" : t.chip.status}
      fallbackClassName={cn(t.needs ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
      <MessageSquare className="size-4" />
    </Avatar9>
  )
}

// Who wrote a message, as a small mark in the thread's left rail.
export function AuthorMark({ reply = false }: { reply?: boolean }) {
  const Icon = reply ? Sparkles : User
  const tint = reply ? "bg-sky-500/12 text-sky-700 dark:text-sky-300" : "bg-muted text-foreground"
  return <Avatar9 size="sm" className="size-7" fallbackClassName={tint}><Icon className="size-3.5" /></Avatar9>
}

// How full the conversation's context is, as a thin bar.
export function CtxMeter({ pct, className }: { pct: number | null; className?: string }) {
  if (pct === null) return null
  return (
    <span className={cn("inline-block h-1.5 w-14 overflow-hidden rounded-full bg-muted align-middle", className)} aria-hidden="true">
      <span className={cn("block h-full rounded-full", ctxBar(pct))} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
    </span>
  )
}

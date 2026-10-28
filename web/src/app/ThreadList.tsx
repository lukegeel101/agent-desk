// The conversation list: filter tabs and one row per conversation.
import { useEffect, useRef } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ago, type Filter, type Thread } from "@/shared/desk"
import { ctxTone } from "./lib"
import { FoldButton } from "./panels"
import { StatusBadge, ThreadMark } from "./parts"
import Badge9 from "./ui/badge-9"
import Badge12 from "./ui/badge-12"
import Tabs4 from "./ui/tabs-4"

export function ThreadList({ threads, shown, filter, onFilter, current, onSelect, onNew, now, unread, onFold }: {
  threads: Thread[]
  shown: Thread[]
  filter: Filter
  onFilter: (f: Filter) => void
  current: string | null
  onSelect: (id: string) => void
  onNew: () => void
  now: number
  unread: (t: Thread) => number
  onFold?: () => void
}) {
  const open = threads.filter((t) => !t.archived)
  const listRef = useRef<HTMLDivElement>(null)
  // Keep the selected row in view when Shift+Up/Down moves it.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" })
  }, [current])

  return (
    <aside aria-label="Conversations" className="flex min-h-0 flex-1 flex-col border-r bg-sidebar/60">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="text-sm font-semibold tracking-tight">Conversations</h2>
        <span className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onNew} title="Start a new conversation (N)" className="h-7 gap-1 rounded-full px-2.5 text-xs">
            <Plus className="size-3.5" /> New
          </Button>
          {onFold && <span className="hidden md:flex"><FoldButton side="left" label="conversations" onClick={onFold} /></span>}
        </span>
      </div>
      <div className="px-3 pb-3">
        <Tabs4
          label="Show"
          value={filter}
          onValueChange={(v) => onFilter(v as Filter)}
          items={[
            { value: "all", label: "All", count: open.length },
            { value: "active", label: "Active", count: open.filter((t) => t.active).length, title: "Working or queued" },
            { value: "needs", label: "Needs you", count: open.filter((t) => t.needs).length, alert: true, title: "Waiting on something only you can do" },
            { value: "archived", label: "Archived", title: "Archived conversations; a follow-up brings one back" },
          ]}
        />
      </div>
      <div ref={listRef} className="wm-scroll min-h-0 flex-1 overflow-y-auto border-t">
        {shown.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{filter === "all" ? "Nothing yet. Your conversations appear here." : "Nothing here."}</p>
        )}
        {shown.map((t) => <Row key={t.id} t={t} selected={t.id === current} onSelect={onSelect} now={now} unread={unread(t)} />)}
      </div>
    </aside>
  )
}

function Row({ t, selected, onSelect, now, unread }: { t: Thread; selected: boolean; onSelect: (id: string) => void; now: number; unread: number }) {
  const running = t.items.some((r) => r.status === "running")
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={() => onSelect(t.id)}
      className={cn(
        "group relative flex w-full gap-3 border-b px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        selected && "bg-muted hover:bg-muted",
      )}
    >
      {/* left accent: amber when it needs you, blue while it works */}
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]",
        t.needs ? "bg-amber-500" : running ? "bg-sky-500" : selected ? "bg-foreground/30" : "bg-transparent")} />
      <ThreadMark t={t} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-start gap-2">
          <span className="line-clamp-2 flex-1 text-[13.5px] leading-snug font-medium [overflow-wrap:anywhere]" title={t.first.text}>{t.title}</span>
          {unread > 0 && !selected && <Badge12 tone="sky" className="shrink-0 font-semibold">{unread} new</Badge12>}
          <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground tabular-nums">{ago(t.when, now).replace(" ago", "")}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusBadge r={t.chip} />
          {t.needs && <Badge12 tone="amber" className="font-semibold">needs you · {t.needs.items.length}</Badge12>}
          {t.refused > 0 && <Badge12 tone="neutral" className="bg-red-500/10 text-red-700 dark:text-red-300" title="The permission mode refused actions in the last reply">refused · {t.refused}</Badge12>}
          <span className="ml-auto flex items-center gap-1.5">
            {t.items.length > 1 && <Badge9 className="bg-muted text-muted-foreground" title={`${t.items.length} messages`}>{t.items.length}</Badge9>}
            {t.usage.pct !== null && <span className={cn("font-mono", ctxTone(t.usage.pct))} title={`Context in use: ${t.usage.ctx.toLocaleString()} of ${t.usage.window.toLocaleString()} tokens`}>{t.usage.pct}%</span>}
          </span>
        </span>
      </span>
    </button>
  )
}

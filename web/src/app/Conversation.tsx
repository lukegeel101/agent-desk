// The open conversation: header with stats, the scrolling thread (newest at the bottom), the composer, and the
// "For you" rail with the reply's to-dos (beside the thread on wide screens, above it on narrow ones).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ChevronDown, ChevronUp, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { fmtTok, useDetails, type State, type Thread } from "@/shared/desk"
import { saveTitle } from "@/shared/actions"
import { allLinks, ctxTone, runTime, sumOf } from "./lib"
import { LinksButton } from "./Links"
import { MessageItem } from "./Message"
import { NeedsBox } from "./NeedsBox"
import { FoldButton, FoldedStrip, StripCount } from "./panels"
import { CtxMeter } from "./parts"
import { usePanel } from "./usePanel"
import Badge12 from "./ui/badge-12"
import Popover8 from "./ui/popover-8"

const FIRST_SHOWN = 6

export function Conversation({ t, state, now, composer, onBack }: {
  t: Thread; state: State; now: number; composer: ReactNode; onBack: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [from, setFrom] = useState(Math.max(0, t.items.length - FIRST_SHOWN))
  const start = Math.min(from, Math.max(0, t.items.length - FIRST_SHOWN))
  const shown = t.items.slice(start)
  const details = useDetails(t, Math.max(40, t.items.length - start))

  // Follow the newest message unless the reader has scrolled up to an older one.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  // Shift+Left/Right (sent by App) step to the previous or next message.
  useEffect(() => {
    const onStep = (e: Event) => {
      const dir = (e as CustomEvent<number>).detail
      const el = scrollRef.current
      if (!el) return
      const items = [...el.querySelectorAll<HTMLElement>("[data-msg]")]
      if (!items.length) return
      const top = el.getBoundingClientRect().top
      let at = items.findIndex((m) => m.getBoundingClientRect().bottom > top + 24)
      if (at < 0) at = items.length - 1
      const next = at + dir
      if (next < 0) { if (start > 0) { stick.current = false; setFrom(Math.max(0, start - 10)) } return }
      if (next >= items.length) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); return }
      stick.current = false
      items[next].scrollIntoView({ block: "start", behavior: "smooth" })
    }
    window.addEventListener("desk-step", onStep)
    return () => window.removeEventListener("desk-step", onStep)
  }, [start])

  const [railOpen, setRailOpen] = useState(true)
  const [forYouOpen, setForYouOpen] = usePanel("foryou")

  return (
    <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header t={t} onBack={onBack} />

        {t.needs && (
          <div className="shrink-0 border-b bg-muted/30 xl:hidden">
            <button type="button" onClick={() => setRailOpen(!railOpen)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium">
              <span>For you</span>
              <Badge12 tone="amber">needs you · {t.needs.items.length}</Badge12>
              <span className="ml-auto text-muted-foreground">{railOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
            </button>
            {railOpen && <div className="wm-scroll max-h-[42vh] overflow-y-auto px-3 pb-3 sm:px-4"><NeedsBox t={t} /></div>}
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
          }}
          className="wm-scroll min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[860px] px-3 pt-5 pb-2 sm:px-6">
            {start > 0 && (
              <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs">
                <Button size="xs" variant="outline" className="rounded-full" onClick={() => { stick.current = false; setFrom(Math.max(0, start - 10)) }}>
                  Show {Math.min(10, start)} earlier message{Math.min(10, start) === 1 ? "" : "s"}
                </Button>
                {start > 10 && <Button size="xs" variant="ghost" className="rounded-full" onClick={() => { stick.current = false; setFrom(0) }}>Show all {t.items.length}</Button>}
                <span className="text-muted-foreground">{start} earlier hidden</span>
              </div>
            )}
            {shown.map((r, i) => (
              <MessageItem key={r.id} t={t} r={r} d={details[r.id]} now={now} timeoutSeconds={state.timeoutSeconds}
                slots={state.maxParallel} index={start + i} latest={start + i === t.items.length - 1} />
            ))}
          </div>
        </div>
        {composer}
      </div>

      {forYouOpen ? (
        <aside aria-label="For you" className="wm-scroll hidden w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-l bg-muted/20 p-4 xl:flex">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">For you</h2>
            <FoldButton side="right" label="For you" onClick={() => setForYouOpen(false)} />
          </div>
          {t.needs ? <NeedsBox t={t} />
            : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing in this conversation is waiting on you.</p>}
        </aside>
      ) : (
        <FoldedStrip side="right" label="For you" onOpen={() => setForYouOpen(true)} className="hidden xl:flex">
          <StripCount n={t.needs?.items.length || 0} tone="amber" title="things you need to do" />
        </FoldedStrip>
      )}
    </section>
  )
}

function Header({ t, onBack }: { t: Thread; onBack: () => void }) {
  const u = t.usage
  const turns = sumOf(t, "turns"), browser = sumOf(t, "browserCalls"), subs = sumOf(t, "subagents")
  const hasLinks = allLinks(t).length > 0
  return (
    <header className="shrink-0 border-b px-3 py-2.5 sm:px-5">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" className="-ml-1 md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 text-[17px] leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]" title={t.first.text}>{t.title}</h1>
        <Popover8
          value={t.title}
          onSave={(title: string) => void saveTitle(t.id, title.replace(/\s+/g, " ").trim())}
          trigger={<Button variant="outline" size="xs" className="shrink-0 gap-1 rounded-full" title="Rename this conversation"><Pencil className="size-3" /> Rename</Button>}
        />
      </div>
      {(u.tokens > 0 || u.ctx > 0 || u.cost > 0 || hasLinks) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {u.model && <span className="font-semibold text-foreground">{u.model}</span>}
          {u.ctx > 0 && (
            <span className="flex items-center gap-1.5">
              context <b className="font-semibold text-foreground">{fmtTok(u.ctx)}</b>
              {u.window > 0 && <>of {fmtTok(u.window)} <CtxMeter pct={u.pct} /> <b className={cn("font-mono", ctxTone(u.pct))}>{u.pct}%</b></>}
            </span>
          )}
          {u.tokens > 0 && <span title={`Every model call in this conversation, cache reads included; ${u.output.toLocaleString()} of them written by the model`}>tokens <b className="font-semibold text-foreground">{fmtTok(u.tokens)}</b> ({fmtTok(u.output)} written)</span>}
          {u.cost > 0 && <span title="What these tokens would cost at API list prices; on a subscription plan nothing is billed per token">usage <b className="font-semibold text-foreground">${u.cost.toFixed(2)}</b></span>}
          {u.ms > 0 && <span>run time <b className="font-semibold text-foreground">{runTime(u.ms)}</b></span>}
          {turns > 0 && <span><b className="font-semibold text-foreground">{turns}</b> turns</span>}
          {browser > 0 && <span className="rounded border px-1.5" title="Browser or computer-use steps">browser ×{browser}</span>}
          {subs > 0 && <span className="rounded border px-1.5" title="Subagents this conversation started">{subs} subagent{subs === 1 ? "" : "s"}</span>}
          <LinksButton t={t} />
        </div>
      )}
    </header>
  )
}

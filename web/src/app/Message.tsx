// One message in the thread: what you asked, then the reply under it (live while it is being written).
import { useState, type ReactNode } from "react"
import { Clock, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { stopRequest } from "@/shared/actions"
import { ago, duration, fmtTok, local, type Detail, type Request, type Thread } from "@/shared/desk"
import { queuedWhy, shortTool, stepText } from "./lib"
import { AuthorMark, Markdown, StatusBadge } from "./parts"
import Alert25 from "./ui/alert-25"
import Button9 from "./ui/button-9"
import Collapsible1 from "./ui/collapsible-1"
import { LabeledProgressIndicator } from "./ui/labeled-progress-indicator"

export function MessageItem({ t, r, d, now, timeoutSeconds, slots, index, latest }: {
  t: Thread; r: Request; d?: Detail; now: number; timeoutSeconds: number; slots: number; index: number; latest: boolean
}) {
  return (
    <article data-msg={index} className="relative scroll-mt-4">
      <Rail mark={<AuthorMark />}>
        <div className="mb-1 text-xs text-muted-foreground">You · {local(r.at)}</div>
        <div className="w-fit max-w-full rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text}</div>
      </Rail>
      <Reply t={t} r={r} d={d} now={now} timeoutSeconds={timeoutSeconds} slots={slots} latest={latest} />
    </article>
  )
}

function Rail({ mark, children, line = true }: { mark: ReactNode; children: ReactNode; line?: boolean }) {
  return (
    <div className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-4">
      {line && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[13.5px] w-px bg-border" />}
      <div className="relative z-10">{mark}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function metaBits(r: Request): string[] {
  const bits: string[] = []
  if (r.modelLabel || r.model) bits.push(r.modelLabel || r.model)
  if (r.durationMs) bits.push(duration(r.durationMs))
  if (r.turns) bits.push(`${r.turns} turns`)
  if (r.tokens) bits.push(`${fmtTok(r.tokens)} tokens`)
  if (r.contextTokens && r.contextWindow) bits.push(`context ${Math.round((100 * r.contextTokens) / r.contextWindow)}%`)
  if (typeof r.runCostUsd === "number") bits.push(`$${r.runCostUsd.toFixed(2)} equiv.`)
  if (r.browserCalls) bits.push(`browser ×${r.browserCalls}`)
  if (r.subagents) bits.push(`${r.subagents} subagent${r.subagents === 1 ? "" : "s"}`)
  return bits
}

function StopButton({ r }: { r: Request }) {
  const [sent, setSent] = useState(false)
  if (r.status !== "queued" && r.status !== "running") return null
  const queued = r.status === "queued"
  return (
    <Button type="button" size="xs" variant="outline" disabled={sent || !!r.stopRequested}
      onClick={() => { setSent(true); void stopRequest(r.id) }} className="ml-auto gap-1 rounded-full">
      {queued ? <X className="size-3" /> : <Square className="size-3" />} {queued ? "Cancel" : "Stop"}
    </Button>
  )
}

function Reply({ t, r, d, now, timeoutSeconds, slots, latest }: {
  t: Thread; r: Request; d?: Detail; now: number; timeoutSeconds: number; slots: number; latest: boolean
}) {
  const result = d?.result || r.result || ""
  // The list row carries only the first 600 characters; until the full reply arrives, say so.
  const partial = !d?.result && (r.result || "").length >= 600
  const [full, setFull] = useState(false)
  const clamp = !latest && r.status === "done" && result.length > 1800 && !full
  let body: ReactNode = null
  if (r.status === "queued") body = <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="size-4" />{queuedWhy(t, r, slots)}</p>
  else if (r.status === "running") body = <Live r={r} d={d} now={now} timeoutSeconds={timeoutSeconds} />
  else if (r.status === "cancelled") body = <p className="text-sm text-muted-foreground">Cancelled before it started.</p>
  else if (result) body = r.status === "done"
    ? (
      <div className="relative">
        <div className={cn(clamp && "max-h-80 overflow-hidden")}><Markdown text={result} /></div>
        {partial && <p className="mt-1 text-xs text-muted-foreground italic">Loading the rest of this reply...</p>}
        {clamp && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card to-transparent" />}
        {!latest && result.length > 1800 && (
          <button type="button" onClick={() => setFull(!full)} className="relative mt-2 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300">
            {full ? "Collapse this reply" : "Show the full reply"}
          </button>
        )}
      </div>
    )
    : <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{result}</pre>

  const steps = d?.steps || []
  const refused = d?.refused || r.refused || []
  return (
    <Rail mark={<AuthorMark reply />} line={false}>
      <div className={cn(
        "rounded-2xl border bg-card px-4 py-3 shadow-xs",
        r.status === "failed" && "border-red-500/40",
        r.status === "running" && "border-sky-500/40 ring-4 ring-sky-500/5",
      )}>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StatusBadge r={r} />
          <span className="font-medium text-foreground">Claude</span>
          {r.startedAt && <span>started {local(r.startedAt)}</span>}
          {metaBits(r).length > 0 && <span className="text-muted-foreground/90">· {metaBits(r).join(" · ")}</span>}
          <StopButton r={r} />
        </div>
        <div key={r.status} className="animate-in fade-in slide-in-from-bottom-1 duration-500 motion-reduce:animate-none">{body}</div>
        {refused.length > 0 && (
          <Alert25 className="mt-3" title={`${refused.length} action${refused.length === 1 ? " was" : "s were"} refused by the permission mode`}>
            <ul className="mt-1 space-y-1">
              {refused.map((x, i) => <li key={i} className="[overflow-wrap:anywhere]"><span className="font-mono">{shortTool(x.tool)}</span> {x.what}</li>)}
            </ul>
            <p className="mt-1">To allow one, add a permission rule to your Claude Code settings, or change DESK_PERMISSION_MODE.</p>
          </Alert25>
        )}
        {d?.stderr && r.status === "failed" && (
          <Collapsible1 className="mt-3" title="Error output" contentClassName="max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap text-red-700 dark:text-red-300">{d.stderr}</Collapsible1>
        )}
        {steps.length > 0 && r.status !== "running" && (
          <Collapsible1 className="mt-3" title={`${d?.stepCount ?? steps.length} step${(d?.stepCount ?? steps.length) === 1 ? "" : "s"} taken`} contentClassName="max-h-72 overflow-auto">
            <Steps d={d!} />
          </Collapsible1>
        )}
      </div>
    </Rail>
  )
}

function Steps({ d }: { d: Detail }) {
  const steps = d.steps || []
  const hidden = (d.stepCount || 0) - steps.length
  return (
    <ol className="list-decimal space-y-0.5 pl-5 text-xs">
      {hidden > 0 && <li className="list-none text-muted-foreground italic">...{hidden} earlier steps not shown</li>}
      {steps.map((s, i) => s.tool
        ? <li key={i} className="[overflow-wrap:anywhere]"><span className="font-mono text-sky-700 dark:text-sky-300">{shortTool(s.tool)}</span> {s.detail}</li>
        : <li key={i} className="text-muted-foreground italic [overflow-wrap:anywhere]">{s.say}</li>)}
    </ol>
  )
}

// A running reply: the step it is on, how much of the time limit it has used, and the text being written.
function Live({ r, d, now, timeoutSeconds }: { r: Request; d?: Detail; now: number; timeoutSeconds: number }) {
  const steps = d?.steps || []
  const last = steps.length ? steps[steps.length - 1] : r.lastStep
  const startMs = r.startedAt ? Date.parse(r.startedAt) : now
  const used = Math.max(0, (now - startMs) / 1000)
  const left = Math.round((timeoutSeconds - used) / 60)
  const draft = d?.draft || ""
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
        <LabeledProgressIndicator label={stepText(last)} progress={used / timeoutSeconds} warn={left <= 10} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Button9 label="Working" className="font-medium text-sky-700 dark:text-sky-300" />
          <span>{r.startedAt ? `${ago(r.startedAt, now).replace(" ago", "").replace("just now", "under a minute")} so far` : "starting"}</span>
          <span className={cn(left <= 10 && "font-medium text-amber-700 dark:text-amber-400")}>{left > 0 ? `${left} min left before it is stopped` : "at its time limit"}</span>
          {d?.stepCount ? <span>{d.stepCount} steps</span> : null}
        </div>
      </div>
      {draft && <div aria-live="off"><Markdown text={draft} draft /></div>}
      {steps.length > 0 && (
        <Collapsible1 title={`Steps so far (${d?.stepCount ?? steps.length})`} contentClassName="max-h-60 overflow-auto"><Steps d={d!} /></Collapsible1>
      )}
    </div>
  )
}

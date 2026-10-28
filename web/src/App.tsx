// Agent Desk: conversations on the left, the open conversation in the middle, and a "For you" rail on wide screens.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Sparkles, Volume2, VolumeX } from "lucide-react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { filterThreads, isActive, useDesk, type Filter, type State, type Thread } from "@/shared/desk"
import { flash as showFlash, sendMessage } from "@/shared/actions"
import { Composer } from "./app/Composer"
import { Conversation } from "./app/Conversation"
import { IDEAS } from "./app/lib"
import { FoldedStrip, StripCount } from "./app/panels"
import { useSeen } from "./app/seen"
import { useFinishPop } from "./app/sound"
import { useSystemDark } from "./app/theme"
import { ThreadList } from "./app/ThreadList"
import { usePanel } from "./app/usePanel"
import Badge12 from "./app/ui/badge-12"
import "./app/wm.css"

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const typingIn = (el: Element | null) => {
  const tag = el?.tagName || ""
  return tag === "INPUT" || tag === "SELECT" || (tag === "TEXTAREA" && (el as HTMLTextAreaElement).value !== "") || !!(el as HTMLElement | null)?.isContentEditable
}

// Drafts are kept per conversation, so an unsent idea survives a reload and does not follow you into other
// conversations; "New" has its own draft.
const draftKey = (id: string | null) => `desk-draft:${id || "new"}`
function loadDraft(id: string | null) { try { return localStorage.getItem(draftKey(id)) || "" } catch { return "" } }
function saveDraft(id: string | null, text: string) {
  try { if (text.trim()) localStorage.setItem(draftKey(id), text); else localStorage.removeItem(draftKey(id)) } catch { /* private window */ }
}

export default function App() {
  useSystemDark()
  const now = useNow()
  const [current, setCurrent] = useState<string | null>(() => location.hash.slice(1) || null)
  const { state, threads, error } = useDesk()
  const { unread, markSeen } = useSeen()
  const [filter, setFilter] = useState<Filter>("all")
  const [listOpen, setListOpen] = usePanel("list")
  const [pane, setPane] = useState<"list" | "convo">(() => (location.hash.slice(1) ? "convo" : "list"))
  const shown = useMemo(() => filterThreads(threads, filter), [threads, filter])
  const sound = useFinishPop(threads, !!state)

  const [text, setTextState] = useState(() => loadDraft(current))
  const setText = (v: string) => { setTextState(v); saveDraft(current, v) }
  const [sending, setSending] = useState(false)
  const [modelPick, setModelPick] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const select = (id: string | null) => {
    saveDraft(current, text)
    setTextState(loadDraft(id))
    setCurrent(id)
    setPane(id ? "convo" : "list")
    history.replaceState(null, "", id ? `${location.pathname}#${id}` : location.pathname)
  }
  const keyState = useRef({ shown, current, select })
  useEffect(() => { keyState.current = { shown, current, select } })

  // Back and forward, or a pasted #conversation link.
  useEffect(() => {
    const onHash = () => { const id = location.hash.slice(1) || null; if (id !== keyState.current.current) keyState.current.select(id) }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const t = threads.find((x) => x.id === current) || null

  // Messages under the message box: the server's answer to an action, or "Finished: ..." when a reply finishes.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      setFlash(text)
      clearTimeout(timer)
      timer = setTimeout(() => setFlash((f) => (f === text ? null : f)), 6000)
    }
    window.addEventListener("desk-flash", on)
    return () => { window.removeEventListener("desk-flash", on); clearTimeout(timer) }
  }, [])
  const before = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!state) return
    const prev = before.current
    before.current = new Map(state.requests.map((r) => [r.id, r.status]))
    if (!prev) return
    const done = state.requests.find((r) => { const s = prev.get(r.id); return s && (s === "queued" || s === "running") && !isActive(r) })
    if (done) showFlash(`Finished: ${done.text.slice(0, 60)}`)
  }, [state])

  // The open conversation's finished replies count as read; the tab title shows how many are unread elsewhere.
  useEffect(() => { if (t) markSeen(t) }, [t, markSeen])
  const unreadTotal = threads.reduce((n, x) => n + (x.id === current ? 0 : unread(x)), 0)
  useEffect(() => { document.title = unreadTotal ? `(${unreadTotal}) Agent Desk` : "Agent Desk" }, [unreadTotal])

  // Keyboard: Shift+Up/Down switch conversations, Shift+Left/Right step through messages, N starts a new one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const { shown, current, select } = keyState.current
      if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (typingIn(document.activeElement) || !shown.length) return
        e.preventDefault()
        const at = shown.findIndex((x) => x.id === current)
        const next = at < 0 ? (e.key === "ArrowDown" ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))
        if (shown[next].id !== current) select(shown[next].id)
        return
      }
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (typingIn(document.activeElement)) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("desk-step", { detail: e.key === "ArrowRight" ? 1 : -1 }))
        return
      }
      if (e.key === "n" && !e.shiftKey && !typingIn(document.activeElement) && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault()
        select(null)
        setPane("convo")
        setTimeout(() => box.current?.focus(), 0)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  if (!state) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        {error ? `The server did not answer (${error}); retrying.` : "Loading conversations..."}
      </div>
    )
  }

  const model = modelPick ?? state.chosenModel
  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    const sentFrom = current
    setSending(true)
    try {
      const res = await sendMessage(body, model, t ? t.id : null)
      if (!res?.ok) return
      saveDraft(sentFrom, "")
      setTextState("")
      if (res.thread) { setCurrent(res.thread); setPane("convo"); history.replaceState(null, "", `${location.pathname}#${res.thread}`) }
      showFlash("Sent. It starts within a second.")
    } finally { setSending(false) }
  }
  const composer = (
    <Composer t={t} state={state} text={text} setText={setText} model={model} setModel={setModelPick}
      flash={flash} now={now} boxRef={box} onSend={() => void send()} sending={sending} onArchived={() => select(null)} />
  )
  const startNew = () => { select(null); setPane("convo"); setTimeout(() => box.current?.focus(), 0) }

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground antialiased">
        <TopBar state={state} threads={threads} onFilter={(f) => { setFilter(f); setPane("list") }} sound={sound} />
        <div className={cn("grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]",
          listOpen ? "md:grid-cols-[340px_minmax(0,1fr)] lg:grid-cols-[380px_minmax(0,1fr)]" : "md:grid-cols-[44px_minmax(0,1fr)]")}>
          <div className={cn("min-h-0 md:flex md:flex-col", pane === "list" ? "flex flex-col" : "hidden")}>
            {/* Folded on a wide screen it is a strip; a phone always shows the whole list (one pane at a time). */}
            <div className={cn("min-h-0 flex-1 flex-col", listOpen ? "flex" : "flex md:hidden")}>
              <ThreadList threads={threads} shown={shown} filter={filter} onFilter={setFilter} current={current}
                onSelect={select} onNew={startNew} now={now} unread={unread} onFold={() => setListOpen(false)} />
            </div>
            {!listOpen && (
              <FoldedStrip side="left" label="Conversations" onOpen={() => setListOpen(true)} className="hidden md:flex">
                <StripCount n={threads.filter((x) => x.items.some((r) => r.status === "running")).length} tone="sky" title="working now" />
                <StripCount n={threads.filter((x) => !x.archived && x.needs).length} tone="amber" title="conversations that need you" />
                <StripCount n={unreadTotal} tone="pink" title="unread replies" />
              </FoldedStrip>
            )}
          </div>
          <div className={cn("min-h-0 min-w-0 md:flex", pane === "convo" ? "flex" : "hidden")}>
            {t
              ? <Conversation key={t.id} t={t} state={state} now={now} composer={composer} onBack={() => setPane("list")} />
              : <Intro state={state} onIdea={(i) => { setText(i); box.current?.focus() }} composer={composer} onBack={() => setPane("list")} />}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

// At a glance: what is running, what is queued and what needs you.
function TopBar({ state, threads, onFilter, sound }: {
  state: State; threads: Thread[]; onFilter: (f: Filter) => void; sound: { on: boolean; toggle: () => void }
}) {
  const open = threads.filter((t) => !t.archived)
  const working = threads.filter((t) => t.items.some((r) => r.status === "running")).length
  const queued = threads.filter((t) => t.active && !t.items.some((r) => r.status === "running")).length
  const needs = open.filter((t) => t.needs).length
  const week = state.requests.filter((r) => r.runCostUsd && Date.now() - Date.parse(r.at) < 7 * 86400000).reduce((a, r) => a + (r.runCostUsd || 0), 0)
  const chip = "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2">
      <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-background"><Sparkles className="size-3.5" /></span>
        Agent Desk
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip} onClick={() => onFilter("active")} title="Show conversations in progress">
          <Badge12 tone={working ? "sky" : "neutral"} live={working > 0}>{working} working</Badge12>
        </button>
        <button type="button" className={chip} onClick={() => onFilter("active")} title="Show conversations in progress">
          <Badge12 tone="neutral">{queued} queued</Badge12>
        </button>
        <button type="button" className={chip} onClick={() => onFilter("needs")} title="Show conversations waiting on you">
          <Badge12 tone={needs ? "amber" : "neutral"} className={cn(needs > 0 && "font-semibold")}>{needs} need you</Badge12>
        </button>
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <button type="button" onClick={sound.toggle} aria-pressed={sound.on}
          title={sound.on ? "A pop plays when a conversation finishes. Click to mute." : "Muted. Click to play a pop when a conversation finishes."}
          className="flex size-7 items-center justify-center rounded-full outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          {sound.on ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          <span className="sr-only">{sound.on ? "Mute the finish sound" : "Turn on the finish sound"}</span>
        </button>
        <span className="hidden sm:inline" title="The permission mode every run uses (DESK_PERMISSION_MODE)">mode <b className="font-semibold text-foreground">{state.permissionMode}</b></span>
        {week > 0 && (
          <span className="hidden sm:inline" title="What the last 7 days of runs would cost at API list prices; on a subscription plan nothing is billed per token">
            7 days: <b className="font-semibold text-foreground">${week.toFixed(0)}</b> usage
          </span>
        )}
      </span>
    </header>
  )
}

function Intro({ state, onIdea, composer, onBack }: { state: State; onIdea: (idea: string) => void; composer: ReactNode; onBack: () => void }) {
  return (
    <section aria-label="New conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="wm-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-12 text-center">
          <button type="button" onClick={onBack} className="mb-6 text-xs text-muted-foreground underline md:hidden">Back to conversations</button>
          <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl bg-foreground text-background"><Sparkles className="size-5" /></span>
          <h2 className="text-lg font-semibold tracking-tight">What should get done?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Each message runs as a Claude Code session in <code className="font-mono text-[12.5px]">{state.workdir}</code>.
            Close this page whenever you like; it keeps working, and follow-ups in a conversation remember what came before.
          </p>
          <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
            {IDEAS.map((i) => (
              <button key={i} type="button" onClick={() => onIdea(i)}
                className="rounded-xl border bg-card px-3 py-2.5 text-[13px] leading-snug shadow-xs transition-colors hover:border-sky-500/50 hover:bg-muted/50">{i}</button>
            ))}
          </div>
        </div>
      </div>
      {composer}
    </section>
  )
}

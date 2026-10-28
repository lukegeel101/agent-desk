// The message box, the model picker and the conversation's actions next to Send.
import type { Ref, RefObject } from "react"
import { Archive, ArchiveRestore, ArrowUp, Keyboard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { fmtTok, type State, type Thread } from "@/shared/desk"
import { archive, saveModel } from "@/shared/actions"
import { lastModelRun, modelName, modelOptions } from "./lib"
import Select10 from "./ui/select-10"
import Textarea14 from "./ui/textarea-14"
import Tooltip8 from "./ui/tooltip-8"

export function Composer({ t, state, text, setText, model, setModel, flash, now, boxRef, onSend, sending, onArchived }: {
  t: Thread | null
  state: State
  text: string
  setText: (v: string) => void
  model: string
  setModel: (v: string) => void
  flash: string | null
  now: number
  boxRef: RefObject<HTMLTextAreaElement | null>
  onSend: () => void
  sending: boolean
  onArchived: () => void
}) {
  const last = t ? lastModelRun(t) : undefined
  const modelNote = last && last.model !== model ? `Last reply ran on ${last.modelLabel || last.model}; your next message uses ${modelName(state.models, model)}.` : ""
  const send = () => { if (text.trim() && !sending) onSend() }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send() }}
      className="shrink-0 border-t bg-background/95 px-3 pt-3 pb-3 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-5"
    >
      <ColdNotice t={t} now={now} />
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <label htmlFor="desk-text" className="text-muted-foreground">{t ? "Follow up in this conversation" : "New conversation"}</label>
        {modelNote && <span className="text-amber-700 dark:text-amber-400">{modelNote}</span>}
      </div>
      <div className="relative">
        <Textarea14
          id="desk-text"
          ref={boxRef as Ref<HTMLTextAreaElement>}
          value={text}
          maxLength={20000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Hand off a task or ask a question. It keeps working after you close this page."
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          className="pr-12"
        />
        <Button type="submit" size="icon-sm" disabled={!text.trim() || sending} aria-label="Send" title="Send (Enter)"
          className="absolute right-2 bottom-2 rounded-full">
          <ArrowUp className="size-4" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select10 label="Model" value={model} onValueChange={(v) => { setModel(v); void saveModel(v) }}
          groups={modelOptions(state.models)} title="Saved on the server, so every browser sends the same model" />
        <Tooltip8
          trigger={<Button type="button" variant="ghost" size="xs" className="gap-1 text-muted-foreground"><Keyboard className="size-3.5" /> Shortcuts</Button>}
        >
          <div className="space-y-1">
            <div><Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line</div>
            <div><Kbd>Shift</Kbd>+<Kbd>↑</Kbd><Kbd>↓</Kbd> switch conversations</div>
            <div><Kbd>Shift</Kbd>+<Kbd>←</Kbd><Kbd>→</Kbd> previous or next message · <Kbd>N</Kbd> new conversation</div>
            <div>Up to {state.maxParallel} conversations run at once, in {state.workdir}.</div>
          </div>
        </Tooltip8>
        {flash && <span role="status" className="text-xs text-muted-foreground">{flash}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {t && (t.archived
            ? <Button type="button" variant="ghost" size="xs" className="gap-1 text-muted-foreground" onClick={() => void archive(t.id, false)}><ArchiveRestore className="size-3.5" /> Restore</Button>
            : <Button type="button" variant="ghost" size="xs" className="gap-1 text-muted-foreground" disabled={t.active}
                title={t.active ? "Wait for it to finish first" : "Move this conversation to Archived; a follow-up brings it back"}
                onClick={async () => { const res = await archive(t.id, true); if (res?.ok) onArchived() }}><Archive className="size-3.5" /> Archive</Button>)}
          <Button type="submit" disabled={!text.trim() || sending} className="rounded-full px-4">{sending ? "Sending..." : "Send"}</Button>
        </div>
      </div>
    </form>
  )
}

// Before a follow-up to a long-idle conversation: the prompt cache has expired, so its whole context is read again.
function ColdNotice({ t, now }: { t: Thread | null; now: number }) {
  if (!t || t.active) return null
  const u = t.usage
  const last = [...t.items].reverse().find((r) => r.finishedAt)
  const idleMin = last?.finishedAt ? (now - Date.parse(last.finishedAt)) / 60000 : 0
  if (!(idleMin > 60 && u.ctx > 20000)) return null
  return (
    <p className={cn("mb-2 rounded-lg border-l-[3px] border-amber-500 bg-amber-500/8 px-2.5 py-1.5 text-xs")}>
      Cold resume: idle {idleMin >= 120 ? `${Math.round(idleMin / 60)} h` : `${Math.round(idleMin)} min`}, so the cache has expired and your next message reads about {fmtTok(u.ctx)} tokens of context again.
    </p>
  )
}

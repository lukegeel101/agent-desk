// Add permission: Claude Code permission rules (and auto-mode sentences) added from the page. The server writes only
// after someone clicks Add in a dialog on its own screen that lists every entry, so no agent can grant itself anything.
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { addPermissions } from "@/shared/actions"
import type { State } from "@/shared/desk"

const SCOPE_KEY = "desk-perm-scope"
function savedScope() { try { return localStorage.getItem(SCOPE_KEY) || "desk" } catch { return "desk" } }

const linesOf = (text: string) => text.split("\n").map((l) => l.trim().replace(/^["'`,\s]+|["'`,\s]+$/g, "")).filter(Boolean)
const sentencesOf = (text: string) => text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)

// An agent's suggestion pasted as JSON, e.g. {"permissions": {"allow": [...]}, "autoMode": {"allow": ["..."]}}.
function fromJson(text: string): { rules: string[]; auto: string[] } | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { permissions?: { allow?: unknown }; autoMode?: { allow?: unknown } }
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "$defaults") : [])
    const rules = list(data.permissions?.allow), auto = list(data.autoMode?.allow)
    return rules.length || auto.length ? { rules, auto } : null
  } catch { return null }
}

export function PermissionPanel({ state, seed }: { state: State; seed: string }) {
  const how = state.permission.confirm
  const idle = how === "dialog" ? "You confirm everything in one dialog on the desk computer's screen before anything is written."
    : how === "none" ? "Written as soon as you press Add (the confirmation dialog is switched off on this desk)."
    : "This desk's computer cannot show the confirmation dialog, so nothing can be added from here."
  const [rules, setRules] = useState(seed)
  const [auto, setAuto] = useState("")
  const [kind, setKind] = useState("allow")
  const [scope, setScope] = useState(() => (state.permission.scopes.some((s) => s.id === savedScope()) ? savedScope() : "desk"))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; ok?: boolean }>({ text: idle })

  const ruleList = linesOf(rules), autoList = sentencesOf(auto)
  const count = ruleList.length + autoList.length
  // Pasting a JSON suggestion into either box fills both.
  const onPaste = (e: React.ClipboardEvent) => {
    const parsed = fromJson(e.clipboardData.getData("text"))
    if (!parsed) return
    e.preventDefault()
    if (parsed.rules.length) setRules(parsed.rules.join("\n"))
    if (parsed.auto.length) setAuto(parsed.auto.join("\n\n"))
    setStatus({ text: `Filled ${parsed.rules.length} rule${parsed.rules.length === 1 ? "" : "s"} and ${parsed.auto.length} auto-mode sentence${parsed.auto.length === 1 ? "" : "s"} from the pasted JSON. Check them, then Add.` })
  }

  const add = async () => {
    if (!count || busy) return
    setBusy(true)
    setStatus({ text: how === "dialog" ? "Waiting for you to click Add in the dialog on the desk computer's screen (up to 2 minutes)..." : "Adding..." })
    try {
      const res = await addPermissions(ruleList, autoList, kind, scope)
      setStatus({ text: res?.message || (res?.ok ? "Added." : "Not added."), ok: !!res?.ok })
      if (res?.ok) { setRules(""); setAuto("") }
    } finally { setBusy(false) }
  }

  const field = "rounded-md border bg-background px-2 text-sm"
  return (
    <div id="desk-perm-panel" className="mt-2 space-y-2.5 rounded-xl border bg-muted/30 p-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <div>
        <label htmlFor="desk-perm-rules" className="text-xs font-semibold">
          Permission rules <span className="font-normal text-muted-foreground">(permissions.{kind}, one per line; or paste an agent's JSON suggestion)</span>
        </label>
        <textarea id="desk-perm-rules" rows={3} autoComplete="off" spellCheck={false} autoFocus value={rules}
          onChange={(e) => setRules(e.target.value)} onPaste={onPaste}
          placeholder={"Bash(npm test *)\nBash(gh pr view *)\nmcp__linear__save_issue"}
          className={cn(field, "mt-1 w-full py-1.5 font-mono text-[13px]")} />
      </div>
      <div>
        <label htmlFor="desk-perm-auto" className="text-xs font-semibold">
          Auto-mode allow <span className="font-normal text-muted-foreground">(optional; autoMode.allow in user settings, plain sentences, a blank line between two)</span>
        </label>
        <textarea id="desk-perm-auto" rows={2} value={auto} onChange={(e) => setAuto(e.target.value)} onPaste={onPaste}
          placeholder="e.g. Pushing to my own feature branches in this repository is approved."
          className={cn(field, "mt-1 w-full py-1.5 text-[13px]")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="List for the rules" value={kind} onChange={(e) => setKind(e.target.value)} className={cn(field, "h-8")}>
          <option value="allow">Allow</option><option value="ask">Ask first</option><option value="deny">Deny</option>
        </select>
        <select aria-label="Where the rules go" value={scope} className={cn(field, "h-8 min-w-0 flex-1")}
          onChange={(e) => { setScope(e.target.value); try { localStorage.setItem(SCOPE_KEY, e.target.value) } catch { /* private window */ } }}>
          {state.permission.scopes.map((s) => <option key={s.id} value={s.id} title={s.path}>Rules go to: {s.label}</option>)}
        </select>
        <Button type="button" size="sm" disabled={busy || !count || how === "unavailable"} onClick={() => void add()}>
          {busy ? "Adding..." : `Add${count ? ` ${count}` : ""}`}
        </Button>
      </div>
      <p role="status" className={cn("text-xs", status.ok === true ? "text-green-700 dark:text-green-400" : status.ok === false ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
        {status.text} Rules apply to Claude runs; OpenAI runs follow the Codex sandbox.
      </p>
    </div>
  )
}

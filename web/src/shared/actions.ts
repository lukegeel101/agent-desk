// Every write the page makes. The X-Desk header forces a CORS preflight the server never approves, so other
// websites cannot post to it.

export interface Result { ok: boolean; message?: string; thread?: string; id?: string }

// The app shows `flash` messages under the message box and re-polls after every action.
export const flash = (text: string) => window.dispatchEvent(new CustomEvent("desk-flash", { detail: text }))
export const refresh = () => window.dispatchEvent(new Event("desk-refresh"))

async function act(url: string, payload: Record<string, unknown>): Promise<Result | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Desk": "1" }, body: JSON.stringify(payload) })
    const body = (await res.json().catch(() => ({ ok: false, message: `The server refused that (HTTP ${res.status}).` }))) as Result
    if (body.message) flash(body.message)
    return body
  } catch {
    flash("The server did not answer; try again.")
    return null
  } finally {
    refresh()
  }
}

export const sendMessage = (text: string, model: string, thread: string | null) => act("/api/send", { text, model, thread })
export const saveModel = (model: string) => act("/api/model", { model })
export const saveTitle = (thread: string, title: string) => act("/api/title", { thread, title })
export const markNeedsDone = (id: string) => act("/api/needs-done", { id })
export const archive = (thread: string, archived: boolean) => act("/api/archive", { thread, archived })
// Quiet: the Add permission panel shows the server's answer itself (it can take two minutes to arrive).
export async function addPermissions(rules: string[], autoMode: string[], kind: string, scope: string): Promise<Result | null> {
  try {
    const res = await fetch("/api/permissions", { method: "POST", headers: { "Content-Type": "application/json", "X-Desk": "1" }, body: JSON.stringify({ rules, autoMode, kind, scope }) })
    return (await res.json().catch(() => ({ ok: false, message: `The server refused that (HTTP ${res.status}).` }))) as Result
  } catch {
    return { ok: false, message: "The server did not answer; try again." }
  }
}
// Opens the Add permission panel, optionally with a rule already filled in (from a refused action).
export const openPermission = (rule = "") => window.dispatchEvent(new CustomEvent("desk-permission", { detail: rule }))
export const stopRequest = (id: string) => act("/api/stop", { id })

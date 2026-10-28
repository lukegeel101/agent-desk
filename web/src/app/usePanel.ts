// Whether a side panel is open; remembered per browser (see panels.tsx).
import { useState } from "react"

export function usePanel(name: "list" | "foryou") {
  const key = `desk-panel:${name}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "closed" } catch { return true } })
  const set = (next: boolean) => {
    setOpen(next)
    try { localStorage.setItem(key, next ? "open" : "closed") } catch { /* private window: not remembered */ }
  }
  return [open, set] as const
}

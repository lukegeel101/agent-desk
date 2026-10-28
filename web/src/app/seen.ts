// Unread replies: a finished reply counts as read once its conversation has been open.
// Stored per browser.
import { useCallback, useState } from "react"

import type { Thread } from "@/shared/desk"

const KEY = "desk-seen-v1"

function load(): Record<string, 1> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}

const finished = (status: string) => status === "done" || status === "failed"

export function useSeen() {
  const [seen, setSeen] = useState(load)
  const unread = useCallback((t: Thread) => t.items.filter((r) => finished(r.status) && !seen[r.id]).length, [seen])
  const markSeen = useCallback((t: Thread) => {
    const fresh = t.items.filter((r) => finished(r.status) && !seen[r.id])
    if (!fresh.length) return
    const next = { ...load(), ...seen }
    for (const r of fresh) next[r.id] = 1
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window: unread resets on reload */ }
    setSeen(next)
  }, [seen])
  return { unread, markSeen }
}

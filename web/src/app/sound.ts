// A short pop when a conversation finishes a reply: it was working (a run in progress) and now
// nothing in it is running or queued. Synthesized with Web Audio, so there is no sound file to load. Chrome only lets
// a page make sound after the user has clicked or typed on it once, so the audio is unlocked on the first gesture.
// The speaker button in the top bar mutes it; the choice is kept in this browser ("desk-sound").
import { useEffect, useRef, useState } from "react"

import type { Thread } from "@/shared/desk"

const KEY = "desk-sound"
let ctx: AudioContext | null = null

function unlock() {
  try {
    ctx = ctx || new AudioContext()
    if (ctx.state === "suspended") void ctx.resume()
  } catch { /* no Web Audio: stay silent */ }
}

export function pop() {
  if (!ctx || ctx.state !== "running") return
  const t = ctx.currentTime
  const osc = ctx.createOscillator(), gain = ctx.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(880, t)
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.09)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.16)
}

function loadOn(): boolean {
  try { return localStorage.getItem(KEY) !== "off" } catch { return true }
}

const working = (t: Thread) => t.items.some((r) => r.status === "running" || r.status === "queued")

// Threads that were working on the previous poll and are not now. The first snapshot only sets the baseline, so
// opening the page never pops for replies that finished while it was closed.
export function finishedSince(before: Map<string, boolean> | null, threads: Thread[]): string[] {
  if (!before) return []
  return threads.filter((t) => before.get(t.id) && !working(t)).map((t) => t.id)
}

export function useFinishPop(threads: Thread[], loaded: boolean) {
  const [on, setOn] = useState(loadOn)
  const prev = useRef<Map<string, boolean> | null>(null)

  useEffect(() => {
    const events = ["pointerdown", "keydown"] as const
    for (const e of events) window.addEventListener(e, unlock, { passive: true })
    return () => { for (const e of events) window.removeEventListener(e, unlock) }
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (on && finishedSince(prev.current, threads).length) pop()
    prev.current = new Map(threads.map((t) => [t.id, working(t)]))
  }, [threads, loaded, on])

  const toggle = () => {
    const next = !on
    setOn(next)
    try { localStorage.setItem(KEY, next ? "on" : "off") } catch { /* private window: back to on after a reload */ }
    if (next) { unlock(); setTimeout(pop, 30) }
  }
  return { on, toggle }
}

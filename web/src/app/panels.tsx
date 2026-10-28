// Collapsible side panels: the conversation list and the "For you" rail each fold into a narrow strip
// that names them, with an arrow to open them again. Open or folded is remembered per browser. No width animation:
// animating width re-lays the page out every frame.
import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

// The small arrow in a panel's header. `side` is where the panel sits: the arrow points the way it folds.
export function FoldButton({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button type="button" onClick={onClick} aria-label={`Hide ${label}`} title={`Hide ${label}`}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
      <Icon className="size-4" />
    </button>
  )
}

// What a folded panel shows: an arrow to open it, its name written sideways, and small badges (counts) below.
export function FoldedStrip({ side, label, onOpen, children, className }: {
  side: "left" | "right"; label: string; onOpen: () => void; children?: ReactNode; className?: string
}) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft
  return (
    <button type="button" onClick={onOpen} aria-label={`Show ${label}`} title={`Show ${label}`}
      className={cn("flex h-full w-11 shrink-0 flex-col items-center gap-3 bg-muted/20 py-3 text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        side === "left" ? "border-r" : "border-l", className)}>
      <Icon className="size-4 shrink-0" />
      <span className="text-xs font-semibold tracking-wide whitespace-nowrap uppercase [writing-mode:vertical-rl]">{label}</span>
      {children && <span className="flex flex-col items-center gap-1.5">{children}</span>}
    </button>
  )
}

// A count on a folded strip: a small coloured pill, hidden when zero.
export function StripCount({ n, tone, title }: { n: number; tone: "amber" | "pink" | "sky"; title: string }) {
  if (!n) return null
  const color = { amber: "bg-amber-500 text-white dark:text-black", pink: "bg-pink-600 text-white", sky: "bg-sky-600 text-white" }[tone]
  return <span title={title} className={cn("min-w-5 rounded-full px-1 text-center text-[10.5px] leading-5 font-semibold tabular-nums", color)}>{n}</span>
}

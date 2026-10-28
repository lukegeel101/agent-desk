// "What you need to do": the steps only the user can take, read from the latest reply's section of that name.
import { inlineMarkdownHtml, type Thread } from "@/shared/desk"
import { markNeedsDone } from "@/shared/actions"
import Alert24 from "./ui/alert-24"
import Button37 from "./ui/button-37"

export function NeedsBox({ t }: { t: Thread }) {
  if (!t.needs) return null
  const n = t.needs
  return (
    <Alert24
      className="ring-1 ring-yellow-500/40"
      title="What you need to do"
      description="From the latest reply."
      action={<Button37 onClick={() => markNeedsDone(n.id)} title="Hide this list; it comes back only if a later reply asks again">Mark done</Button37>}
    >
      <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-snug">
        {n.items.map((item, i) => <li key={i} className="pl-1 [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: inlineMarkdownHtml(item) }} />)}
      </ol>
    </Alert24>
  )
}

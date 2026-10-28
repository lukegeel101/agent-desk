// The pull requests and pages a conversation's replies linked to, behind one "Links · N" button. Pull requests are
// grouped per repository as short numbers; everything else is listed by host and path, newest first.
import { ExternalLink, GitPullRequest, Link2 } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Link, Thread } from "@/shared/desk"
import { allLinks } from "./lib"

function group(links: Link[]) {
  const prs = new Map<string, { n: string; url: string }[]>()
  const other: Link[] = []
  for (const l of links) {
    const pr = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(l.url)
    if (pr) prs.set(pr[1], [...(prs.get(pr[1]) || []), { n: pr[2], url: l.url }])
    else other.push(l)
  }
  return { prs, other }
}

const linkClass = "rounded px-1 font-mono text-[12.5px] text-sky-700 tabular-nums hover:bg-sky-500/10 hover:underline dark:text-sky-300"

export function LinksButton({ t }: { t: Thread }) {
  const links = allLinks(t)
  if (!links.length) return null
  const { prs, other } = group(links)
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-foreground/80 outline-none hover:border-sky-500/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <Link2 className="size-3" /> Links · {links.length}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60vh] w-[380px] gap-3 overflow-y-auto">
        {[...prs.entries()].map(([repo, items]) => (
          <section key={repo}>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <GitPullRequest className="size-3.5" /> {repo} pull requests · {items.length}
            </h3>
            <div className="flex flex-wrap gap-x-0.5 gap-y-1">
              {items.map((p) => <a key={p.url} href={p.url} target="_blank" rel="noopener" title={p.url} className={linkClass}>#{p.n}</a>)}
            </div>
          </section>
        ))}
        {other.length > 0 && (
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ExternalLink className="size-3.5" /> Pages · {other.length}</h3>
            <ul className="space-y-0.5">
              {other.map((l) => (
                <li key={l.url}><a href={l.url} target="_blank" rel="noopener" title={l.url} className="block truncate rounded px-1 text-[12.5px] text-sky-700 hover:bg-sky-500/10 hover:underline dark:text-sky-300">{l.label}</a></li>
              ))}
            </ul>
          </section>
        )}
      </PopoverContent>
    </Popover>
  )
}

#!/usr/bin/env node
// Stands in for the `codex` CLI in tests: answers `--version`, and for `exec` prints `codex exec --json` events and
// writes the session file the real CLI keeps, so the desk can read the context size from it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
if (args[0] === "--version") { process.stdout.write("codex-cli 0.0.0-fake\n"); process.exit(0) }
const prompt = readFileSync(0, "utf8")
const resume = args[1] === "resume"
const session = resume ? args[args.length - 2] : "0a1b2c3d-0000-7000-8000-00000000c0de"
const out = (e) => process.stdout.write(`${JSON.stringify(e)}\n`)

out({ type: "thread.started", thread_id: session })
out({ type: "turn.started" })
out({ type: "item.completed", item: { id: "item_0", type: "error", message: "A notice that is not a failure." } })
out({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "/bin/zsh -lc 'ls'", status: "in_progress" } })
out({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "/bin/zsh -lc 'ls'", exit_code: 0, status: "completed" } })
if (prompt.includes("codexfail")) { out({ type: "turn.failed", error: { message: "The model refused." } }); process.exit(1) }
out({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: `Codex ${resume ? "resumed" : "new"} [${args.join(" ")}] saw: ${prompt}` } })
out({ type: "turn.completed", usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 50 } })

const now = new Date()
const dir = join(process.env.CODEX_HOME, "sessions", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"))
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, `rollout-x-${session}.jsonl`), `${JSON.stringify({ type: "session_meta", payload: {} })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 2600 }, model_context_window: 260000 } } }).replace('"type":"token_count"', '"type":"token_count"')}\n`)

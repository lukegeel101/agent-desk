#!/usr/bin/env node
// Stands in for the `claude` CLI in tests: reads the prompt from stdin and prints stream-json events like a real run.
// The prompt steers it: "sleep" keeps it running until killed, "fail" ends with an error result, "die" exits with no result.
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const prompt = readFileSync(0, "utf8")
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (args.includes("--system-prompt")) { process.stdout.write("Fake Title For Test\n"); process.exit(0) }
const session = flag("--session-id") || flag("--resume")
const model = `claude-${flag("--model")}-5-5`
const out = (e) => process.stdout.write(`${JSON.stringify({ session_id: session, ...e })}\n`)

out({ type: "system", subtype: "init", model })
out({ type: "stream_event", event: { type: "message_start" } })
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Working on it" } } })
out({ type: "assistant", message: { id: "m1", model, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 },
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls", description: "List files" } }] } })
if (prompt.includes("die")) process.exit(3)
if (prompt.includes("sleep")) setInterval(() => {}, 1000)
else {
  const resumed = args.includes("--resume") ? "resumed" : "new"
  const text = prompt.includes("fail") ? "It broke." : `Done (${resumed}): ${prompt.trim()}\n\nSee https://example.com/pr/1.\n\n## What you need to do\n- Approve the PR\n- Sign in to the dashboard`
  out({ type: "result", subtype: "success", is_error: prompt.includes("fail"), result: text, num_turns: 2, duration_ms: 1500,
    total_cost_usd: 0.05, usage: { input_tokens: 200, output_tokens: 40 }, modelUsage: { [model]: { contextWindow: 200000 } },
    permission_denials: prompt.includes("refuse") ? [{ tool_name: "Bash", tool_input: { command: "rm -rf x" } }] : [] })
}

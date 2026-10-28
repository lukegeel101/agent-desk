// Settings come from environment variables (or a .env-style `desk.env` next to package.json), with safe defaults.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw)
    if (!m || raw.trim().startsWith("#")) continue
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2")
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

const tilde = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p)

export const DEFAULT_PROMPT = `You are running inside Agent Desk, a web page where the user hands you tasks and reads your replies later.
Nobody is watching the terminal, so never wait for input: do the task end to end, then reply.
The user's message is their approval for the actions it names, nothing beyond them.
Ask before anything destructive, irreversible, or that publishes or sends something on the user's behalf.
Keep the reply short and lead with the outcome. Link to what you created or changed.
If something only the user can do remains (a sign-in, a decision, an approval), end with a section headed "## What you need to do" that lists those concrete steps, one per bullet. Leave the section out when there is nothing.`

export function loadConfig(env = process.env) {
  loadEnvFile(join(ROOT, "desk.env"))
  const int = (key, fallback) => {
    const n = Number.parseInt(env[key] ?? "", 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const promptFile = env.DESK_SYSTEM_PROMPT_FILE ? tilde(env.DESK_SYSTEM_PROMPT_FILE) : ""
  const config = {
    host: env.DESK_HOST || "127.0.0.1",
    port: int("DESK_PORT", 4280),
    token: env.DESK_TOKEN || "",
    workdir: tilde(env.DESK_WORKDIR || homedir()),
    data: tilde(env.DESK_DATA || join(ROOT, "data")),
    claude: tilde(env.DESK_CLAUDE || "claude"),
    maxParallel: int("DESK_MAX_PARALLEL", 3),
    timeoutSeconds: int("DESK_TIMEOUT_MIN", 60) * 60,
    permissionMode: env.DESK_PERMISSION_MODE || "acceptEdits",
    defaultModel: env.DESK_MODEL || "sonnet",
    effort: env.DESK_EFFORT || "",
    extraArgs: (env.DESK_EXTRA_ARGS || "").split(/\s+/).filter(Boolean),
    autoTitle: env.DESK_AUTO_TITLE !== "0",
    systemPrompt: promptFile ? readFileSync(promptFile, "utf8") : DEFAULT_PROMPT,
    dist: join(ROOT, "web", "dist"),
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(config.host)
  if (!loopback && !config.token) {
    throw new Error(`DESK_HOST is ${config.host}, which other machines can reach, but DESK_TOKEN is empty. Set DESK_TOKEN to a long random string first.`)
  }
  return config
}

export const MODELS = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" }

// Settings come from environment variables (or a .env-style `desk.env` next to package.json), with safe defaults.
import { spawnSync } from "node:child_process"
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
    codex: tilde(env.DESK_CODEX || "codex"),
    codexHome: tilde(env.CODEX_HOME || join(homedir(), ".codex")),
    claudeHome: tilde(env.DESK_CLAUDE_HOME || join(homedir(), ".claude")),
    permissionConfirm: env.DESK_PERMISSION_CONFIRM === "none" ? "none" : "dialog",
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
  config.models = { ...CLAUDE_MODELS, ...openaiModels(env, config) }
  return config
}

// Every model the page offers: alias -> { label, provider, window? }. Claude models run through `claude -p`, OpenAI
// models through `codex exec`, each on that CLI's own sign-in.
export const CLAUDE_MODELS = {
  opus: { label: "Opus", provider: "claude" },
  sonnet: { label: "Sonnet", provider: "claude" },
  haiku: { label: "Haiku", provider: "claude" },
}

// OpenAI models appear only when the Codex CLI is installed. DESK_OPENAI_MODELS names them ("gpt-x=GPT X, gpt-y");
// otherwise the list is the one the Codex CLI itself shows, read from its models cache. DESK_OPENAI_MODELS=off hides them.
function openaiModels(env, config) {
  const setting = (env.DESK_OPENAI_MODELS || "").trim()
  if (setting.toLowerCase() === "off") return {}
  const found = {}
  if (setting) {
    for (const part of setting.split(",")) {
      const [id, label] = part.split("=").map((x) => x.trim())
      if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id || "")) found[id] = { label: label || id, provider: "openai" }
    }
  }
  let cache = []
  try { cache = JSON.parse(readFileSync(join(config.codexHome, "models_cache.json"), "utf8")).models || [] } catch { /* no cache */ }
  for (const m of cache) {
    if (!m || typeof m.slug !== "string") continue
    if (found[m.slug]) found[m.slug].window = Number(m.context_window) || undefined
    else if (!setting && m.visibility === "list") found[m.slug] = { label: m.display_name || m.slug, provider: "openai", window: Number(m.context_window) || undefined }
  }
  if (!Object.keys(found).length) return {}
  try {
    const probe = spawnSync(config.codex, ["--version"], { timeout: 10000, stdio: "ignore" })
    if (probe.error || probe.status !== 0) return {}
  } catch { return {} }
  return found
}

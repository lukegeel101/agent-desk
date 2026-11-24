// Add permission: writes Claude Code permission rules (and auto-mode sentences) into a settings file from the page, so
// a refused action can be allowed without opening a terminal or editing JSON by hand.
//
// Safety: anything on this computer can reach the desk's local API, including the agents it runs. So a rule is never
// written on the strength of the HTTP request alone. The server shows a dialog on this computer's own screen listing
// every entry and the file, and writes only when someone clicks Add there. A background run can call the endpoint but
// cannot click the dialog, so it cannot grant itself a permission that was refused. DESK_PERMISSION_CONFIRM=none
// turns the dialog off, for a headless machine where you accept that trade.
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const KINDS = ["allow", "ask", "deny"]
// A tool name, optionally with one parenthesised specifier (which may itself contain one level of parentheses).
const RULE = /^[A-Za-z][A-Za-z0-9_.-]*(\((?:[^()\n]|\([^()\n]*\))+\))?$/
const TOO_BROAD = new Set(["Bash", "Bash(*)", "Bash(:*)", "Bash(**)"])
const MAX_RULES = 20, MAX_SENTENCES = 3, MAX_SENTENCE = 2000
const DIALOG_SECONDS = 120

const tildeOf = (path) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)

// Where the desk keeps the rules that apply to its own runs only. Each Claude run is started with `--settings <file>`,
// so they work in any folder (a folder's own .claude/settings.json is ignored until that folder is trusted in Claude
// Code) and leave your interactive sessions alone.
export const deskSettingsFile = (config) => join(config.data, "claude-settings.json")

export function scopes(config) {
  return [
    { id: "desk", label: "This desk's runs only", file: deskSettingsFile(config) },
    { id: "user", label: "User settings (every project and session)", file: join(config.claudeHome, "settings.json") },
    { id: "project", label: "This folder, shared (.claude/settings.json)", file: join(config.workdir, ".claude", "settings.json") },
    { id: "local", label: "This folder, only me (.claude/settings.local.json)", file: join(config.workdir, ".claude", "settings.local.json") },
  ].map((s) => ({ ...s, path: tildeOf(s.file) }))
}

// How a write is confirmed on this machine: "dialog" (macOS, or Linux with zenity), "none" (switched off by the
// owner) or "unavailable" (no way to ask, so nothing is written).
export function confirmKind(config, platform = process.platform, has = hasCommand) {
  if (config.permissionConfirm === "none") return "none"
  if (platform === "darwin") return "dialog"
  return platform === "linux" && has("zenity") ? "dialog" : "unavailable"
}

function hasCommand(name) {
  return (process.env.PATH || "").split(":").some((dir) => dir && existsSync(join(dir, name)))
}

// Resolves true only when someone clicks Add in the dialog (Cancel, closing it or waiting it out is a no).
export function confirmDialog(message, platform = process.platform) {
  const args = platform === "darwin"
    ? ["osascript", "-e", "on run argv", "-e",
        `display dialog (item 1 of argv) with title "Agent Desk: add Claude Code permissions" buttons {"Cancel", "Add"} default button "Cancel" cancel button "Cancel" with icon caution giving up after ${DIALOG_SECONDS}`,
        "-e", "return button returned of result", "-e", "end run", message]
    : ["zenity", "--question", "--title=Agent Desk: add Claude Code permissions", "--ok-label=Add", "--cancel-label=Cancel",
        "--default-cancel", `--timeout=${DIALOG_SECONDS}`, "--no-markup", "--width=560", `--text=${message}`]
  return new Promise((resolve) => {
    let out = ""
    let child
    try { child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "ignore"] }) } catch { return resolve(false) }
    const timer = setTimeout(() => child.kill("SIGKILL"), (DIALOG_SECONDS + 15) * 1000)
    child.stdout.on("data", (b) => { out += b })
    child.on("error", () => { clearTimeout(timer); resolve(false) })
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && (platform !== "darwin" || out.trim() === "Add")) })
  })
}

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {})

// Back the file up, read it again (it may have changed while the dialog was up), apply the change, write atomically.
function write(file, change) {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.bak-desk-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`)
  const data = read(file)
  change(data)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, file)
  return read(file)
}

const list = (value) => (Array.isArray(value) ? value : [])
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

// { ok, message }. Validates, asks for the on-screen confirmation, then adds each entry once and reads it back.
export async function addPermissions(config, payload, { confirm = confirmDialog, kindOfConfirm = confirmKind(config) } = {}) {
  const kind = String(payload.kind || "allow")
  const scope = scopes(config).find((s) => s.id === String(payload.scope || "desk"))
  if (!scope) return { ok: false, message: "Pick where the rules go." }
  if (!KINDS.includes(kind)) return { ok: false, message: "Pick allow, ask or deny." }
  const rules = [...new Set(list(payload.rules).map((r) => String(r).trim()).filter(Boolean))]
  const sentences = [...new Set(list(payload.autoMode).map((t) => String(t).replace(/\s+/g, " ").trim()).filter(Boolean))]
  if (!rules.length && !sentences.length) return { ok: false, message: "Add at least one rule or auto-mode sentence." }
  if (rules.length > MAX_RULES || sentences.length > MAX_SENTENCES) return { ok: false, message: `At most ${MAX_RULES} rules and ${MAX_SENTENCES} auto-mode sentences at a time.` }
  for (const rule of rules) {
    if (rule.length > 400 || !RULE.test(rule)) return { ok: false, message: `"${rule.slice(0, 80)}" does not look like a rule. Use Tool or Tool(specifier), for example Bash(npm test *).` }
    if (kind === "allow" && TOO_BROAD.has(rule.replace(/\s+/g, ""))) return { ok: false, message: `Refused "${rule}": allowing every shell command would switch the safety check off. Name the command, for example Bash(npm test *).` }
  }
  // eslint-disable-next-line no-control-regex
  if (sentences.some((t) => t.length < 10 || t.length > MAX_SENTENCE || /[\u0000-\u001f]/.test(t))) return { ok: false, message: `Each auto-mode sentence must be plain text of 10 to ${MAX_SENTENCE} characters.` }
  const user = scopes(config).find((s) => s.id === "user") // auto-mode sentences always live in user settings
  let newRules, newAuto
  try {
    const haveRules = list(read(scope.file).permissions?.[kind])
    const haveAuto = list(read(user.file).autoMode?.allow)
    newRules = rules.filter((r) => !haveRules.includes(r))
    newAuto = sentences.filter((t) => !haveAuto.includes(t))
  } catch { return { ok: false, message: "A settings file is not valid JSON. Fix it before adding permissions." } }
  if (!newRules.length && !newAuto.length) return { ok: true, message: "Everything is already there." }

  if (kindOfConfirm === "unavailable") {
    return { ok: false, message: "Not added: this computer has no way to show the confirmation dialog (install zenity, or set DESK_PERMISSION_CONFIRM=none to add without one)." }
  }
  if (kindOfConfirm === "dialog") {
    const parts = ["Add these Claude Code permissions?"]
    if (newRules.length) parts.push(`permissions.${kind} in ${scope.path}:\n${newRules.map((r) => `  ${r}`).join("\n")}`)
    if (newAuto.length) parts.push(`autoMode.allow in ${user.path}:\n${newAuto.map((t) => `  ${t}`).join("\n\n")}`)
    parts.push("Requested from the Agent Desk page. Click Add only if you asked for this.")
    if (!(await confirm(parts.join("\n\n")))) return { ok: false, message: "Not added: it was cancelled or not confirmed on the computer's screen within 2 minutes." }
  }
  try {
    if (newRules.length) {
      const back = list(write(scope.file, (data) => {
        const perms = (data.permissions && typeof data.permissions === "object") ? data.permissions : (data.permissions = {})
        const bucket = Array.isArray(perms[kind]) ? perms[kind] : (perms[kind] = [])
        for (const r of newRules) if (!bucket.includes(r)) bucket.push(r)
      }).permissions?.[kind])
      if (newRules.some((r) => !back.includes(r))) return { ok: false, message: `Written, but a rule did not read back. Check ${scope.path}.` }
    }
    if (newAuto.length) {
      const back = list(write(user.file, (data) => {
        const auto = (data.autoMode && typeof data.autoMode === "object") ? data.autoMode : (data.autoMode = {})
        const bucket = Array.isArray(auto.allow) ? auto.allow : (auto.allow = [])
        for (const t of newAuto) if (!bucket.includes(t)) bucket.push(t)
      }).autoMode?.allow)
      if (newAuto.some((t) => !back.includes(t))) return { ok: false, message: `Written, but a sentence did not read back. Check ${user.path}.` }
    }
  } catch (e) { return { ok: false, message: `Could not write the settings: ${e.message}` } }
  const said = []
  if (newRules.length) said.push(`${plural(newRules.length, "rule")} to ${scope.path} (${kind})`)
  if (newAuto.length) said.push(`${plural(newAuto.length, "auto-mode sentence")} to ${user.path}`)
  const trust = newRules.length && (scope.id === "project" || scope.id === "local")
    ? " Claude Code reads a folder's own settings only once that folder is trusted: if runs are still refused, open Claude Code in it once and accept the trust prompt, or use \"This desk's runs only\"." : ""
  return { ok: true, message: `Added ${said.join(" and ")}. The next message picks ${newRules.length + newAuto.length === 1 ? "it" : "them"} up.${trust}` }
}

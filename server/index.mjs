// Agent Desk server: serves the built page from web/dist and a small JSON API, and runs the queue.
//
// Safety: it listens on 127.0.0.1 unless DESK_HOST says otherwise, and then refuses to start without DESK_TOKEN.
// Every write must carry the X-Desk header, which forces a CORS preflight this server never approves, so other
// websites open in the same browser cannot post to it.
import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { timingSafeEqual } from "node:crypto"

import { loadConfig } from "./config.mjs"
import { Desk } from "./desk.mjs"
import { Store } from "./store.mjs"

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json",
}
const COOKIE = "desk_token"

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers,
  })
  res.end(data)
}

function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > limit) { reject(new Error("too large")); req.destroy() } else chunks.push(c)
    })
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")) } catch { reject(new Error("bad json")) }
    })
    req.on("error", reject)
  })
}

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

function cookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return ""
}

export function createDesk(config = loadConfig()) {
  const store = new Store(config.data)
  const desk = new Desk(config, store)

  // With DESK_TOKEN set, open the page once as /?token=<token>; it stores the token in a cookie and drops it from the URL.
  function authorized(req, url) {
    if (!config.token) return true
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    return [cookie(req, COOKIE), bearer, url.searchParams.get("token") || ""].some((t) => t && same(t, config.token))
  }

  function staticFile(res, pathname) {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "")
    let file = join(config.dist, rel)
    if (!file.startsWith(config.dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(config.dist, "index.html")
    if (!existsSync(file)) {
      return send(res, 503, "The page is not built yet. Run `npm run setup` in the agent-desk folder, then reload.")
    }
    const immutable = rel.startsWith("/assets/") || rel.startsWith("assets/")
    send(res, 200, readFileSync(file), {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-store",
    })
  }

  const actions = {
    "/api/send": (b) => desk.send(b),
    "/api/stop": (b) => desk.stop(String(b.id || "")),
    "/api/title": (b) => desk.setTitle(String(b.thread || ""), b.title),
    "/api/model": (b) => desk.setModel(String(b.model || "")),
    "/api/needs-done": (b) => desk.needsDone(String(b.id || "")),
    "/api/archive": (b) => desk.archive(String(b.thread || ""), b.archived !== false),
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://desk.local")
    if (!authorized(req, url)) return send(res, 401, "Open this page once with ?token=<your DESK_TOKEN>.")
    if (config.token && url.searchParams.get("token")) {
      res.writeHead(303, {
        Location: url.pathname,
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(config.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      })
      return res.end()
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, desk.snapshot())
      const detail = /^\/api\/request\/([a-f0-9]{6,32})$/.exec(url.pathname)
      if (req.method === "GET" && detail) {
        const d = desk.detail(detail[1])
        return d ? send(res, 200, d) : send(res, 404, { ok: false, message: "Unknown message." })
      }
      if (req.method === "POST" && actions[url.pathname]) {
        if (req.headers["x-desk"] !== "1") return send(res, 403, { ok: false, message: "Missing X-Desk header." })
        const result = actions[url.pathname](await readBody(req))
        return send(res, result.ok ? 200 : 400, result)
      }
      if (url.pathname.startsWith("/api/")) return send(res, 404, { ok: false, message: "Not found." })
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed.")
      return staticFile(res, url.pathname)
    } catch (e) {
      return send(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  })

  return { server, desk, store, config }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, desk, config } = createDesk()
  desk.recover()
  server.listen(config.port, config.host, () => {
    console.log(`Agent Desk on http://${config.host}:${config.port}  (runs in ${config.workdir}, ${config.maxParallel} at once, permission mode ${config.permissionMode})`)
  })
  const shutdown = () => { desk.stopAll(); server.close(); setTimeout(() => process.exit(0), 300) }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

// All state lives in one JSON file, written atomically (temp file, then rename) after every change.
// Each run's raw event stream goes to runs/<id>.jsonl and its error output to runs/<id>.err.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const EMPTY = () => ({ requests: [], titles: {}, needsDone: {}, archived: {}, model: "" })

export class Store {
  constructor(dir) {
    this.dir = dir
    this.runs = join(dir, "runs")
    mkdirSync(this.runs, { recursive: true })
    this.file = join(dir, "state.json")
    this.state = EMPTY()
    if (existsSync(this.file)) this.state = { ...EMPTY(), ...JSON.parse(readFileSync(this.file, "utf8")) }
  }

  save() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state))
    renameSync(tmp, this.file)
  }

  get requests() { return this.state.requests } // oldest first
  find(id) { return this.state.requests.find((r) => r.id === id) }
  thread(id) { return this.state.requests.filter((r) => r.thread === id) }

  add(request) { this.state.requests.push(request); this.save(); return request }
  update(id, patch) {
    const r = this.find(id)
    if (r) { Object.assign(r, patch); this.save() }
    return r
  }

  runFile(id) { return join(this.runs, `${id}.jsonl`) }
  errFile(id) { return join(this.runs, `${id}.err`) }
}

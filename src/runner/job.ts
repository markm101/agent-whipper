// One job, start to finish: check out each commit, note which verifier files
// the commit under test changed, copy the frozen files over every checkout,
// run the tests, then the benchmark alternating between commits, and send
// what happened. The lease is renewed throughout; if the server says the job
// was cancelled or taken away, the job stops and sends nothing.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Run } from '../shared/api.ts'
import type { Ticket } from '../server/domain/commands.ts'
import type { JobResults } from '../server/domain/records.ts'
import { safePath } from '../server/verifiers.ts'
import type { Box, Executor } from './exec.ts'
import type { Exit } from './proc.ts'

export type Claimed = Ticket & { files: Record<string, string> }

export interface Api {
  claim(runner: string, labels: string[]): Promise<Claimed | null>
  /** False once the runner no longer holds a running job. */
  renew(job: string, runner: string): Promise<boolean>
  results(job: string, runner: string, results: JobResults): Promise<void>
}

export interface JobDeps {
  api: Api
  executor: Executor
  checkout(repo: string, commit: string, into: string): Promise<void>
  runner: string
  work: string
  defaultRepo: string | null
  renewEveryMs: number
  log(message: string): void
}

/** The last line of output that parses as a JSON object. */
export function lastJson(out: string): Record<string, unknown> | null {
  const lines = out.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{')) continue
    try {
      const v = JSON.parse(line) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {}
  }
  return null
}

/**
 * A test command's result: the counts it prints as {"passed": n, "total": m},
 * or one test that passed if it exited 0. A nonzero exit always counts as at
 * least one failure, whatever it printed.
 */
export function testCount(r: Exit): { passed: number; total: number } {
  const j = lastJson(r.stdout)
  const counted = j && Number.isInteger(j.passed) && Number.isInteger(j.total) && (j.total as number) >= (j.passed as number) && (j.passed as number) >= 0
  let passed = counted ? (j.passed as number) : r.code === 0 ? 1 : 0
  let total = counted ? (j.total as number) : 1
  if (r.code !== 0) {
    total = Math.max(total, 1)
    passed = Math.min(passed, total - 1)
  }
  return { passed, total }
}

/** One benchmark run: the {"value": n, "work": m} line it prints. */
export function benchRun(r: Exit): { value: number; work: number } | null {
  if (r.code !== 0) return null
  const j = lastJson(r.stdout)
  if (!j || typeof j.value !== 'number' || !Number.isFinite(j.value)) return null
  const work = typeof j.work === 'number' && Number.isFinite(j.work) && j.work >= 0 ? j.work : 0
  return { value: j.value, work }
}

class Killed extends Error {}
class Lost extends Error {}

export async function runJob(t: Claimed, d: JobDeps): Promise<void> {
  const dir = join(d.work, 'jobs', t.job)
  const lost = new AbortController()
  const deadline = Date.now() + t.timeLimitMinutes * 60_000
  const boxes: Box[] = []
  const renew = setInterval(() => {
    d.api.renew(t.job, d.runner).then(
      (held) => held || lost.abort(),
      (e) => d.log(`couldn't renew the lease on ${t.job}: ${(e as Error).message}`),
    )
  }, d.renewEveryMs)

  const exec = async (box: Box, command: string) => {
    const left = deadline - Date.now()
    if (left <= 0) throw new Killed()
    const r = await box.exec(command, left, lost.signal)
    if (r.aborted) throw new Lost()
    if (r.timedOut) throw new Killed()
    return r
  }

  let results: JobResults | null
  try {
    const repo = t.repo ?? d.defaultRepo
    if (!repo) throw new Error('The project names no repo, and the runner has no WHIP_REPO.')
    for (const path of Object.keys(t.files)) if (!safePath(path)) throw new Error(`Refusing the verifier path ${path}.`)

    // Check out each commit, and note the verifier files the commit under test changed
    const commits = [...new Set([...t.commits, t.commit])]
    const dirs = new Map(commits.map((c) => [c, join(dir, c)]))
    for (const c of commits) await d.checkout(repo, c, dirs.get(c)!)
    const touched = Object.keys(t.files).filter((p) => {
      const file = join(dirs.get(t.commit)!, p)
      return existsSync(file) && readFileSync(file, 'utf8') !== t.files[p]
    })
    for (const c of commits)
      for (const [p, content] of Object.entries(t.files)) {
        const file = join(dirs.get(c)!, p)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }

    const box = new Map<string, Box>()
    for (const c of commits) {
      const b = await d.executor.open(dirs.get(c)!, t)
      boxes.push(b)
      box.set(c, b)
    }

    // Tests on the commit under test; a failure ends the job, since its verdict can't change
    const tests = { passed: 0, total: 0 }
    for (const command of t.tests) {
      const r = testCount(await exec(box.get(t.commit)!, command))
      tests.passed += r.passed
      tests.total += r.total
    }
    const runs: Run[] = []
    if (tests.passed === tests.total) {
      bench: for (let i = 0; i < t.runs; i++)
        for (const c of t.commits) {
          const r = benchRun(await exec(box.get(c)!, t.benchmark))
          if (!r) {
            // The commit under test broke the benchmark: report no runs for it, which judges it a fail
            if (c === t.commit) {
              runs.splice(0, runs.length, ...runs.filter((x) => x.commit !== c))
              break bench
            }
            throw new Error(`The benchmark failed on ${c}, the commit it's measured against.`)
          }
          runs.push({ commit: c as Run['commit'], value: r.value, work: r.work })
        }
    }
    results = { outcome: 'done', tests, runs, touched }
  } catch (e) {
    if (e instanceof Lost) {
      d.log(`${t.job} was cancelled or taken away; stopping`)
      results = null
    } else if (e instanceof Killed) results = { outcome: 'killed', tests: null, runs: [], touched: [] }
    else {
      const message = (e as Error).message
      d.log(`${t.job} couldn't run: ${message}`)
      results = { outcome: 'error', tests: null, runs: [], touched: [], error: message.slice(0, 500) }
    }
  } finally {
    clearInterval(renew)
    await Promise.all(boxes.map((b) => b.close().catch(() => {})))
    rmSync(dir, { recursive: true, force: true })
  }
  if (results) await d.api.results(t.job, d.runner, results)
}

export function createApi(base: string, token: string, fetchImpl: typeof fetch = fetch): Api {
  const post = async (path: string, body: unknown) => {
    const res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
  }
  return {
    async claim(runner, labels) {
      const r = await post('/jobs/claim', { runner, labels })
      if (r.status === 204) return null
      if (r.status !== 200) throw new Error(`claim answered ${r.status}: ${r.json?.message ?? ''}`)
      return r.json as unknown as Claimed
    },
    async renew(job, runner) {
      const r = await post(`/jobs/${job}/lease`, { runner })
      if (r.status === 409 || r.status === 404) return false
      if (r.status !== 200) throw new Error(`lease answered ${r.status}`)
      return r.json?.state === 'running'
    },
    async results(job, runner, results) {
      // Results are idempotent on the server, so a retry after a network error is safe
      for (let attempt = 1; ; attempt++) {
        const r = await post(`/jobs/${job}/results`, { runner, ...results }).catch((e: Error) => ({ status: 0, json: { message: e.message } }))
        // 409: the job was taken away, so these results no longer count
        if (r.status === 200 || r.status === 409) return
        if ((r.status >= 400 && r.status < 500) || attempt >= 5) throw new Error(`results answered ${r.status}: ${r.json?.message ?? ''}`)
        await new Promise((done) => setTimeout(done, 2000 * attempt))
      }
    },
  }
}

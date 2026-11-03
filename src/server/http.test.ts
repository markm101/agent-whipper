import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { Board } from '../shared/api.ts'
import { MINUTE } from './domain/records.ts'
import { createHandler } from './http.ts'
import { createService } from './service.ts'
import { openStore } from './store.ts'

const dir = mkdtempSync(join(tmpdir(), 'whip-http-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const dashboard = join(dir, 'dashboard')
mkdirSync(join(dashboard, 'assets'), { recursive: true })
writeFileSync(join(dashboard, 'index.html'), '<!doctype html><title>Agent Whipper</title>')
writeFileSync(join(dashboard, 'assets', 'app.js'), 'console.log(1)')

// Stops every server, including one whose test failed partway
const running: (() => Promise<void>)[] = []
after(() => Promise.all(running.map((stop) => stop())))

const TOKENS = { agent: 'agent-token-0123456789', runner: 'runner-token-0123456789', admin: 'admin-token-0123456789' }
let now = Date.parse('2026-11-03T00:00:00Z')
const tick = (minutes: number) => (now += minutes * MINUTE)

async function boot(db: string) {
  const store = openStore(db)
  const server: Server = createServer(createHandler({ service: createService(store, undefined, () => now), tokens: TOKENS, dashboard }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, opts: { token?: keyof typeof TOKENS | null; body?: unknown; headers?: Record<string, string> } = {}) => {
    const token = opts.token === undefined ? 'agent' : opts.token
    const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${TOKENS[token]}` } : {}), ...opts.headers }
    if (opts.body !== undefined) headers['content-type'] = typeof opts.body === 'string' ? 'text/plain' : 'application/json'
    const res = await fetch(base + path, { method, headers, ...(opts.body !== undefined ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) } : {}) })
    const text = await res.text()
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, type, text, headers: res.headers, json: type.includes('json') ? JSON.parse(text) : null }
  }
  let stopped: Promise<void> | null = null
  const stop = () =>
    (stopped ??= new Promise<void>((r) => {
      server.close(() => (store.close(), r()))
      server.closeAllConnections()
    }))
  running.push(stop)
  return { call, stop }
}

const START = 'aaaaaaaaaaaa'
const NEXT = 'bbbbbbbbbbbb'
const VERIFIERS = {
  author: 'verifier',
  image: 'node:26-slim',
  files: { 'bench/latency.js': 'console.log(JSON.stringify({ value: 100, work: 1 }))', 'test/regression.test.js': 'ok' },
  commands: { regression: 'node --test test/regression.test.js', steps: ['node --test test/step-1.test.js'], benchmark: 'node bench/latency.js' },
  hardware: 'cpu',
  timeLimitMinutes: 20,
}
const runs = (commit: string, value: number) => [0, 1, -1, 2, -2].map((k) => ({ commit, value: value + k * 0.2, work: 1000 }))

test('agents, runners and the admin drive a module through HTTP, and the data survives a restart', async () => {
  const db = join(dir, 'whip.db')
  let s = await boot(db)

  // Tokens
  const anonymous = await s.call('GET', '/api/board', { token: null })
  assert.equal(anonymous.status, 401)
  assert.match(anonymous.headers.get('www-authenticate') ?? '', /^Basic /, 'a browser resends the admin password it gave for the page')
  // The browser's fetch carries the admin password as Basic auth
  const viaBrowser = await s.call('GET', '/api/board', { token: null, headers: { authorization: `Basic ${Buffer.from(`me:${TOKENS.admin}`).toString('base64')}` } })
  assert.equal(viaBrowser.status, 200)
  assert.equal((await s.call('POST', '/jobs/claim', { body: { runner: 'r1', labels: ['cpu'] } })).status, 403)
  assert.equal((await s.call('GET', '/api/board', { token: 'agent' })).status, 403)
  assert.equal((await s.call('GET', '/healthz', { token: null })).text, 'ok\n')

  const created = await s.call('POST', '/agents/1/projects', {
    body: { title: 'search-perf', startCommit: START, repo: 'https://git.example/search.git', modules: [{ title: 'query cache', steps: ['Cache parsed queries'], goal: { metric: 'p95 latency', unit: 'ms', direction: 'lower', targetGain: 10 } }] },
  })
  assert.deepEqual(created.json, { state: 'open', modules: ['m1'] })
  const tooBold = await s.call('POST', '/agents/1/modules', { body: { title: 'x', steps: ['a'], goal: { metric: 'm', unit: 'ms', direction: 'lower', targetGain: 40 } } })
  assert.equal(tooBold.status, 400)
  assert.equal(tooBold.json.error, 'badSpec')
  assert.equal((await s.call('PUT', '/agents/1/blurb', { body: 'Caching parsed queries.' })).status, 200)

  const badPath = await s.call('POST', '/agents/1/modules/m1/verifiers', { body: { ...VERIFIERS, files: { '../escape.sh': 'x' } } })
  assert.equal(badPath.status, 400)
  const frozen = await s.call('POST', '/agents/1/modules/m1/verifiers', { body: VERIFIERS })
  assert.equal(frozen.status, 200)
  assert.match(frozen.json.hash, /^[0-9a-f]{16}$/)

  // The baseline job, with the frozen files and the project's remote
  const claim = await s.call('POST', '/jobs/claim', { token: 'runner', body: { runner: 'r1', labels: ['cpu'] } })
  assert.equal(claim.json.kind, 'baseline')
  assert.equal(claim.json.repo, 'https://git.example/search.git')
  assert.deepEqual(claim.json.files, VERIFIERS.files)
  assert.equal((await s.call('POST', '/jobs/claim', { token: 'runner', body: { runner: 'r1', labels: ['cpu'] } })).status, 204)
  tick(1)
  assert.equal((await s.call('POST', `/jobs/${claim.json.job}/lease`, { token: 'runner', body: { runner: 'r1' } })).json.state, 'running')
  const landed = await s.call('POST', `/jobs/${claim.json.job}/results`, { token: 'runner', body: { runner: 'r1', outcome: 'done', tests: { passed: 4, total: 4 }, runs: runs(START, 100), touched: [] } })
  assert.deepEqual(landed.json, { state: 'done' })

  const line = await s.call('GET', '/agents/1')
  assert.equal(line.type, 'text/plain; charset=utf-8')
  assert.equal(line.text, 'agent 1: Project: search-perf, Module (1 / 1): query cache, Progress: 0 / 1, Blurb: Caching parsed queries. Goal: p95 latency 100 -> 90 ms, 10% lower. 90 min left.\n')

  tick(5)
  const posted = await s.call('POST', '/agents/1/modules/m1/attempts', { body: { attemptId: 'a1', commit: NEXT, note: 'Cache parsed query trees.' } })
  assert.deepEqual([posted.json.job, posted.json.verdict, posted.json.module.state], ['queued', null, 'active'])
  const busy = await s.call('POST', '/agents/1/modules/m1/attempts', { body: { attemptId: 'a2', commit: 'cccccccccccc', note: 'Too soon.' } })
  assert.deepEqual([busy.status, busy.json.error], [409, 'jobInFlight'])
  const job = (await s.call('POST', '/jobs/claim', { token: 'runner', body: { runner: 'r1', labels: ['cpu'] } })).json
  assert.deepEqual(job.commits, [START, NEXT])
  tick(1)
  await s.call('POST', `/jobs/${job.job}/results`, { token: 'runner', body: { runner: 'r1', outcome: 'done', tests: { passed: 4, total: 4 }, runs: runs(START, 100).flatMap((x, i) => [x, runs(NEXT, 88)[i]]) } })
  const judged = await s.call('GET', '/agents/1/modules/m1/attempts/a1')
  assert.deepEqual([judged.json.verdict, judged.json.module.state], ['win', 'passed'])

  // The dashboard's JSON and attempt detail, with the admin token
  const board = (await s.call('GET', '/api/board', { token: 'admin' })).json as Board
  assert.equal(board.agents[0]!.project!.modules[0]!.best, 88)
  const detail = await s.call('GET', '/api/agents/1/modules/m1/attempts/a1', { token: 'admin' })
  assert.equal(detail.json.runs.length, 10)
  assert.equal(detail.json.runner, 'r1')

  // A browser gets the dashboard, with the admin token as the Basic password
  const html = { accept: 'text/html' }
  assert.equal((await s.call('GET', '/agents/1', { token: null, headers: html })).status, 401)
  const basic = `Basic ${Buffer.from(`me:${TOKENS.admin}`).toString('base64')}`
  const page = await s.call('GET', '/agents/1', { token: null, headers: { ...html, authorization: basic } })
  assert.equal(page.status, 200)
  assert.match(page.text, /<title>Agent Whipper/)
  const asset = await s.call('GET', '/assets/app.js', { token: null, headers: { authorization: basic } })
  assert.match(asset.type, /javascript/)
  assert.equal((await s.call('GET', '/assets/..%2F..%2Fwhip.db', { token: null, headers: { authorization: basic } })).text.includes('SQLite'), false)

  // Restart: everything comes back from the database
  const before = (await s.call('GET', '/board')).text
  await s.stop()
  s = await boot(db)
  assert.equal((await s.call('GET', '/board')).text, before)
  assert.equal((await s.call('GET', '/agents/1/modules/m1/attempts/a1')).json.verdict, 'win')
  await s.stop()
})

test('change requests merge over the frozen files and wait for the admin', async () => {
  const s = await boot(join(dir, 'changes.db'))
  await s.call('POST', '/agents/2/projects', {
    body: { title: 'ingest', startCommit: START, modules: [{ title: 'batch writes', steps: ['Batch inserts'], goal: { metric: 'throughput', unit: 'docs/s', direction: 'higher', targetGain: 10 } }] },
  })
  assert.equal((await s.call('POST', '/agents/2/modules/m1/verifiers/changes', { body: { reason: 'Too early.', files: {} } })).json.error, 'verifiersMissing')
  const { hash } = (await s.call('POST', '/agents/2/modules/m1/verifiers', { body: VERIFIERS })).json
  const filed = await s.call('POST', '/agents/2/modules/m1/verifiers/changes', {
    body: { reason: 'The benchmark reads a cold cache on its first run.', files: { 'bench/latency.js': 'warm(); bench()', 'test/regression.test.js': null } },
  })
  assert.equal(filed.status, 200)
  const change = filed.json.change
  assert.equal((await s.call('GET', `/agents/2/modules/m1/verifiers/changes/${change}`)).json.state, 'open')
  const board = (await s.call('GET', '/api/board', { token: 'admin' })).json as Board
  assert.deepEqual(board.agents[0]!.project!.modules[0]!.changes[0]!.files, ['bench/latency.js', 'test/regression.test.js'])

  assert.equal((await s.call('POST', `/admin/changes/${change}`, { body: { approve: true } })).status, 403)
  assert.deepEqual((await s.call('POST', `/admin/changes/${change}`, { token: 'admin', body: { approve: true } })).json, { state: 'approved' })
  // The baseline queued before the approval keeps the verifiers it was queued with
  const first = (await s.call('POST', '/jobs/claim', { token: 'runner', body: { runner: 'r1', labels: ['cpu'] } })).json
  assert.equal(first.verifierHash, hash)
  await s.call('POST', `/jobs/${first.job}/results`, { token: 'runner', body: { runner: 'r1', outcome: 'done', tests: { passed: 3, total: 4 }, runs: [] } })
  // It failed, so the module measures its baseline again on the approved set
  const claim = (await s.call('POST', '/jobs/claim', { token: 'runner', body: { runner: 'r1', labels: ['cpu'] } })).json
  assert.notEqual(claim.verifierHash, hash)
  assert.deepEqual(claim.files, { 'bench/latency.js': 'warm(); bench()' })
  const files = await s.call('GET', `/admin/verifiers/${hash}`, { token: 'admin' })
  assert.deepEqual(files.json, VERIFIERS.files)
  await s.stop()
})

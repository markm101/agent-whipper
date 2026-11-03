import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { Board } from '../shared/api.ts'
import { createHandler } from '../server/http.ts'
import { createService } from '../server/service.ts'
import { openStore } from '../server/store.ts'
import { dockerExecutor, localExecutor, type Executor } from './exec.ts'
import { createGit } from './git.ts'
import { benchRun, createApi, lastJson, runJob, testCount, type JobDeps } from './job.ts'

const root = mkdtempSync(join(tmpdir(), 'whip-runner-'))
after(() => rmSync(root, { recursive: true, force: true }))
const TOKENS = { agent: 'agent-token-0123456789', runner: 'runner-token-0123456789', admin: 'admin-token-0123456789' }

test('test and benchmark output parse the way DESIGN.md describes', () => {
  const exit = (code: number, stdout: string) => ({ code, stdout, stderr: '', timedOut: false, aborted: false })
  assert.deepEqual(lastJson('noise\n{"a": 1}\n{"b": 2}\nmore noise'), { b: 2 })
  assert.deepEqual(testCount(exit(0, 'ok')), { passed: 1, total: 1 })
  assert.deepEqual(testCount(exit(0, '{"passed": 40, "total": 42}')), { passed: 40, total: 42 })
  assert.deepEqual(testCount(exit(1, '{"passed": 42, "total": 42}')), { passed: 41, total: 42 }, 'a nonzero exit is a failure, whatever it prints')
  assert.deepEqual(testCount(exit(2, '')), { passed: 0, total: 1 })
  assert.deepEqual(benchRun(exit(0, 'warming up\n{"value": 331, "work": 12000}')), { value: 331, work: 12000 })
  assert.equal(benchRun(exit(1, '{"value": 331, "work": 12000}')), null)
  assert.equal(benchRun(exit(0, 'no json')), null)
})

/** A repo with a start commit and three attempts, one of which edits the benchmark. */
function repo(name: string) {
  const dir = join(root, name)
  mkdirSync(dir)
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.email', 'agent@example.com')
  git('config', 'user.name', 'agent')
  const commit = (files: Record<string, string>, message: string) => {
    for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c)
    git('add', '-A')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const start = commit({ 'value.txt': '100', 'app.txt': 'base' }, 'start')
  const faster = commit({ 'value.txt': '94', 'app.txt': 'base feature' }, 'faster')
  // Edits the benchmark to report 1; the frozen copy measures 85
  const cheat = commit({ 'value.txt': '85', 'bench.sh': `echo '{"value": 1, "work": 100}'` }, 'cheat')
  return { url: `file://${dir}`, start, faster, cheat }
}

const VERIFIERS = {
  author: 'verifier',
  files: {
    'bench.sh': `echo "{\\"value\\": $(cat value.txt), \\"work\\": 100}"`,
    'test.sh': `test -f app.txt && echo '{"passed": 3, "total": 3}'`,
    'step1.sh': 'grep -q feature app.txt',
  },
  commands: { regression: 'sh test.sh', steps: ['sh step1.sh', 'sh step1.sh'], benchmark: 'sh bench.sh' },
  hardware: 'cpu',
  timeLimitMinutes: 5,
}

async function scenario(name: string, executor: Executor, image: string) {
  const r = repo(name)
  const store = openStore(join(root, `${name}.db`))
  const server = createServer(createHandler({ service: createService(store), tokens: TOKENS, dashboard: null }))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, body?: unknown, token = TOKENS.agent) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return (await res.json()) as Record<string, any>
  }
  const logs: string[] = []
  const deps: JobDeps = {
    api: createApi(base, TOKENS.runner),
    executor,
    checkout: createGit(join(root, `${name}-repos`)).checkout,
    runner: `${name}-runner`,
    work: join(root, `${name}-work`),
    defaultRepo: null,
    renewEveryMs: 1000,
    log: (m) => logs.push(m),
  }
  const next = async () => {
    const job = await deps.api.claim(deps.runner, ['cpu'])
    assert.ok(job, 'a job to run')
    await runJob(job, deps)
    return job
  }
  const module = async () => ((await call('GET', '/api/board', undefined, TOKENS.admin)) as Board).agents[0]!.project!.modules[0]!

  try {
    await call('POST', '/agents/1/projects', {
      title: 'speed',
      startCommit: r.start,
      repo: r.url,
      modules: [{ title: 'faster', steps: ['Add the feature', 'Polish it'], goal: { metric: 'time', unit: 'ms', direction: 'lower', targetGain: 10 } }],
    })
    await call('POST', '/agents/1/modules/m1/verifiers', { ...VERIFIERS, image })
    const baseline = await next()
    assert.equal(baseline.kind, 'baseline')
    assert.equal((await module()).goal.baseline, 100)

    await call('POST', '/agents/1/modules/m1/attempts', { attemptId: 'a1', commit: r.faster, note: 'Make it faster.' })
    await next()
    assert.deepEqual(await call('GET', '/agents/1/modules/m1/attempts/a1').then((x) => [x.verdict, x.module.state]), ['win', 'active'])
    const detail = await call('GET', '/api/agents/1/modules/m1/attempts/a1', undefined, TOKENS.admin)
    assert.deepEqual(detail.tests, { passed: 3, total: 3 })
    assert.deepEqual(
      detail.runs.map((x: { commit: string; value: number }) => [x.commit.slice(0, 7), x.value]).slice(0, 2),
      [
        [r.start.slice(0, 7), 100],
        [r.faster.slice(0, 7), 94],
      ],
    )

    // The step check runs the step's tests on the head commit
    await call('POST', '/agents/1/modules/m1/steps/1/done')
    assert.equal((await next()).kind, 'stepCheck')
    assert.equal((await module()).steps[0]!.done, true)

    // A commit the runner can't fetch is a failed turn
    await call('POST', '/agents/1/modules/m1/attempts', { attemptId: 'a2', commit: 'deadbeefdeadbeef', note: 'Forgot to push.' })
    await next()
    assert.equal((await call('GET', '/agents/1/modules/m1/attempts/a2')).verdict, 'fail')

    // Editing the benchmark changes nothing: the frozen copy measures the real value, and the dashboard flags it
    await call('POST', '/agents/1/modules/m1/attempts', { attemptId: 'a3', commit: r.cheat, note: 'Speed up the hot path.' })
    await next()
    const m = await module()
    assert.deepEqual([m.attempts[2]!.verdict, m.attempts[2]!.median, m.status.state], ['win', 85, 'passed'])
    assert.deepEqual(
      m.flags.map((f) => [f.kind, f.attempt]),
      [['touchedVerifier', 'a3']],
    )
    assert.equal((await call('GET', '/api/agents/1/modules/m1/attempts/a3', undefined, TOKENS.admin)).touchedVerifiers[0], 'bench.sh')
  } finally {
    await new Promise<void>((done) => {
      server.close(() => done())
      server.closeAllConnections()
    })
    store.close()
  }
}

test('a runner measures attempts from a real repo with the frozen verifiers (local executor)', () => scenario('local', localExecutor, 'unused'))

const hasBusybox = spawnSync('docker', ['image', 'inspect', 'busybox:1.37'], { stdio: 'ignore' }).status === 0
test('the same in bare Docker containers', { skip: !hasBusybox && 'needs Docker and the busybox:1.37 image', timeout: 120_000 }, () =>
  scenario('docker', dockerExecutor(), 'busybox:1.37'),
)

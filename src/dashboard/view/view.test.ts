import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Agent, AgentId, Attempt, AttemptId, Clock, Commit, Iso, Module, ModuleId } from '../../shared/api.ts'
import { ago, extensionLabel, figure, flagTitle, gainWords, minutes, pWords, setPercent } from './format.ts'
import { timeLeft } from './module.ts'
import { agentPath, attemptPath, matchRoute } from './routes.ts'
import { place, timeline } from './timeline.ts'

const start = Date.parse('2026-11-03T01:00:00Z')
const at = (min: number) => new Date(start + min * 60_000).toISOString() as Iso

function moduleWith(over: Partial<Module>): Module {
  return {
    id: 'm5' as ModuleId,
    position: 3,
    title: 'early termination',
    status: { state: 'active' },
    steps: [
      { title: 'a', done: true, failedTurns: 0 },
      { title: 'b', done: false, failedTurns: 1 },
      { title: 'c', done: false, failedTurns: 0 },
    ],
    goal: { metric: 'p95 latency', unit: 'ms', direction: 'lower', targetGain: 10, minGain: 2, ambitious: false, baseline: 371, target: 333.9 },
    verifiers: { kind: 'missing' },
    changes: [],
    best: 352,
    bestCommit: null,
    headCommit: null,
    streak: 1,
    attempts: [],
    clock: { kind: 'running', startedAt: at(0), deadline: at(94), maxMinutes: 90, extensions: [], waits: [{ at: at(14), minutes: 4 }], waitedMinutes: 4 },
    retryOf: null,
    flags: [],
    ...over,
  }
}

const attempt = (id: string, over: Partial<Attempt>): Attempt => ({
  id: id as AttemptId,
  step: 1,
  commit: 'c0ffee' as Commit,
  note: '',
  job: 'done',
  verdict: 'win',
  median: 352,
  postedAt: at(20),
  judgedAt: at(28),
  ...over,
})

test('routes match the three pages and nothing else', () => {
  assert.deepEqual(matchRoute('/'), { page: 'board' })
  assert.deepEqual(matchRoute('/agents/1'), { page: 'agent', agent: '1' })
  assert.deepEqual(matchRoute('/agents/1/'), { page: 'agent', agent: '1' })
  assert.deepEqual(matchRoute('/agents/1/modules/m5/attempts/a12'), { page: 'attempt', agent: '1', module: 'm5', attempt: 'a12' })
  assert.deepEqual(matchRoute('/agents/1/modules/m5'), { page: 'notFound' })
  assert.deepEqual(matchRoute('/agents'), { page: 'notFound' })
  assert.deepEqual(matchRoute('/elsewhere'), { page: 'notFound' })
  assert.deepEqual(matchRoute('/agents/%E0%A4%A'), { page: 'notFound' })
  const path = attemptPath('a b' as AgentId, 'm5' as ModuleId, 'a12' as AttemptId)
  assert.equal(path, '/agents/a%20b/modules/m5/attempts/a12')
  assert.deepEqual(matchRoute(path), { page: 'attempt', agent: 'a b', module: 'm5', attempt: 'a12' })
  assert.equal(agentPath('6' as AgentId), '/agents/6')
})

test('numbers read like the board line', () => {
  assert.equal(figure(333.9), '334')
  assert.equal(figure(2140), '2,140')
  assert.equal(figure(16.43), '16.4')
  assert.equal(figure(1.234), '1.23')
  assert.equal(setPercent(10), '10%')
  assert.equal(extensionLabel(22.5), '+23')
  assert.equal(extensionLabel(11.25), '+11')
  assert.equal(extensionLabel(5.625), '+6')
  assert.equal(minutes(4), '4 min')
  assert.equal(minutes(0.12), 'under 1 min')
})

test('gain and p read against what a win needs', () => {
  assert.equal(gainWords(5.966, 2, 'lower'), '6.0% lower, needs 2%')
  assert.equal(gainWords(-3.5, 2, 'lower'), '3.5% higher, needs 2% lower')
  assert.equal(gainWords(0.3, 2, 'higher'), '0.3% higher, needs 2%')
  assert.equal(pWords(1 / 252, 6), 'p = 0.004, needs below 0.05')
  assert.equal(pWords(0.0004, 6), 'p < 0.001, needs below 0.05')
  assert.equal(pWords(0.004, -3.5), 'p = 0.004 for worse, fails below 0.05')
})

test('relative times and flag titles', () => {
  const now = start + 90 * 60_000
  assert.equal(ago(at(90), now), 'just now')
  assert.equal(ago(at(78), now), '12 min ago')
  assert.equal(ago(at(0), now), '1 h 30 min ago')
  assert.equal(flagTitle({ kind: 'touchedVerifier', attempt: 'a5' as AttemptId }), 'a5 touched a verifier file')
  assert.equal(flagTitle({ kind: 'selfAuthoredVerifiers', attempt: null }), 'The agent wrote its own verifiers')
})

test('the time bar follows the module clock', () => {
  const m = moduleWith({})
  const now = start + 72 * 60_000
  const left = timeLeft(m, now)
  assert.equal(left.kind, 'running')
  assert.equal(left.label, '22 min left')
  assert.ok(left.kind === 'running' && Math.abs(left.share - 22 / 94) < 1e-9)
  const grace: Clock = { kind: 'grace', startedAt: at(0), deadline: at(90), graceEnds: at(99), maxMinutes: 90, extensions: [], waits: [], waitedMinutes: 0 }
  assert.deepEqual(timeLeft(moduleWith({ clock: grace }), start + 93 * 60_000), { kind: 'grace', share: 6 / 9, label: 'Time is up, 1 attempt left' })
  const stopped: Clock = { kind: 'stopped', startedAt: at(0), at: at(99), maxMinutes: 90, extensions: [], waits: [], waitedMinutes: 0 }
  assert.equal(timeLeft(moduleWith({ clock: stopped, status: { state: 'stuck', cause: 'time' } }), now).label, 'Ran out of time')
  assert.equal(timeLeft(moduleWith({ clock: { kind: 'notStarted' }, status: { state: 'pending', waitingFor: 'verifiers' } }), now).label, 'Not started')
})

test('the timeline places waits inside the limit and extensions after it', () => {
  const clock: Clock = {
    kind: 'running',
    startedAt: at(0),
    deadline: at(94 + 45 + 22.5),
    maxMinutes: 90,
    extensions: [
      { minutes: 45, cause: 'streak', at: at(76) },
      { minutes: 22.5, cause: 'step', at: at(77) },
    ],
    waits: [{ at: at(14), minutes: 4 }],
    waitedMinutes: 4,
  }
  const t = timeline(clock, [attempt('a11', { judgedAt: at(40) }), attempt('a12', { job: 'running', verdict: null, postedAt: at(66), judgedAt: null })], start + 80 * 60_000)!
  assert.equal(t.span, 210)
  assert.deepEqual(t.ticks, [0, 30, 60, 90, 120, 150, 180, 210])
  assert.equal(t.limit, 94)
  assert.equal(t.deadline, 161.5)
  assert.equal(t.elapsed, 80)
  assert.deepEqual(t.waits, [{ from: 14, to: 18 }])
  assert.deepEqual(
    t.extensions.map((e) => [e.from, e.to, e.label, e.size]),
    [
      [94, 139, '+45', 'wide'],
      [139, 161.5, '+23', 'wide'],
    ],
  )
  assert.deepEqual(t.markers, [
    { at: 40, kind: 'win', id: 'a11' },
    { at: 66, kind: 'pending', id: 'a12' },
  ])
  assert.deepEqual(t.steps, [77])
  assert.equal(t.grace, null)
  assert.equal(place(105, 210), '50%')
  assert.equal(place(300, 210), '100%')
})

test('the grace band spans 10% of maxMinutes, and a stopped clock keeps the part it used', () => {
  const grace: Clock = { kind: 'grace', startedAt: at(0), deadline: at(63), graceEnds: at(69), maxMinutes: 60, extensions: [], waits: [{ at: at(5), minutes: 3 }], waitedMinutes: 3 }
  const g = timeline(grace, [], start + 65 * 60_000)!
  assert.deepEqual(g.grace, { from: 63, to: 69, open: true })
  assert.equal(g.span, 150)
  const stopped: Clock = { kind: 'stopped', startedAt: at(0), at: at(66), maxMinutes: 60, extensions: [], waits: [{ at: at(5), minutes: 3 }], waitedMinutes: 3 }
  assert.deepEqual(timeline(stopped, [], start + 200 * 60_000)!.grace, { from: 63, to: 66, open: false })
  assert.equal(timeline({ kind: 'notStarted' }, [], start), null)
})

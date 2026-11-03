import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Agent, AgentId, Clock, Iso, Module, ModuleId } from './api.ts'
import { boardLine } from './boardLine.ts'

const now = new Date('2026-11-03T02:22:00Z')
const iso = (s: string) => s as Iso

function moduleWith(over: Partial<Module>): Module {
  return {
    id: 'm1' as ModuleId,
    position: 2,
    title: 'query cache',
    status: { state: 'active' },
    steps: [
      { title: 'a', done: true, failedTurns: 0 },
      { title: 'b', done: true, failedTurns: 0 },
      { title: 'c', done: true, failedTurns: 0 },
      { title: 'd', done: false, failedTurns: 1 },
      { title: 'e', done: false, failedTurns: 0 },
      { title: 'f', done: false, failedTurns: 0 },
      { title: 'g', done: false, failedTurns: 0 },
    ],
    goal: { metric: 'p95 latency', unit: 'ms', direction: 'lower', targetGain: 10, minGain: 2, ambitious: false, baseline: 371, target: 334 },
    verifiers: { kind: 'missing' },
    changes: [],
    best: 352,
    bestCommit: null,
    headCommit: null,
    streak: 2,
    attempts: [],
    clock: { kind: 'running', startedAt: iso('2026-11-03T01:00:00Z'), deadline: iso('2026-11-03T03:00:00Z'), maxMinutes: 90, extensions: [], waits: [], waitedMinutes: 0 },
    retryOf: null,
    flags: [],
    ...over,
  }
}

function agentWith(m: Module): Agent {
  const filler = (id: string, position: number) => ({ ...moduleWith({}), id: id as ModuleId, position })
  return {
    id: '1' as AgentId,
    blurb: 'Caching parsed queries.',
    line: '',
    project: { title: 'search-perf', modules: [filler('m0', 1), m, filler('m2', 3), filler('m3', 4), filler('m4', 5)], current: m.id },
    queued: [],
  }
}

test('matches the format in DESIGN.md', () => {
  assert.equal(
    boardLine(agentWith(moduleWith({})), now),
    'agent 1: Project: search-perf, Module (2 / 5): query cache, Progress: 3 / 7, Blurb: Caching parsed queries. Goal: p95 latency 371 -> 334 ms, 10% lower. 2 wins in a row. 38 min left.',
  )
})

test('leaves the streak out below 2 wins and the numbers out before a baseline', () => {
  const m = moduleWith({ streak: 1, goal: { ...moduleWith({}).goal, baseline: null, target: null } })
  assert.match(boardLine(agentWith(m), now), /Blurb: Caching parsed queries\. Goal: p95 latency, 10% lower\. 38 min left\.$/)
})

test('says when time is up and one attempt is left', () => {
  const clock: Clock = { kind: 'grace', startedAt: iso('2026-11-03T00:30:00Z'), deadline: iso('2026-11-03T02:00:00Z'), graceEnds: iso('2026-11-03T02:09:00Z'), maxMinutes: 90, extensions: [], waits: [], waitedMinutes: 0 }
  assert.match(boardLine(agentWith(moduleWith({ clock })), now), /Time is up, 1 attempt left\.$/)
})

test('names what a stuck or pending module is waiting for', () => {
  assert.match(boardLine(agentWith(moduleWith({ status: { state: 'stuck', cause: 'step' }, clock: { kind: 'stopped', startedAt: null, at: iso('2026-11-03T02:00:00Z'), maxMinutes: 90, extensions: [], waits: [], waitedMinutes: 0 } })), now), /Stuck, waiting for an abandon reason\.$/)
  assert.match(boardLine(agentWith(moduleWith({ status: { state: 'pending', waitingFor: 'verifiers' }, clock: { kind: 'notStarted' } })), now), /Waiting for its verifiers\.$/)
})

test('an agent with no open project says so', () => {
  assert.equal(boardLine({ id: '3' as AgentId, blurb: '', line: '', project: null, queued: [] }, now), 'agent 3: no open project')
})

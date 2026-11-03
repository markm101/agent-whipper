// Turns the mock's records into exactly what the server would send: the
// Board and AttemptDetail types in src/shared/api.ts.
import type { Agent, AgentId, Attempt, AttemptDetail, AttemptId, Board, Clock, Module, ModuleId, ModuleStatus } from '../../../shared/api.ts'
import { boardLine } from '../../../shared/boardLine.ts'
import {
  MINUTE,
  bestCommitOf,
  bestOf,
  currentOf,
  deadlineOf,
  extensionsOf,
  failedTurns,
  find,
  firstInLine,
  graceMinutes,
  headCommitOf,
  iso,
  lastAttempt,
  streakOf,
  targetOf,
  waitedOf,
  type Ms,
  type WAgent,
  type WAttempt,
  type WModule,
  type WProject,
  type World,
} from './world.ts'

function attemptOf(a: WAttempt): Attempt {
  return {
    id: a.id,
    step: a.step,
    commit: a.commit,
    note: a.note,
    job: a.job,
    verdict: a.judged?.verdict ?? null,
    median: a.judged?.median ?? null,
    postedAt: iso(a.postedAt),
    judgedAt: a.judgedAt === null ? null : iso(a.judgedAt),
  }
}

function statusOf(p: WProject, m: WModule): ModuleStatus {
  switch (m.state) {
    case 'pending':
      if (!firstInLine(p, m)) return { state: 'pending', waitingFor: 'turn' }
      return { state: 'pending', waitingFor: m.verifiers.kind === 'missing' ? 'verifiers' : 'baseline' }
    case 'stuck':
      return { state: 'stuck', cause: m.cause ?? 'step' }
    case 'abandoned':
      return { state: 'abandoned', reason: m.reason ?? '', followUp: m.followUp }
    default:
      return { state: m.state }
  }
}

function clockOf(m: WModule, now: Ms): Clock {
  if (m.startedAt === null && m.stoppedAt === null) return { kind: 'notStarted' }
  const extensions = extensionsOf(m).map((e) => ({ ...e, at: iso(e.at) }))
  const waits = m.waits.map((w) => ({ at: iso(w.at), minutes: w.minutes }))
  const shared = { maxMinutes: m.maxMinutes, extensions, waits, waitedMinutes: waitedOf(m) }
  if (m.stoppedAt !== null || m.startedAt === null) return { kind: 'stopped', startedAt: m.startedAt === null ? null : iso(m.startedAt), at: iso(m.stoppedAt ?? now), ...shared }
  const deadline = deadlineOf(m)!
  const last = lastAttempt(m)
  // An attempt in flight at the deadline is the last one; no grace period opens
  const graceOpen = now >= deadline && !(last && last.postedAt <= deadline)
  if (!graceOpen) return { kind: 'running', startedAt: iso(m.startedAt), deadline: iso(deadline), ...shared }
  return { kind: 'grace', startedAt: iso(m.startedAt), deadline: iso(deadline), graceEnds: iso(deadline + graceMinutes(m) * MINUTE), ...shared }
}

function moduleOf(p: WProject, m: WModule, now: Ms): Module {
  return {
    id: m.id,
    position: p.modules.indexOf(m) + 1,
    title: m.title,
    status: statusOf(p, m),
    steps: m.steps.map((s, i) => ({ title: s.title, done: s.doneAt !== null, failedTurns: failedTurns(m, i + 1) })),
    goal: { ...m.goal, baseline: m.baseline, target: targetOf(m) },
    verifiers: m.verifiers,
    best: bestOf(m),
    bestCommit: bestCommitOf(m),
    headCommit: headCommitOf(m),
    streak: streakOf(m),
    attempts: m.attempts.map(attemptOf),
    clock: clockOf(m, now),
    retryOf: m.retryOf,
    flags: m.flags,
  }
}

function agentOf(a: WAgent, now: Ms): Agent {
  const p = a.project
  const project = p && { title: p.title, modules: p.modules.map((m) => moduleOf(p, m, now)), current: currentOf(p)?.id ?? null }
  const agent: Agent = { id: a.id, blurb: a.blurb, line: '', project, queued: [...a.queued] }
  return { ...agent, line: boardLine(agent, new Date(now)) }
}

export function boardOf(w: World, now: Ms): Board {
  return { generatedAt: iso(now), agents: w.agents.map((a) => agentOf(a, now)) }
}

export function attemptDetailOf(w: World, agent: AgentId, module: ModuleId, attempt: AttemptId): AttemptDetail | null {
  const { m } = find(w, agent, module)
  const x = m?.attempts.find((y) => y.id === attempt)
  if (!m || !x) return null
  return {
    agent,
    module,
    attempt: attemptOf(x),
    bestCommit: x.bestCommit,
    verifierHash: x.verifierHash,
    runner: x.runner,
    tests: x.tests,
    runs: x.runs,
    bestMedian: x.judged?.bestMedian ?? null,
    gain: x.judged?.gain ?? null,
    p: x.judged?.p ?? null,
    touchedVerifiers: x.touched,
  }
}

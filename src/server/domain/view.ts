// What the server sends: the records turned into the Board and AttemptDetail
// of src/shared/api.ts, the plain-text board lines, and the small answers to
// an agent's GET calls. Read-only; settle the world first.
import type { Agent, AgentId, Attempt, AttemptDetail, AttemptId, Board, ChangeId, Clock, Iso, Module, ModuleId, ModuleStatus, Verdict } from '../../shared/api.ts'
import { boardLine } from '../../shared/boardLine.ts'
import { currentOf, factsOf, failedTurns, firstInLine, locate, measured, verifiersOf, type Facts } from './queries.ts'
import { MINUTE, iso, type AgentRec, type AttemptRec, type ModuleRec, type Ms, type ProjectRec, type World } from './records.ts'

const jobOf = (m: ModuleRec, x: AttemptRec) => m.jobs.find((j) => j.id === x.job)!

function attemptOf(m: ModuleRec, x: AttemptRec): Attempt {
  return {
    id: x.id,
    step: x.step,
    commit: x.commit,
    note: x.note,
    job: jobOf(m, x).state,
    verdict: x.judged?.verdict ?? null,
    median: x.judged?.median ?? null,
    postedAt: iso(x.postedAt),
    judgedAt: x.judgedAt === null ? null : iso(x.judgedAt),
  }
}

/** A failed baseline leaves the module waiting for new verifiers. */
function baselineFailed(m: ModuleRec): boolean {
  const v = verifiersOf(m)
  const job = v && m.jobs.findLast((j) => j.kind === 'baseline' && j.verifierHash === v.hash)
  return !!job && job.state !== 'queued' && job.state !== 'running' && !measured(job)
}

function statusOf(p: ProjectRec, m: ModuleRec): ModuleStatus {
  switch (m.state) {
    case 'pending':
      if (firstInLine(p) !== m) return { state: 'pending', waitingFor: 'turn' }
      return { state: 'pending', waitingFor: !verifiersOf(m) || baselineFailed(m) ? 'verifiers' : 'baseline' }
    case 'stuck':
      return { state: 'stuck', cause: m.cause ?? 'step' }
    case 'abandoned':
      return { state: 'abandoned', reason: m.reason ?? '', followUp: m.followUp }
    default:
      return { state: m.state }
  }
}

function clockOf(m: ModuleRec, f: Facts, now: Ms): Clock {
  if (f.startedAt === null && m.stoppedAt === null) return { kind: 'notStarted' }
  const shared = {
    maxMinutes: m.maxMinutes,
    extensions: f.extensions.map((e) => ({ ...e, at: iso(e.at) })),
    waits: f.waits.map((w) => ({ at: iso(w.at), minutes: w.minutes })),
    waitedMinutes: f.waited,
  }
  if (m.stoppedAt !== null || f.startedAt === null) return { kind: 'stopped', startedAt: f.startedAt === null ? null : iso(f.startedAt), at: iso(m.stoppedAt ?? now), ...shared }
  const deadline = f.deadline!
  // An attempt in flight at the deadline is the last one, and no grace period opens
  const graceOpen = now >= deadline && !(f.last && f.last.postedAt <= deadline)
  if (!graceOpen) return { kind: 'running', startedAt: iso(f.startedAt), deadline: iso(deadline), ...shared }
  return { kind: 'grace', startedAt: iso(f.startedAt), deadline: iso(deadline), graceEnds: iso(deadline + f.graceMinutes * MINUTE), ...shared }
}

function moduleOf(p: ProjectRec, m: ModuleRec, now: Ms): Module {
  const f = factsOf(p, m, now)
  const v = verifiersOf(m)
  const tests = m.jobs.findLast((j) => j.results?.tests)?.results?.tests?.total ?? null
  return {
    id: m.id,
    position: p.modules.indexOf(m) + 1,
    title: m.title,
    status: statusOf(p, m),
    steps: m.steps.map((s, i) => ({ title: s.title, done: s.doneAt !== null, failedTurns: failedTurns(m, i + 1) })),
    goal: { ...m.goal, baseline: f.baseline, target: f.target },
    verifiers: v ? { kind: 'frozen', hash: v.hash, tests, author: v.author, hardware: v.hardware, openChanges: m.changes.filter((c) => c.state === 'open').length } : { kind: 'missing' },
    best: f.bestValue,
    bestCommit: f.best,
    headCommit: f.head,
    streak: f.streak,
    attempts: m.attempts.map((x) => attemptOf(m, x)),
    clock: clockOf(m, f, now),
    retryOf: m.retryOf,
    flags: m.flags.map((x) => ({ ...x, at: iso(x.at) })),
  }
}

export function agentView(a: AgentRec, now: Ms): Agent {
  const p = a.project
  const project = p && { title: p.title, modules: p.modules.map((m) => moduleOf(p, m, now)), current: currentOf(p)?.id ?? null }
  const agent: Agent = { id: a.id, blurb: a.blurb, line: '', project, queued: a.queued.map((q) => q.title) }
  return { ...agent, line: boardLine(agent, new Date(now)) }
}

export function boardOf(w: World, now: Ms): Board {
  return { generatedAt: iso(now), agents: w.agents.map((a) => agentView(a, now)) }
}

/** GET /board: every agent's board line. */
export const boardText = (w: World, now: Ms) => w.agents.map((a) => agentView(a, now).line).join('\n')

export function attemptDetailOf(w: World, agent: AgentId, module: ModuleId, attempt: AttemptId): AttemptDetail | null {
  const found = locate(w, agent, module)
  const x = found?.m.attempts.find((y) => y.id === attempt)
  if (!found || !x) return null
  const j = jobOf(found.m, x)
  return {
    agent,
    module,
    attempt: attemptOf(found.m, x),
    bestCommit: x.bestCommit,
    verifierHash: j.verifierHash,
    runner: j.claims.at(-1)?.runner ?? null,
    tests: j.results?.tests ?? null,
    runs: j.results?.runs ?? [],
    bestMedian: x.judged?.bestMedian ?? null,
    gain: x.judged?.gain ?? null,
    p: x.judged?.p ?? null,
    touchedVerifiers: j.results?.touched ?? [],
  }
}

/** GET /agents/{id}/modules/{m}/attempts/{attemptId}: what the agent needs to decide its next move. */
export interface AttemptStatus {
  attempt: AttemptId
  job: Attempt['job']
  verdict: Verdict | null
  step: number
  failedTurns: number
  streak: number
  module: ModuleStatus
  line: string
}

export function attemptStatusOf(w: World, agent: string, module: string, attempt: string, now: Ms): AttemptStatus | null {
  const found = locate(w, agent, module)
  const x = found?.m.attempts.find((y) => y.id === attempt)
  if (!found || !x) return null
  const { a, p, m } = found
  return {
    attempt: x.id,
    job: jobOf(m, x).state,
    verdict: x.judged?.verdict ?? null,
    step: x.step,
    failedTurns: failedTurns(m, x.step),
    streak: factsOf(p, m, now).streak,
    module: statusOf(p, m),
    line: agentView(a, now).line,
  }
}

export interface ChangeStatus {
  change: ChangeId
  module: ModuleId
  state: 'open' | 'approved' | 'rejected'
  reason: string
  filedAt: Iso
  decidedAt: Iso | null
}

export function changeOf(w: World, agent: string, module: string, change: string): ChangeStatus | null {
  const c = locate(w, agent, module)?.m.changes.find((x) => x.id === change)
  if (!c) return null
  return { change: c.id, module: module as ModuleId, state: c.state, reason: c.reason, filedAt: iso(c.filedAt), decidedAt: c.decidedAt === null ? null : iso(c.decidedAt) }
}

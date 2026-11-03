// Everything the server derives instead of storing. `factsOf` computes a
// module's numbers at one moment, so commands and views read the same values.
import type { Commit } from '../../shared/api.ts'
import { extensionSeries, improve, median } from './judge.ts'
import { MINUTE, type AgentRec, type AttemptRec, type Ms, type JobRec, type ModuleRec, type ProjectRec, type VerifierSet, type World } from './records.ts'
import { GRACE_SHARE, ended, live } from './rules.ts'

export const verifiersOf = (m: ModuleRec): VerifierSet | null => m.verifiers.at(-1) ?? null
export const verifierSet = (m: ModuleRec, hash: string): VerifierSet | null => m.verifiers.findLast((v) => v.hash === hash) ?? null
export const inFlight = (m: ModuleRec): JobRec | null => m.jobs.find((j) => j.state === 'queued' || j.state === 'running') ?? null
export const lastWin = (m: ModuleRec): AttemptRec | null => m.attempts.findLast((a) => a.judged?.verdict === 'win') ?? null
/** When an attempt's job ended, judged or not. Null while it's in flight. */
export const attemptEnd = (m: ModuleRec, a: AttemptRec): Ms | null => a.judgedAt ?? m.jobs.find((j) => j.id === a.job)?.finishedAt ?? null

export const failedTurns = (m: ModuleRec, step: number) => m.attempts.filter((a) => a.step === step && a.judged?.verdict === 'fail').length
export const projectEnded = (p: ProjectRec) => p.modules.every((m) => ended(m.state))

/** A job that passed its tests and measured something. */
export const measured = (j: JobRec) => j.state === 'done' && !!j.results?.tests && j.results.tests.passed === j.results.tests.total && j.results.runs.length > 0

/** The baseline job that started the module. */
export const baselineJob = (m: ModuleRec): JobRec | null => m.jobs.find((j) => j.kind === 'baseline' && measured(j)) ?? null

/** 0-based index of the first step not done; steps.length once all are done. */
export function currentStepIndex(m: ModuleRec): number {
  const i = m.steps.findIndex((s) => s.doneAt === null)
  return i === -1 ? m.steps.length : i
}

export function streakOf(m: ModuleRec): number {
  let n = 0
  for (const a of m.attempts.filter((x) => x.judged).reverse()) {
    if (a.judged?.verdict !== 'win') break
    n++
  }
  return n
}

const headOf = (m: ModuleRec, start: Commit | null) => m.attempts.findLast((a) => a.judged?.verdict === 'win' || a.judged?.verdict === 'flat')?.commit ?? start

/** Each module's start commit, in project order: what the module before it left behind. Null until that module ends. */
export function startCommits(p: ProjectRec): (Commit | null)[] {
  const out: (Commit | null)[] = []
  let from: Commit | null = p.startCommit
  for (const m of p.modules) {
    out.push(from)
    if (from === null || !ended(m.state)) from = null
    else if (m.state === 'passed') from = headOf(m, from)
    else from = lastWin(m)?.commit ?? from
  }
  return out
}

/** The pending module whose turn it is: the first that hasn't ended, if it's pending. */
export function firstInLine(p: ProjectRec): ModuleRec | null {
  const m = p.modules.find((x) => !ended(x.state))
  return m?.state === 'pending' ? m : null
}

/** The module that is active, past target, or stuck, or else the next pending one. */
export function currentOf(p: ProjectRec): ModuleRec | null {
  return p.modules.find((m) => live(m.state) || m.state === 'stuck') ?? p.modules.find((m) => m.state === 'pending') ?? null
}

export interface WaitRec {
  at: Ms
  minutes: number
}

/** Time the module's jobs spent queued after it started, including a wait still going on. */
export function waitsOf(m: ModuleRec, startedAt: Ms | null, now: Ms): WaitRec[] {
  if (startedAt === null) return []
  const out: WaitRec[] = []
  const add = (from: Ms, to: Ms) => {
    const at = Math.max(from, startedAt)
    if (to > at) out.push({ at, minutes: (to - at) / MINUTE })
  }
  for (const j of m.jobs) {
    let from: Ms | null = j.queuedAt
    for (const c of j.claims) {
      add(from, c.at)
      // A lapsed lease or a runner error puts the job back in the queue
      from = c.lapsed || c.error !== null ? c.endedAt : null
      if (from === null) break
    }
    if (from !== null) add(from, j.state === 'queued' ? now : (j.finishedAt ?? now))
  }
  return out.sort((x, y) => x.at - y.at)
}

export interface ExtensionRec {
  minutes: number
  cause: 'streak' | 'win' | 'step'
  at: Ms
}

/**
 * The extensions earned so far: half of maxMinutes to the win that makes the
 * first streak of 2 or the first finished step that holds the metric, then
 * half the previous to each later win or held step.
 */
export function extensionsOf(m: ModuleRec): ExtensionRec[] {
  type Event = { at: Ms; attempt: boolean; win: boolean; held: boolean }
  const events: Event[] = [
    ...m.attempts.filter((a) => a.judged && a.judgedAt !== null).map((a) => ({ at: a.judgedAt!, attempt: true, win: a.judged!.verdict === 'win', held: false })),
    ...m.steps.filter((s) => s.doneAt !== null).map((s) => ({ at: s.doneAt!, attempt: false, win: false, held: s.held === true })),
  ].sort((x, y) => x.at - y.at)
  const series = extensionSeries(m.maxMinutes)
  const out: ExtensionRec[] = []
  let run = 0
  for (const e of events) {
    if (e.attempt) run = e.win ? run + 1 : 0
    const minutes = series[out.length]
    if (minutes === undefined) break
    const first = out.length === 0
    const earns = first ? (e.win && run >= 2) || e.held : e.win || e.held
    if (earns) out.push({ minutes, cause: e.attempt ? (first ? 'streak' : 'win') : 'step', at: e.at })
  }
  return out
}

/** A module's numbers at one moment. */
export interface Facts {
  start: Commit | null
  best: Commit | null
  head: Commit | null
  baseline: number | null
  target: number | null
  /** The best commit's median: the latest win's, or the baseline. */
  bestValue: number | null
  startedAt: Ms | null
  waits: WaitRec[]
  waited: number
  extensions: ExtensionRec[]
  deadline: Ms | null
  graceMinutes: number
  /** The deadline's last attempt: the one in flight at the deadline, or else the first posted after it. */
  last: AttemptRec | null
  /** 0-based. */
  step: number
  streak: number
  inFlight: JobRec | null
}

export function factsOf(p: ProjectRec, m: ModuleRec, now: Ms): Facts {
  const start = startCommits(p)[p.modules.indexOf(m)] ?? null
  const win = lastWin(m)
  const baselineRun = baselineJob(m)
  const baseline = baselineRun ? median(baselineRun.results!.runs.map((r) => r.value)) : null
  const startedAt = baselineRun?.finishedAt ?? null
  const waits = waitsOf(m, startedAt, now)
  const waited = waits.reduce((sum, w) => sum + w.minutes, 0)
  const extensions = startedAt === null ? [] : extensionsOf(m)
  const extended = extensions.reduce((sum, e) => sum + e.minutes, 0)
  const deadline = startedAt === null ? null : startedAt + (m.maxMinutes + extended + waited) * MINUTE
  const last =
    deadline === null
      ? null
      : (m.attempts.find((a) => {
          const end = attemptEnd(m, a)
          return a.postedAt <= deadline && (end === null || end >= deadline)
        }) ??
        m.attempts.find((a) => a.postedAt > deadline) ??
        null)
  return {
    start,
    best: win?.commit ?? start,
    head: headOf(m, start),
    baseline,
    target: baseline === null ? null : improve(baseline, m.goal.targetGain, m.goal.direction),
    bestValue: win?.judged?.median ?? baseline,
    startedAt,
    waits,
    waited,
    extensions,
    deadline,
    graceMinutes: m.maxMinutes * GRACE_SHARE,
    last,
    step: currentStepIndex(m),
    streak: streakOf(m),
    inFlight: inFlight(m),
  }
}

/**
 * When a live module runs out of time: once its last attempt is judged, or
 * when the grace period ends without one. A step check in flight at the
 * deadline still finishes first. Null while that can't be known yet.
 */
export function timesOutAt(m: ModuleRec, f: Facts): Ms | null {
  if (f.deadline === null) return null
  const d = f.deadline
  if (f.last) return attemptEnd(m, f.last)
  const check = m.jobs.find((j) => j.kind === 'stepCheck' && j.queuedAt <= d && (j.finishedAt === null || j.finishedAt >= d) && j.state !== 'cancelled')
  const graceEnds = d + f.graceMinutes * MINUTE
  if (!check) return graceEnds
  return check.finishedAt === null ? null : Math.max(graceEnds, check.finishedAt)
}

export interface Located {
  a: AgentRec
  p: ProjectRec
  m: ModuleRec
}

export const agentOf = (w: World, id: string): AgentRec | null => w.agents.find((a) => a.id === id) ?? null

const projectsOf = (a: AgentRec) => (a.project ? [a.project, ...a.past] : a.past)

/** Finds a module in any of the agent's projects. Module IDs are unique per agent. */
export function locate(w: World, agent: string, module: string): Located | null {
  const a = agentOf(w, agent)
  for (const p of a ? projectsOf(a) : []) {
    const m = p.modules.find((x) => x.id === module)
    if (m) return { a: a!, p, m }
  }
  return null
}

export function findJob(w: World, id: string): (Located & { j: JobRec }) | null {
  for (const a of w.agents)
    for (const p of projectsOf(a))
      for (const m of p.modules) {
        const j = m.jobs.find((x) => x.id === id)
        if (j) return { a, p, m, j }
      }
  return null
}

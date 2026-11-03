// The mock's records, close to what DESIGN.md says the server stores, and the
// calls that change them. Everything the server derives (best, streak,
// extensions, deadline) is derived here too, never stored, so the fixtures and
// the scripted timeline can't make the numbers disagree.
import type { AgentId, AttemptId, Commit, Direction, Extension, Flag, FlagKind, Iso, JobState, ModuleId, Run, Verifiers } from '../../../shared/api.ts'
import { extensionSeries, improve, judge, reaches, type Judged } from './judge.ts'

export type Ms = number
export const MINUTE = 60_000
export const iso = (ms: Ms) => new Date(ms).toISOString() as Iso

export interface GoalSpec {
  metric: string
  unit: string
  direction: Direction
  targetGain: number
  minGain: number
  ambitious: boolean
}

export interface ModuleSpec {
  id: string
  title: string
  steps: { title: string; tests: number }[]
  goal: GoalSpec
  regressionTests: number
  /** How the mock's benchmark behaves: run-to-run spread and work per run. */
  bench: { spread: number; work: number }
  maxMinutes?: number
  retryOf?: string
}

export interface WStep {
  title: string
  tests: number
  doneAt: Ms | null
  /** Whether the step check showed the metric held. */
  held: boolean | null
}

export interface WAttempt {
  id: AttemptId
  /** 1-based. */
  step: number
  commit: Commit
  note: string
  bestCommit: Commit
  verifierHash: string
  postedAt: Ms
  claimedAt: Ms | null
  judgedAt: Ms | null
  job: JobState
  runner: string | null
  tests: { passed: number; total: number } | null
  runs: Run[]
  touched: string[]
  judged: Judged | null
}

export type WState = 'pending' | 'active' | 'pastTarget' | 'stuck' | 'passed' | 'abandoned'

export interface WModule {
  id: ModuleId
  title: string
  steps: WStep[]
  goal: GoalSpec
  regressionTests: number
  bench: { spread: number; work: number }
  verifiers: Verifiers
  baseline: number | null
  startCommit: Commit | null
  state: WState
  cause: 'step' | 'target' | 'time' | null
  reason: string | null
  followUp: ModuleId | null
  startedAt: Ms | null
  stoppedAt: Ms | null
  maxMinutes: number
  attempts: WAttempt[]
  waits: { at: Ms; minutes: number }[]
  retryOf: ModuleId | null
  flags: Flag[]
}

export interface WProject {
  title: string
  startCommit: Commit
  /** The default for its modules. */
  maxMinutes: number
  modules: WModule[]
}

export interface WAgent {
  id: AgentId
  blurb: string
  project: WProject | null
  queued: string[]
}

export interface World {
  agents: WAgent[]
}

/** A stable fake hash: FNV-1a over the seed, as hex. */
export function hex(seed: string, length = 12): string {
  let out = ''
  for (let round = 0; out.length < length; round++) {
    let h = 0x811c9dc5 ^ round
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, length)
}

const DEFAULT_MAX_MINUTES = 90
const GRACE_SHARE = 0.1

// Queries

export const ended = (m: WModule) => m.state === 'passed' || m.state === 'abandoned'
export const judgedAttempts = (m: WModule) => m.attempts.filter((a) => a.judged)
export const inFlight = (m: WModule) => m.attempts.find((a) => a.job === 'queued' || a.job === 'running') ?? null
const latest = <T>(xs: T[], test: (x: T) => boolean) => xs.findLast(test) ?? null
const lastWin = (m: WModule) => latest(m.attempts, (a) => a.judged?.verdict === 'win')

export const bestOf = (m: WModule) => lastWin(m)?.judged?.median ?? m.baseline
export const bestCommitOf = (m: WModule) => lastWin(m)?.commit ?? m.startCommit
export const headCommitOf = (m: WModule) => latest(m.attempts, (a) => a.judged?.verdict === 'win' || a.judged?.verdict === 'flat')?.commit ?? m.startCommit
export const targetOf = (m: WModule) => (m.baseline === null ? null : improve(m.baseline, m.goal.targetGain, m.goal.direction))
/** 0-based index of the first step not done; steps.length when all are done. */
export const currentStepIndex = (m: WModule) => {
  const i = m.steps.findIndex((s) => s.doneAt === null)
  return i === -1 ? m.steps.length : i
}
export const failedTurns = (m: WModule, step: number) => m.attempts.filter((a) => a.step === step && a.judged?.verdict === 'fail').length

export function streakOf(m: WModule): number {
  let n = 0
  for (const a of judgedAttempts(m).reverse()) {
    if (a.judged?.verdict !== 'win') break
    n++
  }
  return n
}

export function extensionsOf(m: WModule): (Omit<Extension, 'at'> & { at: Ms })[] {
  type Event = { at: Ms; win: boolean; attempt: boolean; held: boolean }
  const events: Event[] = [
    ...judgedAttempts(m).map((a) => ({ at: a.judgedAt!, win: a.judged!.verdict === 'win', attempt: true, held: false })),
    ...m.steps.filter((s) => s.doneAt !== null).map((s) => ({ at: s.doneAt!, win: false, attempt: false, held: s.held === true })),
  ].sort((x, y) => x.at - y.at)
  const series = extensionSeries(m.maxMinutes)
  const out: (Omit<Extension, 'at'> & { at: Ms })[] = []
  let run = 0
  for (const e of events) {
    if (e.attempt) run = e.win ? run + 1 : 0
    const minutes = series[out.length]
    if (minutes === undefined) continue
    const first = out.length === 0
    const earns = first ? (e.win && run >= 2) || e.held : e.win || e.held
    if (earns) out.push({ minutes, cause: e.attempt ? (first ? 'streak' : 'win') : 'step', at: e.at })
  }
  return out
}

export const waitedOf = (m: WModule) => m.waits.reduce((sum, w) => sum + w.minutes, 0)
export const extendedOf = (m: WModule) => extensionsOf(m).reduce((sum, e) => sum + e.minutes, 0)
export const deadlineOf = (m: WModule) => (m.startedAt === null ? null : m.startedAt + (m.maxMinutes + extendedOf(m) + waitedOf(m)) * MINUTE)
export const graceMinutes = (m: WModule) => m.maxMinutes * GRACE_SHARE

/** The deadline's last attempt: the one in flight at the deadline, or else the first posted after it. */
export function lastAttempt(m: WModule): WAttempt | null {
  const d = deadlineOf(m)
  if (d === null) return null
  return m.attempts.find((a) => a.postedAt <= d && (a.judgedAt === null || a.judgedAt >= d)) ?? m.attempts.find((a) => a.postedAt > d) ?? null
}

export const firstInLine = (p: WProject, m: WModule) => {
  const i = p.modules.indexOf(m)
  return m.state === 'pending' && p.modules.slice(0, i).every(ended)
}

// Calls

export function find(w: World, agent: string, module?: string) {
  const a = w.agents.find((x) => x.id === agent)
  const p = a?.project ?? null
  const m = module === undefined ? null : (p?.modules.find((x) => x.id === module) ?? null)
  return { a, p, m }
}

function moduleFrom(spec: ModuleSpec, projectMax: number): WModule {
  return {
    id: spec.id as ModuleId,
    title: spec.title,
    steps: spec.steps.map((s) => ({ ...s, doneAt: null, held: null })),
    goal: spec.goal,
    regressionTests: spec.regressionTests,
    bench: spec.bench,
    verifiers: { kind: 'missing' },
    baseline: null,
    startCommit: null,
    state: 'pending',
    cause: null,
    reason: null,
    followUp: null,
    startedAt: null,
    stoppedAt: null,
    maxMinutes: spec.maxMinutes ?? projectMax,
    attempts: [],
    waits: [],
    retryOf: (spec.retryOf ?? null) as ModuleId | null,
    flags: [],
  }
}

export function createProject(w: World, agent: string, title: string, modules: ModuleSpec[], maxMinutes = DEFAULT_MAX_MINUTES) {
  const a = w.agents.find((x) => x.id === agent)
  if (!a) return
  if (a.project) return void a.queued.push(title)
  const startCommit = hex(`${agent}:${title}:start`) as Commit
  a.project = { title, startCommit, maxMinutes, modules: modules.map((s) => moduleFrom(s, maxMinutes)) }
  const first = a.project.modules[0]
  if (first) first.startCommit = startCommit
}

function raise(m: WModule, kind: FlagKind, attempt: AttemptId | null, detail: string, at: Ms) {
  m.flags.push({ kind, attempt, detail, at: iso(at) })
}

export function freezeVerifiers(w: World, agent: string, module: string, author: string, hardware: string, at: Ms) {
  const { m } = find(w, agent, module)
  if (!m) return
  const version = m.verifiers.kind === 'frozen' ? m.verifiers.hash : 'none'
  const tests = m.regressionTests + m.steps.reduce((sum, s) => sum + s.tests, 0)
  m.verifiers = { kind: 'frozen', hash: hex(`${agent}:${module}:${version}:verifiers`), tests, author: author as AgentId, hardware, openChanges: 0 }
  if (author === agent) raise(m, 'selfAuthoredVerifiers', null, `agent ${agent} wrote the verifiers for ${m.id}, the module it works.`, at)
}

export function landBaseline(w: World, agent: string, module: string, value: number, at: Ms) {
  const { p, m } = find(w, agent, module)
  if (!p || !m || !firstInLine(p, m) || m.verifiers.kind !== 'frozen' || m.baseline !== null) return
  m.baseline = value
  m.state = 'active'
  m.startedAt = at
}

export function postAttempt(w: World, agent: string, module: string, id: string, note: string, at: Ms) {
  const { m } = find(w, agent, module)
  if (!m || (m.state !== 'active' && m.state !== 'pastTarget') || inFlight(m) || m.verifiers.kind !== 'frozen') return
  const d = deadlineOf(m)
  if (d !== null && at >= d && lastAttempt(m)) return
  m.attempts.push({
    id: id as AttemptId,
    step: currentStepIndex(m) + 1,
    commit: hex(`${agent}:${module}:${id}`) as Commit,
    note,
    bestCommit: bestCommitOf(m)!,
    verifierHash: m.verifiers.hash,
    postedAt: at,
    claimedAt: null,
    judgedAt: null,
    job: 'queued',
    runner: null,
    tests: null,
    runs: [],
    touched: [],
    judged: null,
  })
}

export function claimJob(w: World, agent: string, module: string, attempt: string, runner: string, at: Ms) {
  const { m } = find(w, agent, module)
  const x = m?.attempts.find((y) => y.id === attempt)
  if (!m || !x || x.job !== 'queued') return
  x.job = 'running'
  x.claimedAt = at
  x.runner = runner
  if (at > x.postedAt) m.waits.push({ at: x.postedAt, minutes: (at - x.postedAt) / MINUTE })
}

function leftBehind(m: WModule): Commit | null {
  if (m.state === 'passed') return headCommitOf(m)
  return lastWin(m) ? bestCommitOf(m) : m.startCommit
}

function stop(p: WProject, m: WModule, state: 'stuck' | 'passed' | 'abandoned', at: Ms, cause: WModule['cause'] = null) {
  m.state = state
  m.cause = cause
  m.stoppedAt ??= at
  if (state === 'stuck') return
  const next = p.modules[p.modules.indexOf(m) + 1]
  if (next && next.state === 'pending') next.startCommit = leftBehind(m)
}

export interface Results {
  tests: { passed: number; total: number } | null
  runs: Run[]
  touched: string[]
  killed?: boolean
}

export function sendResults(w: World, agent: string, module: string, attempt: string, r: Results, at: Ms) {
  const { p, m } = find(w, agent, module)
  const x = m?.attempts.find((y) => y.id === attempt)
  if (!p || !m || !x || x.job !== 'running') return
  const best = r.runs.filter((run) => run.commit === x.bestCommit)
  const next = r.runs.filter((run) => run.commit === x.commit)
  const previous = m.attempts.findLast((y) => y !== x && y.tests)
  x.job = r.killed ? 'killed' : 'done'
  x.judgedAt = at
  x.tests = r.tests
  x.runs = r.runs
  x.touched = r.touched
  x.judged = judge({ tests: r.tests, killed: !!r.killed, best: best.map((b) => b.value), next: next.map((n) => n.value) }, m.goal)

  if (r.touched.length) raise(m, 'touchedVerifier', x.id, `${r.touched.join(', ')} changed. The runner used the frozen copy.`, at)
  if (r.tests && previous?.tests && r.tests.total < previous.tests.total)
    raise(m, 'fewerTests', x.id, `${r.tests.total} tests ran, ${previous.tests.total - r.tests.total} fewer than in ${previous.id}.`, at)
  const leastBest = Math.min(...best.map((b) => b.work))
  if (best.length && next.some((n) => n.work < leastBest)) raise(m, 'lessWork', x.id, `A run on the new commit did less work than the best commit's runs.`, at)

  const verdict = x.judged.verdict
  const target = targetOf(m)
  const steps = m.steps.length
  if (m.state === 'active') {
    if (verdict === 'win' && target !== null && x.judged.median !== null && reaches(x.judged.median, target, m.goal.direction)) {
      if (streakOf(m) >= 2 && x.step < steps) m.state = 'pastTarget'
      else stop(p, m, 'passed', at)
    } else if (verdict === 'fail' && failedTurns(m, x.step) >= 3) stop(p, m, 'stuck', at, 'step')
  } else if (m.state === 'pastTarget' && verdict !== 'win') stop(p, m, 'passed', at)
  settleModule(p, m, at)
}

export function markStepDone(w: World, agent: string, module: string, held: boolean, at: Ms) {
  const { p, m } = find(w, agent, module)
  if (!p || !m || (m.state !== 'active' && m.state !== 'pastTarget') || inFlight(m)) return
  const d = deadlineOf(m)
  const step = m.steps[currentStepIndex(m)]
  if (!step || (d !== null && at >= d)) return
  step.doneAt = at
  step.held = held
  if (currentStepIndex(m) < m.steps.length) return
  if (m.state === 'active') stop(p, m, 'stuck', at, 'target')
  else stop(p, m, 'passed', at)
}

/** Inserts a new module right after the given one. */
function insertAfter(p: WProject, after: WModule, spec: ModuleSpec) {
  const m = moduleFrom(spec, p.maxMinutes)
  p.modules.splice(p.modules.indexOf(after) + 1, 0, m)
  return m
}

export function currentOf(p: WProject): WModule | null {
  return p.modules.find((m) => m.state === 'active' || m.state === 'pastTarget' || m.state === 'stuck') ?? p.modules.find((m) => m.state === 'pending') ?? null
}

export function addModule(w: World, agent: string, spec: ModuleSpec) {
  const { p } = find(w, agent)
  const current = p && currentOf(p)
  if (p && current) insertAfter(p, current, spec)
}

export function abandon(w: World, agent: string, module: string, reason: string, followUp: ModuleSpec | null, at: Ms) {
  const { p, m } = find(w, agent, module)
  if (!p || !m || !(m.state === 'pending' || m.state === 'active' || m.state === 'stuck')) return
  if (!!lastWin(m) !== !!followUp) return
  const flight = inFlight(m)
  if (flight) flight.job = 'killed'
  m.reason = reason
  if (followUp) m.followUp = insertAfter(p, m, followUp).id
  stop(p, m, 'abandoned', at, m.cause)
}

export function fileChangeRequest(w: World, agent: string, module: string) {
  const { m } = find(w, agent, module)
  if (m?.verifiers.kind === 'frozen') m.verifiers = { ...m.verifiers, openChanges: m.verifiers.openChanges + 1 }
}

export function setBlurb(w: World, agent: string, blurb: string) {
  const a = w.agents.find((x) => x.id === agent)
  if (a) a.blurb = blurb
}

function settleModule(p: WProject, m: WModule, now: Ms) {
  if (m.state !== 'active' && m.state !== 'pastTarget') return
  const d = deadlineOf(m)
  if (d === null || now < d) return
  const last = lastAttempt(m)
  const out = last ? last.judgedAt : d + graceMinutes(m) * MINUTE
  if (out === null || now < out) return
  if (m.state === 'active') stop(p, m, 'stuck', out, 'time')
  else stop(p, m, 'passed', out)
}

/** Applies the time transitions that have come due by `now`, as the server does on every request. */
export function settle(w: World, now: Ms) {
  for (const a of w.agents) for (const m of a.project?.modules ?? []) settleModule(a.project!, m, now)
}

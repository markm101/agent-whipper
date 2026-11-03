// The module lifecycle as one table, which states take which calls, and the
// checks a spec passes before the server stores it. Commands consult these
// instead of testing states inline, so each rule lives in one place.
import type { Config, Goal, GoalSpec, ModuleSpec, ModuleState, ProjectSpec, StuckCause, VerifierSpec } from './records.ts'

/** Every event that moves a module, and where it moves each state that allows it. */
export const LIFECYCLE = {
  /** The baseline job measured the start commit. */
  baselineMeasured: { pending: 'active' },
  /** A win reached the target. */
  metTarget: { active: 'passed' },
  /** A win reached the target as the 2nd or later win in a row, with steps after the current one left. */
  metTargetOnStreak: { active: 'pastTarget' },
  /** The current step's 3rd failed turn. */
  stepFailed: { active: 'stuck' },
  /** The last step's check passed. */
  lastStepDone: { active: 'stuck', pastTarget: 'passed' },
  /** An attempt that isn't a win, once past target. */
  streakEnded: { pastTarget: 'passed' },
  /** The last attempt was judged, or the grace period ended without one. */
  outOfTime: { active: 'stuck', pastTarget: 'passed' },
  /** The agent recorded an abandon reason. */
  abandoned: { pending: 'abandoned', active: 'abandoned', stuck: 'abandoned' },
} as const satisfies Record<string, Partial<Record<ModuleState, ModuleState>>>

export type ModuleEvent = keyof typeof LIFECYCLE

/** What a move to stuck records. When one result triggers several, the first in this order wins. */
export const CAUSE: Partial<Record<ModuleEvent, StuckCause>> = { stepFailed: 'step', lastStepDone: 'target', outOfTime: 'time' }

export function nextState(event: ModuleEvent, from: ModuleState): ModuleState | null {
  const row: Partial<Record<ModuleState, ModuleState>> = LIFECYCLE[event]
  return row[from] ?? null
}

/** The states that take each agent call. */
export const TAKES = {
  attempt: ['active', 'pastTarget'],
  stepCheck: ['active', 'pastTarget'],
  abandon: ['pending', 'active', 'stuck'],
  verifiers: ['pending', 'active', 'pastTarget', 'stuck'],
} as const satisfies Record<string, readonly ModuleState[]>

export const takes = (call: keyof typeof TAKES, state: ModuleState) => (TAKES[call] as readonly ModuleState[]).includes(state)

export const ended = (state: ModuleState) => state === 'passed' || state === 'abandoned'
/** The states whose clock runs. */
export const live = (state: ModuleState) => state === 'active' || state === 'pastTarget'

export const TARGET_CAP = 20
export const DEFAULT_MIN_GAIN = 2
export const FAILED_TURNS = 3
export const GRACE_SHARE = 0.1

// Spec checks. Each returns the problem as a sentence, or null. They check
// types too, because the HTTP layer passes parsed JSON straight through.

export const isText = (x: unknown, max = 200): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\r\n]/.test(x)
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
export const isCommit = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{7,64}$/i.test(x)
export const isAgentId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)

export function maxMinutesProblem(x: unknown, config: Config): string | null {
  if (x === undefined) return null
  if (!number(x) || x <= 0) return 'maxMinutes must be a positive number.'
  if (x > config.maxMinutesCeiling) return `maxMinutes can be at most ${config.maxMinutesCeiling}.`
  return null
}

export function goalProblem(g: GoalSpec | undefined): string | null {
  if (!g || typeof g !== 'object') return 'A module needs a goal.'
  if (!isText(g.metric, 80)) return 'The goal needs a metric.'
  if (typeof g.unit !== 'string' || g.unit.length > 20) return 'The goal needs a unit, such as ms.'
  if (g.direction !== 'lower' && g.direction !== 'higher') return 'The goal direction must be lower or higher.'
  if (g.ambitious !== undefined && typeof g.ambitious !== 'boolean') return 'ambitious must be true or false.'
  if (!number(g.targetGain) || g.targetGain <= 0) return 'targetGain must be a positive percentage.'
  if (g.targetGain > TARGET_CAP && !g.ambitious) return `targetGain can be at most ${TARGET_CAP}% unless the goal sets ambitious: true.`
  if (g.direction === 'lower' && g.targetGain >= 100) return 'A lower goal can cut the metric by less than 100%.'
  const minGain = g.minGain ?? DEFAULT_MIN_GAIN
  if (!number(minGain) || minGain <= 0) return 'minGain must be a positive percentage.'
  if (minGain > g.targetGain) return `minGain (${minGain}%) can't exceed targetGain (${g.targetGain}%).`
  return null
}

export const goalOf = (g: GoalSpec): Goal => ({
  metric: g.metric.trim(),
  unit: g.unit.trim(),
  direction: g.direction,
  targetGain: g.targetGain,
  minGain: g.minGain ?? DEFAULT_MIN_GAIN,
  ambitious: g.ambitious ?? false,
})

export function moduleProblem(s: ModuleSpec | undefined, config: Config): string | null {
  if (!s || typeof s !== 'object') return 'A module spec must be an object.'
  if (!isText(s.title, 80)) return 'A module needs a one-line title.'
  if (!Array.isArray(s.steps) || s.steps.length === 0) return `Module "${s.title}" needs at least one step.`
  if (s.steps.length > 20) return `Module "${s.title}" has more than 20 steps. Split it into modules.`
  if (!s.steps.every((x) => isText(x, 120))) return `Every step of "${s.title}" needs a one-line title.`
  return goalProblem(s.goal) ?? maxMinutesProblem(s.maxMinutes, config)
}

export function projectProblem(s: ProjectSpec | undefined, config: Config): string | null {
  if (!s || typeof s !== 'object') return 'A project spec must be an object.'
  if (!isText(s.title, 80)) return 'A project needs a one-line title.'
  if (!isCommit(s.startCommit)) return 'startCommit must be a commit hash.'
  if (!Array.isArray(s.modules) || s.modules.length === 0) return 'A project needs at least one module.'
  if (s.modules.length > 50) return 'A project can have at most 50 modules.'
  const titles = new Set<string>()
  for (const m of s.modules) {
    const problem = moduleProblem(m, config)
    if (problem) return problem
    if (m.retryOf !== undefined) return 'Only an abandon follow-up can retry a module.'
    if (titles.has(m.title.trim())) return `Two modules are titled "${m.title}".`
    titles.add(m.title.trim())
  }
  return maxMinutesProblem(s.maxMinutes, config)
}

export function verifierProblem(v: VerifierSpec | undefined, steps: number): string | null {
  if (!v || typeof v !== 'object') return 'Verifiers must be an object.'
  if (!isText(v.hash, 128)) return 'The verifiers need a hash.'
  if (!Array.isArray(v.paths) || v.paths.length === 0 || !v.paths.every((p) => isText(p, 300))) return 'The verifiers need the paths of their files.'
  if (!isText(v.image, 200)) return 'The verifiers need a container image.'
  const c = v.commands
  if (!c || !isText(c.regression, 500) || !isText(c.benchmark, 500)) return 'The verifiers need a regression test command and a benchmark command.'
  if (!Array.isArray(c.steps) || c.steps.length !== steps || !c.steps.every((x) => isText(x, 500))) return `The verifiers need one test command for each of the module's ${steps} steps.`
  if (!isText(v.hardware, 40)) return 'The verifiers need a hardware label, such as cpu.'
  if (!number(v.timeLimitMinutes) || v.timeLimitMinutes <= 0 || v.timeLimitMinutes > 240) return 'timeLimitMinutes must be between 0 and 240.'
  return null
}

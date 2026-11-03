// A project goal's numbers, for the board line and the dashboard alike.
import type { Project } from './api.ts'

/** Whether the project's latest measurement reached its goal. */
export function metGoal(p: Project): boolean {
  const g = p.goal
  const r = p.progress
  if (!g || r?.state !== 'done') return false
  if (g.targetGain !== null) return r.gain >= g.targetGain
  return g.direction === 'lower' ? r.to <= g.target! : r.to >= g.target!
}

export interface GoalNumbers {
  /** The start commit's value: measured with the reached commit, or the first module's baseline until then. */
  from: number | null
  /** The value the goal aims for. Null for a percentage before the start is measured. */
  target: number | null
  /** The reached commit's value, once measured. */
  now: number | null
  /** How far `now` has come from `from` toward `target`, 0 to 1. */
  share: number
}

export function goalNumbers(p: Project): GoalNumbers {
  const g = p.goal!
  const r = p.progress?.state === 'done' ? p.progress : null
  const from = r?.from ?? p.modules[0]?.goal.baseline ?? null
  const target = g.target ?? (from === null ? null : from * (g.direction === 'lower' ? 1 - g.targetGain! / 100 : 1 + g.targetGain! / 100))
  const now = r?.to ?? null
  const share = from === null || target === null || now === null || from === target ? 0 : Math.min(1, Math.max(0, (now - from) / (target - from)))
  return { from, target, now, share: metGoal(p) ? 1 : share }
}

import type { Clock, Iso } from './api.ts'

const MINUTE = 60_000

export const minutesBetween = (from: Iso | Date, to: Iso | Date) => (new Date(to).getTime() - new Date(from).getTime()) / MINUTE

/** Whole minutes until the deadline, never below 0. Null when the clock isn't running. */
export function minutesLeft(clock: Clock, now: Date): number | null {
  if (clock.kind !== 'running') return null
  return Math.max(0, Math.ceil(minutesBetween(now, clock.deadline)))
}

/** The deadline as minutes after the module started, for placing it on a timeline. */
export function deadlineMinutes(clock: Clock): number | null {
  if (clock.kind === 'notStarted') return null
  return clock.maxMinutes + clock.extensions.reduce((sum, e) => sum + e.minutes, 0) + clock.waitedMinutes
}

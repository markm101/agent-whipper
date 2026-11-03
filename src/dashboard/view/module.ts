// What the pages read off a module. Display logic only: every judged number
// comes from the server as it is.
import type { Agent, Attempt, Clock, Module } from '../../shared/api.ts'
import { minutesLeft } from '../../shared/clock.ts'

export const currentModule = (a: Agent): Module | null => a.project?.modules.find((m) => m.id === a.project?.current) ?? null

/** 0-based index of the current step, or null when every step is done. */
export function currentStep(m: Module): number | null {
  const i = m.steps.findIndex((s) => !s.done)
  return i === -1 ? null : i
}

export const inFlight = (m: Module): Attempt | null => m.attempts.findLast((a) => a.job === 'queued' || a.job === 'running') ?? null

export type TimeLeft = { kind: 'running'; minutes: number; share: number; label: string } | { kind: 'grace'; share: number; label: string } | { kind: 'still'; label: string }

const share = (from: string, to: string, now: number) => {
  const [a, b] = [new Date(from).getTime(), new Date(to).getTime()]
  return b > a ? Math.min(1, Math.max(0, (b - now) / (b - a))) : 0
}

/** The time bar: what's left of the module's whole allowance, or of the grace period. */
export function timeLeft(m: Module, now: number): TimeLeft {
  const c: Clock = m.clock
  if (c.kind === 'running') {
    const left = minutesLeft(c, new Date(now)) ?? 0
    return { kind: 'running', minutes: left, share: share(c.startedAt, c.deadline, now), label: `${left} min left` }
  }
  if (c.kind === 'grace') {
    const label = inFlight(m) ? 'Time is up, last attempt in flight' : 'Time is up, 1 attempt left'
    return { kind: 'grace', share: share(c.deadline, c.graceEnds, now), label }
  }
  if (c.kind === 'notStarted') return { kind: 'still', label: 'Not started' }
  if (m.status.state === 'stuck' && m.status.cause === 'time') return { kind: 'still', label: 'Ran out of time' }
  return { kind: 'still', label: m.status.state === 'passed' ? 'Passed' : 'Clock stopped' }
}

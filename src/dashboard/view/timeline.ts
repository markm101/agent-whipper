// Where everything sits on a module's clock timeline, in minutes since the
// module became active. The component turns minutes into percentages.
import type { Attempt, AttemptId, Clock, Extension, Verdict } from '../../shared/api.ts'
import { deadlineMinutes, minutesBetween } from '../../shared/clock.ts'
import { extensionLabel } from './format.ts'

export interface Band {
  from: number
  to: number
}

export interface ExtensionBand extends Band {
  label: string
  cause: Extension['cause']
  /** How much of the span the band takes, so a label only shows where it fits. */
  size: 'wide' | 'narrow' | 'tiny'
}

export interface Timeline {
  span: number
  ticks: number[]
  /** maxMinutes plus runner waits: where the extensions start. */
  limit: number
  deadline: number
  elapsed: number
  /** The clock is running or in grace, so "now" is on it. */
  live: boolean
  grace: (Band & { open: boolean }) | null
  graceMinutes: number
  waits: Band[]
  extensions: ExtensionBand[]
  markers: { at: number; kind: Verdict | 'pending'; id: AttemptId }[]
  /** Finished steps that held the metric, from their extensions. */
  steps: number[]
}

const GRACE_SHARE = 0.1

function tickStep(span: number) {
  if (span <= 60) return 10
  if (span <= 120) return 15
  if (span <= 240) return 30
  return 60
}

export function timeline(clock: Clock, attempts: Attempt[], now: number): Timeline | null {
  if (clock.kind === 'notStarted' || clock.startedAt === null) return null
  const start = clock.startedAt
  const since = (at: string | number) => minutesBetween(start, new Date(at))
  const deadline = deadlineMinutes(clock)!
  const grace = clock.maxMinutes * GRACE_SHARE
  const live = clock.kind !== 'stopped'
  const elapsed = Math.max(0, since(clock.kind === 'stopped' ? clock.at : now))
  // Room for the most a module can earn, so the deadline visibly moves as extensions land
  const need = Math.max(2 * clock.maxMinutes + clock.waitedMinutes + grace, elapsed, deadline + grace)
  const step = tickStep(need)
  const span = Math.ceil(need / step) * step
  const limit = clock.maxMinutes + clock.waitedMinutes

  let from = limit
  const extensions = clock.extensions.map((e) => {
    const band = { from, to: from + e.minutes, label: extensionLabel(e.minutes), cause: e.cause }
    from = band.to
    const share = e.minutes / span
    return { ...band, size: share >= 0.08 ? 'wide' : share >= 0.04 ? 'narrow' : 'tiny' } as const
  })

  const graceBand =
    clock.kind === 'grace'
      ? { from: deadline, to: deadline + grace, open: true }
      : clock.kind === 'stopped' && elapsed > deadline
        ? { from: deadline, to: Math.min(elapsed, deadline + grace), open: false }
        : null

  return {
    span,
    ticks: Array.from({ length: span / step + 1 }, (_, i) => i * step),
    limit,
    deadline,
    elapsed: Math.min(elapsed, span),
    live,
    grace: graceBand,
    graceMinutes: grace,
    waits: clock.waits.map((w) => ({ from: since(w.at), to: since(w.at) + w.minutes })),
    extensions,
    markers: attempts.filter((a) => a.verdict || a.job === 'queued' || a.job === 'running').map((a) => ({ at: since(a.judgedAt ?? a.postedAt), kind: a.verdict ?? 'pending', id: a.id })),
    steps: clock.extensions.filter((e) => e.cause === 'step').map((e) => since(e.at)),
  }
}

/** Percent across the plot. */
export const place = (minutes: number, span: number) => `${(Math.min(span, Math.max(0, minutes)) / span) * 100}%`

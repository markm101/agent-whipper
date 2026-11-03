// The mock stands in for the server, so it judges attempts the way DESIGN.md
// says the server does. The UI never calls any of this.
import type { Direction, Verdict } from '../../../shared/api.ts'

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  if (s.length === 0) return Number.NaN
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** The baseline improved by `gain` percent, in the goal's direction. */
export const improve = (value: number, gain: number, direction: Direction) => value * (direction === 'lower' ? 1 - gain / 100 : 1 + gain / 100)

/** Percent by which `next` beats `best` in the goal's direction; negative when it's worse. */
export const gainOf = (best: number, next: number, direction: Direction) => ((direction === 'lower' ? best - next : next - best) / best) * 100

export const reaches = (value: number, target: number, direction: Direction) => (direction === 'lower' ? value <= target : value >= target)

function combinations(n: number, k: number): number[][] {
  const out: number[][] = []
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === k) return void out.push(chosen)
    for (let i = start; i < n; i++) pick(i + 1, [...chosen, i])
  }
  pick(0, [])
  return out
}

/**
 * Exact one-sided Mann-Whitney p: the share of all ways to split the pooled
 * runs in which `a` beats `b` at least as often as it really did. Ties count
 * half. Exact enumeration is cheap at 5 runs a side (252 splits).
 */
export function rankP(a: readonly number[], b: readonly number[], beats: (x: number, y: number) => boolean): number {
  const u = (xs: readonly number[], ys: readonly number[]) => {
    let sum = 0
    for (const x of xs) for (const y of ys) sum += beats(x, y) ? 1 : x === y ? 0.5 : 0
    return sum
  }
  const observed = u(a, b)
  const pooled = [...a, ...b]
  const splits = combinations(pooled.length, a.length)
  let hits = 0
  for (const idx of splits) {
    const inA = new Set(idx)
    const xs = idx.map((i) => pooled[i]!)
    const ys = pooled.filter((_, i) => !inA.has(i))
    if (u(xs, ys) >= observed - 1e-9) hits++
  }
  return hits / splits.length
}

export interface Judged {
  verdict: Verdict
  median: number | null
  bestMedian: number | null
  gain: number | null
  /** One-sided, in the direction the median moved: better for a gain, worse for a loss. */
  p: number | null
}

export interface JobResult {
  tests: { passed: number; total: number } | null
  killed: boolean
  best: readonly number[]
  next: readonly number[]
}

export function judge(r: JobResult, goal: { direction: Direction; minGain: number }): Judged {
  const none = { median: null, bestMedian: null, gain: null, p: null }
  if (r.killed || !r.tests || r.tests.passed < r.tests.total || r.next.length === 0) return { verdict: 'fail', ...none }
  const bestMedian = median(r.best)
  const next = median(r.next)
  const gain = gainOf(bestMedian, next, goal.direction)
  const better = (x: number, y: number) => (goal.direction === 'lower' ? x < y : x > y)
  if (gain >= 0) {
    const p = rankP(r.next, r.best, better)
    return { verdict: gain >= goal.minGain && p < 0.05 ? 'win' : 'flat', median: next, bestMedian, gain, p }
  }
  const p = rankP(r.next, r.best, (x, y) => better(y, x))
  return { verdict: p < 0.05 ? 'fail' : 'flat', median: next, bestMedian, gain, p }
}

/**
 * Extension sizes in the order they're earned: half of maxMinutes, then half
 * the previous each time, stopping before one would be under 5 minutes.
 */
export function extensionSeries(maxMinutes: number): number[] {
  const out: number[] = []
  for (let next = maxMinutes / 2; next >= 5; next /= 2) out.push(next)
  return out
}

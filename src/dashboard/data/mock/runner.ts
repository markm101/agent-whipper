// The mock's runner: turns "this attempt lands at a median of 331" into the
// runs, test counts and touched files a real runner would send.
import type { Run } from '../../../shared/api.ts'
import { bestOf, find, sendResults, type Ms, type World } from './world.ts'

export type Outcome = { median: number } | { failedTests: number } | { killed: true }

export interface ResultOptions {
  touched?: string[]
  /** Overrides the test count, for a job that ran fewer tests than it should. */
  testsTotal?: number
  /** Work per run on the new commit, when it differs from the module's usual. */
  work?: number
}

// Offsets in spreads, in run order. Both sets are centered, so each median is exact
const BEST_ORDER = [1, -1, 2, 0, -2]
const NEW_ORDER = [0, 2, -2, 1, -1]

export function results(w: World, agent: string, module: string, attempt: string, outcome: Outcome, opts: ResultOptions, at: Ms) {
  const { m } = find(w, agent, module)
  const x = m?.attempts.find((y) => y.id === attempt)
  const best = m && bestOf(m)
  if (!m || !x || best === null || best === undefined) return
  const touched = opts.touched ?? []
  if ('killed' in outcome) return sendResults(w, agent, module, attempt, { tests: null, runs: [], touched, killed: true }, at)
  // The runner runs the regression tests and the tests of every step that is done
  const total = opts.testsTotal ?? m.regressionTests + m.steps.reduce((sum, s) => sum + (s.doneAt === null ? 0 : s.tests), 0)
  if ('failedTests' in outcome) return sendResults(w, agent, module, attempt, { tests: { passed: total - outcome.failedTests, total }, runs: [], touched }, at)
  const { spread, work } = m.bench
  const runs: Run[] = BEST_ORDER.flatMap((offset, i) => [
    { commit: x.bestCommit, value: best + offset * spread, work },
    { commit: x.commit, value: outcome.median + NEW_ORDER[i]! * spread, work: opts.work ?? work },
  ])
  sendResults(w, agent, module, attempt, { tests: { passed: total, total }, runs, touched }, at)
}

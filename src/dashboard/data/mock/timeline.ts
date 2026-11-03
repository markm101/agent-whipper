// What happens on the board after load, one event per tick. Events only move
// forward: each is a call the server would take, at the time it lands.
import { ISOLATED_CONTEXTS } from './fixtures.ts'
import { results } from './runner.ts'
import { abandon, claimJob, freezeVerifiers, landBaseline, markStepDone, postAttempt, setBlurb, type Ms, type World } from './world.ts'

export interface TimelineEvent {
  label: string
  run: (w: World, at: Ms) => void
}

const post = (w: World, agent: string, module: string, id: string, note: string, runner: string | null, at: Ms) => {
  postAttempt(w, agent, module, id, note, at)
  if (runner) claimJob(w, agent, module, id, runner, at)
}

export const TIMELINE: TimelineEvent[] = [
  {
    label: 'agent 1’s a12 wins, meets the target on a streak of 2 and earns the first extension',
    run: (w, at) => results(w, '1', 'm5', 'a12', { median: 331 }, {}, at),
  },
  {
    label: 'agent 6 posts a5 and it waits for a runner',
    run: (w, at) => post(w, '6', 'm1', 'a5', 'Precompile the schema validator.', null, at),
  },
  {
    label: 'agent 5 posts its last attempt in the grace period',
    run: (w, at) => post(w, '5', 'm2', 'a8', 'Prefetch the next page on a side stream.', 'gpu-runner-1', at),
  },
  {
    label: 'a runner claims agent 6’s a5',
    run: (w, at) => claimJob(w, '6', 'm1', 'a5', 'runner-2', at),
  },
  {
    label: 'agent 1 finishes step 1 and the metric holds',
    run: (w, at) => {
      markStepDone(w, '1', 'm5', true, at)
      setBlurb(w, '1', 'Stopping once the top results can’t change.')
    },
  },
  {
    label: 'agent 5’s last attempt is flat, so kv cache paging runs out of time',
    run: (w, at) => results(w, '5', 'm2', 'a8', { median: 1750 }, {}, at),
  },
  {
    label: 'agent 3 abandons fixture reuse and proposes isolated contexts',
    run: (w, at) => {
      abandon(w, '3', 'm2', 'Every attempt assumed browser contexts are safe to share across files, but shared contexts leak state between tests.', ISOLATED_CONTEXTS, at)
      setBlurb(w, '3', 'Waiting for verifiers on isolated contexts.')
    },
  },
  {
    label: 'agent 6’s a5 wins and earns an extension',
    run: (w, at) => results(w, '6', 'm1', 'a5', { median: 841 }, {}, at),
  },
  {
    label: 'the verifier agent freezes agent 4’s retry',
    run: (w, at) => freezeVerifiers(w, '4', 'm3', 'verifier', 'cpu', at),
  },
  {
    label: 'agent 1 posts a13',
    run: (w, at) => post(w, '1', 'm5', 'a13', 'Stop scoring once the top 10 can’t change.', 'runner-1', at),
  },
  {
    label: 'agent 2 posts a9',
    run: (w, at) => post(w, '2', 'm2', 'a9', 'Pin the two hottest workers to their cores.', 'runner-3', at),
  },
  {
    label: 'agent 4’s retry measures its baseline and starts',
    run: (w, at) => {
      landBaseline(w, '4', 'm3', 1151, at)
      setBlurb(w, '4', 'Marking the date library side-effect free.')
    },
  },
  {
    label: 'agent 1’s a13 wins again',
    run: (w, at) => results(w, '1', 'm5', 'a13', { median: 324 }, {}, at),
  },
  {
    label: 'agent 2’s a9 is flat, so parse pool passes and zero-copy reads is next',
    run: (w, at) => {
      results(w, '2', 'm2', 'a9', { median: 2138 }, {}, at)
      setBlurb(w, '2', 'Waiting for the zero-copy baseline.')
    },
  },
  {
    label: 'the verifier agent freezes agent 3’s follow-up',
    run: (w, at) => freezeVerifiers(w, '3', 'm3', 'verifier', 'cpu', at),
  },
  {
    label: 'agent 2’s zero-copy reads measures its baseline and starts',
    run: (w, at) => {
      landBaseline(w, '2', 'm3', 2141, at)
      setBlurb(w, '2', 'Mapping input files into memory.')
    },
  },
  {
    label: 'agent 3’s follow-up measures its baseline and starts',
    run: (w, at) => {
      landBaseline(w, '3', 'm3', 597, at)
      setBlurb(w, '3', 'Pooling browser contexts per test file.')
    },
  },
]

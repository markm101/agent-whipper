// Six agents' nights so far, replayed through the same calls the server
// would take, so every derived number agrees with DESIGN.md. Times are minutes
// relative to t0, the moment the mock starts.
import type { AgentId, Direction } from '../../../shared/api.ts'
import { results, type Outcome, type ResultOptions } from './runner.ts'
import {
  MINUTE,
  abandon,
  addModule,
  claimJob,
  createProject,
  fileChangeRequest,
  freezeVerifiers,
  landBaseline,
  markStepDone,
  postAttempt,
  setBlurb,
  settle,
  type ModuleSpec,
  type Ms,
  type World,
} from './world.ts'

const goal = (metric: string, unit: string, direction: Direction, targetGain: number, ambitious = false) => ({ metric, unit, direction, targetGain, minGain: 2, ambitious })
const steps = (...s: [string, number][]) => s.map(([title, tests]) => ({ title, tests }))

type Bench = ModuleSpec['bench']
type Metric = { goal: (gain: number, ambitious?: boolean) => ModuleSpec['goal']; bench: Bench }
const metric = (name: string, unit: string, direction: Direction, bench: Bench): Metric => ({ goal: (gain, ambitious) => goal(name, unit, direction, gain, ambitious), bench })

const LATENCY = metric('p95 latency', 'ms', 'lower', { spread: 1, work: 12_000 })
const THROUGHPUT = metric('throughput', 'docs/s', 'higher', { spread: 6, work: 50_000 })
const SUITE = metric('suite time', 's', 'lower', { spread: 2, work: 1_312 })
const BUNDLE = metric('bundle size', 'kB', 'lower', { spread: 1, work: 2_310 })
const DECODE = metric('decode speed', 'tok/s', 'higher', { spread: 4, work: 4_096 })
const STARTUP = metric('startup time', 'ms', 'lower', { spread: 2, work: 200 })

type Extra = { ambitious?: boolean; retryOf?: string }
const spec = (m: Metric, id: string, title: string, gain: number, regressionTests: number, s: [string, number][], { ambitious, retryOf }: Extra = {}): ModuleSpec => ({
  id,
  title,
  steps: steps(...s),
  goal: m.goal(gain, ambitious),
  regressionTests,
  bench: m.bench,
  ...(retryOf ? { retryOf } : {}),
})

/** The follow-up agent 3 proposes when the timeline abandons fixture reuse. */
export const ISOLATED_CONTEXTS = spec(SUITE, 'm3', 'isolated contexts', 5, 20, [
  ['Pool browser contexts per test file', 4],
  ['Reset storage between tests', 3],
])

const TREE_SHAKING_STEPS: [string, number][] = [
  ['Mark packages side-effect free', 4],
  ['Split vendor chunks', 3],
]

type AttemptOptions = ResultOptions & { waited?: number; took?: number; runner?: string }

function story(w: World, agent: string, t0: Ms) {
  const at = (min: number) => t0 + min * MINUTE
  return {
    verifiers(min: number, modules: string[], author = 'verifier', hardware = 'cpu') {
      for (const m of modules) freezeVerifiers(w, agent, m, author, hardware, at(min))
    },
    baseline: (min: number, module: string, value: number) => landBaseline(w, agent, module, value, at(min)),
    attempt(min: number, module: string, id: string, note: string, outcome: Outcome | null, opts: AttemptOptions = {}) {
      const { waited = 0, took = 8, runner = 'runner-1' } = opts
      postAttempt(w, agent, module, id, note, at(min))
      claimJob(w, agent, module, id, runner, at(min + waited))
      if (outcome) results(w, agent, module, id, outcome, opts, at(min + waited + took))
    },
    step: (min: number, module: string, held = true) => markStepDone(w, agent, module, held, at(min)),
    abandon: (min: number, module: string, reason: string, followUp: ModuleSpec | null = null) => abandon(w, agent, module, reason, followUp, at(min)),
  }
}

function searchPerf(w: World, t0: Ms) {
  const s = story(w, '1', t0)
  createProject(w, '1', 'search-perf', [
    spec(LATENCY, 'm1', 'query cache', 10, 24, [
      ['Cache parsed queries', 6],
      ['Evict by memory size', 4],
      ['Warm the cache on start', 3],
    ]),
    spec(LATENCY, 'm2', 'index layout', 10, 24, [
      ['Block-compress postings', 5],
      ['Add skip-list headers', 4],
    ]),
    spec(LATENCY, 'm3', 'result scoring', 8, 24, [
      ['Precompute field norms', 4],
      ['Score in batches', 4],
    ]),
    spec(LATENCY, 'm4', 'response encoding', 5, 24, [
      ['Stream the JSON', 3],
      ['Drop unused fields', 2],
    ]),
  ])
  createProject(w, '1', 'index-size', [])
  s.verifiers(-302, ['m1', 'm2', 'm3', 'm4'])
  s.baseline(-300, 'm1', 415)
  s.attempt(-290, 'm1', 'a1', 'Cache parsed query trees by their text.', { median: 400 })
  s.attempt(-275, 'm1', 'a2', 'Normalize whitespace before the cache lookup.', { median: 390 })
  s.step(-260, 'm1')
  s.attempt(-252, 'm1', 'a3', 'Evict the least recently used entry first.', { median: 389 })
  s.attempt(-238, 'm1', 'a4', 'Evict the largest entries first.', { median: 380 })
  s.step(-224, 'm1')
  s.attempt(-215, 'm1', 'a5', 'Warm the cache from yesterday’s top queries.', { median: 371 })
  s.baseline(-200, 'm2', 371)
  s.attempt(-190, 'm2', 'a6', 'Block-compress postings with varints.', { median: 370 })
  s.step(-176, 'm2')
  s.attempt(-168, 'm2', 'a7', 'Add a skip-list header every 128 postings.', { failedTests: 2 })
  s.attempt(-150, 'm2', 'a8', 'Add a skip-list header every 64 postings.', { median: 384 })
  s.attempt(-132, 'm2', 'a9', 'Inline the headers into each block.', { failedTests: 1 })
  addModule(
    w,
    '1',
    spec(LATENCY, 'm5', 'early termination', 10, 24, [
      ['Skip low-impact terms', 5],
      ['Stop at the score bound', 4],
      ['Tune the bound', 3],
    ]),
  )
  s.verifiers(-100, ['m5'])
  s.abandon(-82, 'm2', 'Every attempt assumed smaller postings would cut latency, but decoding them costs more than the reads save.')
  s.baseline(-76, 'm5', 371)
  s.attempt(-62, 'm5', 'a10', 'Skip terms with an idf below 1.5.', { median: 368 }, { waited: 4 })
  s.attempt(-40, 'm5', 'a11', 'Skip terms with an idf below 2.', { median: 352 })
  s.attempt(-6, 'm5', 'a12', 'Skip terms with an idf below 2.5.', null)
  setBlurb(w, '1', 'Skipping low-impact query terms.')
}

function ingestRate(w: World, t0: Ms) {
  const s = story(w, '2', t0)
  createProject(w, '2', 'ingest-rate', [
    spec(THROUGHPUT, 'm1', 'batch writes', 10, 30, [
      ['Batch inserts', 6],
      ['Group commits', 5],
    ]),
    spec(THROUGHPUT, 'm2', 'parse pool', 12, 30, [
      ['Parse on worker threads', 6],
      ['Size the pool to the cores', 3],
      ['Reuse parser buffers', 4],
      ['Pin hot workers', 3],
    ]),
    spec(THROUGHPUT, 'm3', 'zero-copy reads', 8, 30, [
      ['Map files into memory', 4],
      ['Parse in place', 5],
    ]),
  ])
  s.verifiers(-205, ['m1', 'm2', 'm3'])
  s.baseline(-200, 'm1', 1610)
  s.attempt(-190, 'm1', 'a1', 'Insert in batches of 500.', { median: 1680 })
  s.attempt(-175, 'm1', 'a2', 'Insert in batches of 2,000.', { median: 1745 })
  s.step(-160, 'm1')
  s.attempt(-150, 'm1', 'a3', 'Group commits every 50 ms.', { median: 1790 })
  s.baseline(-130, 'm2', 1790)
  s.attempt(-120, 'm2', 'a4', 'Parse on 4 worker threads.', { median: 1880 })
  s.attempt(-105, 'm2', 'a5', 'Parse on 8 worker threads.', { median: 1885 }, { touched: ['bench/ingest.ts'] })
  s.step(-92, 'm2')
  s.attempt(-85, 'm2', 'a6', 'One worker per core, no hyperthreads.', { median: 1955 })
  s.attempt(-68, 'm2', 'a7', 'Size the pool to the physical cores.', { median: 2035 })
  s.step(-50, 'm2')
  s.attempt(-40, 'm2', 'a8', 'Reuse parser buffers per worker.', { median: 2140 })
  fileChangeRequest(w, '2', 'm2')
  setBlurb(w, '2', 'Reusing parser buffers across batches.')
}

function testSpeed(w: World, t0: Ms) {
  const s = story(w, '3', t0)
  createProject(w, '3', 'test-speed', [
    spec(SUITE, 'm1', 'parallel workers', 10, 20, [
      ['Split the suite by file', 4],
      ['Balance shards by duration', 3],
    ]),
    spec(SUITE, 'm2', 'fixture reuse', 8, 20, [
      ['Share database fixtures', 5],
      ['Reuse browser contexts', 4],
    ]),
  ])
  s.verifiers(-250, ['m1', 'm2'])
  s.baseline(-245, 'm1', 702)
  s.attempt(-235, 'm1', 'a1', 'Split the suite across 4 workers by file.', { median: 655 }, { took: 10 })
  s.attempt(-215, 'm1', 'a2', 'Split the suite across 8 workers by file.', { median: 628 }, { took: 10 })
  s.attempt(-195, 'm1', 'a3', 'Balance shards by the last run’s durations.', { median: 626 }, { took: 10 })
  s.baseline(-180, 'm2', 624)
  s.attempt(-170, 'm2', 'a4', 'Create the test database once per worker.', { median: 596 }, { took: 10 })
  s.step(-150, 'm2')
  s.attempt(-140, 'm2', 'a5', 'Share one browser context per worker.', { failedTests: 3 }, { took: 10 })
  s.attempt(-120, 'm2', 'a6', 'Share contexts and clear cookies between files.', { median: 612 }, { took: 10 })
  s.attempt(-100, 'm2', 'a7', 'Share contexts and reset local storage too.', { failedTests: 2 }, { took: 10 })
  setBlurb(w, '3', 'Reusing browser contexts across test files.')
}

function bundleSize(w: World, t0: Ms) {
  const s = story(w, '4', t0)
  createProject(w, '4', 'bundle-size', [
    spec(BUNDLE, 'm1', 'tree shaking', 25, 18, TREE_SHAKING_STEPS, { ambitious: true }),
    spec(BUNDLE, 'm2', 'lazy routes', 10, 18, [
      ['Load routes on demand', 4],
      ['Prefetch on hover', 2],
    ]),
  ])
  s.verifiers(-150, ['m1', 'm2'])
  s.baseline(-148, 'm1', 1240)
  s.attempt(-140, 'm1', 'a1', 'Mark the utility packages side-effect free.', { median: 1180 }, { took: 5 })
  s.attempt(-128, 'm1', 'a2', 'Mark the icon packages side-effect free.', { median: 1150 }, { took: 5 })
  s.step(-120, 'm1')
  s.attempt(-112, 'm1', 'a3', 'Split vendors by package.', { median: 1148 }, { took: 5 })
  s.attempt(-100, 'm1', 'a4', 'Split vendors by route.', { median: 1149 }, { took: 5 })
  s.step(-92, 'm1')
  s.abandon(
    -20,
    'm1',
    'Every attempt assumed most of the bundle was dead code, but the largest packages are mostly reachable.',
    spec(BUNDLE, 'm3', 'tree shaking retry', 12, 18, TREE_SHAKING_STEPS, { retryOf: 'm1' }),
  )
  setBlurb(w, '4', 'Retrying tree shaking with a 12% target.')
}

function decodeSpeed(w: World, t0: Ms) {
  const s = story(w, '5', t0)
  const gpu = { runner: 'gpu-runner-1' }
  createProject(
    w,
    '5',
    'decode-speed',
    [
      spec(DECODE, 'm1', 'fused attention', 10, 16, [
        ['Fuse the softmax', 6],
        ['Fuse the projection', 4],
      ]),
      spec(DECODE, 'm2', 'kv cache paging', 10, 16, [
        ['Page the KV cache', 5],
        ['Prefetch the next page', 4],
      ]),
      spec(DECODE, 'm3', 'speculative decoding', 15, 16, [
        ['Draft with a small model', 5],
        ['Verify drafts in batches', 4],
      ]),
    ],
    60,
  )
  s.verifiers(-142, ['m1', 'm2', 'm3'], 'verifier', 'gpu')
  s.baseline(-140, 'm1', 1520)
  s.attempt(-130, 'm1', 'a1', 'Fuse the softmax into the attention kernel.', { median: 1580 }, gpu)
  s.attempt(-115, 'm1', 'a2', 'Fold the scale into the softmax.', { median: 1640 }, gpu)
  s.step(-100, 'm1')
  s.attempt(-92, 'm1', 'a3', 'Fuse the output projection.', { median: 1690 }, gpu)
  s.baseline(-65, 'm2', 1690)
  s.attempt(-60, 'm2', 'a4', 'Page the cache in 16-token blocks.', { median: 1700 }, { ...gpu, waited: 3, took: 7 })
  s.attempt(-45, 'm2', 'a5', 'Page the cache in 64-token blocks.', { median: 1745 }, { ...gpu, took: 7 })
  s.attempt(-32, 'm2', 'a6', 'Page the cache in 128-token blocks.', { median: 1752 }, { ...gpu, took: 7 })
  s.attempt(-18, 'm2', 'a7', 'Keep the first page resident.', { median: 1749 }, { ...gpu, took: 7 })
  setBlurb(w, '5', 'Paging the KV cache in 64-token blocks.')
}

function coldStart(w: World, t0: Ms) {
  const s = story(w, '6', t0)
  createProject(w, '6', 'cold-start', [
    spec(STARTUP, 'm1', 'lazy imports', 15, 30, [
      ['Defer plugin imports', 8],
      ['Lazy-load the config schema', 6],
      ['Snapshot the module graph', 5],
    ]),
    spec(STARTUP, 'm2', 'precompiled templates', 8, 30, [
      ['Compile templates at build time', 4],
      ['Cache compiled templates', 3],
    ]),
  ])
  createProject(w, '6', 'memory-peak', [])
  createProject(w, '6', 'gc-pauses', [])
  s.verifiers(-122, ['m1'], '6')
  s.verifiers(-122, ['m2'])
  s.baseline(-115, 'm1', 940)
  s.attempt(-105, 'm1', 'a1', 'Import plugins on first use.', { median: 905 }, { took: 6 })
  s.attempt(-92, 'm1', 'a2', 'Import the CLI parser on first use.', { median: 872 }, { took: 6 })
  s.step(-80, 'm1')
  s.attempt(-72, 'm1', 'a3', 'Load the schema from a prebuilt JSON file.', { failedTests: 2 }, { took: 6 })
  s.attempt(-58, 'm1', 'a4', 'Load the schema on the first validate call.', { median: 869 }, { took: 6, testsTotal: 34 })
  setBlurb(w, '6', 'Lazy-loading the config schema.')
}

export function initialWorld(t0: Ms): World {
  const w: World = { agents: ['1', '2', '3', '4', '5', '6'].map((id) => ({ id: id as AgentId, blurb: '', project: null, queued: [] })) }
  for (const build of [searchPerf, ingestRate, testSpeed, bundleSize, decodeSpeed, coldStart]) build(w, t0)
  settle(w, t0)
  return w
}

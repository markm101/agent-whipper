import type { Agent, Module, Project, ProjectGoal } from './api.ts'
import { minutesBetween, minutesLeft } from './clock.ts'
import { goalNumbers, metGoal } from './projectGoal.ts'

/** Whole numbers from 100 up, three significant figures below, so small values still show progress. */
const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : String(Number(n.toPrecision(3))))

function goal(m: Module) {
  const g = m.goal
  const change = `${g.targetGain}% ${g.direction}`
  if (g.baseline === null || g.target === null) return `Goal: ${g.metric}, ${change}.`
  // The best value once a win has moved it off the baseline
  const best = m.best !== null && m.best !== g.baseline ? ` Best so far ${round(m.best)} ${g.unit}.` : ''
  return `Goal: ${g.metric} ${round(g.baseline)} -> ${round(g.target)} ${g.unit}, ${change}.${best}`
}

function status(m: Module, now: Date) {
  const s = m.status
  // A module whose turn it is knows the commit it starts from, which is where the agent's branch should be
  const from = m.bestCommit ? ` It starts from ${m.bestCommit.slice(0, 7)}.` : ''
  if (s.state === 'pending') {
    if (s.waitingFor === 'turn') return 'Not started.'
    // Frozen verifiers it still waits for are ones its baseline failed on
    if (s.waitingFor === 'verifiers' && m.verifiers.kind === 'frozen') return `Its baseline failed on its verifiers, so it waits for an approved change request.${from}`
    return `Waiting for its ${s.waitingFor}.${from}`
  }
  if (s.state === 'stuck') return 'Stuck, waiting for an abandon reason.'
  if (m.clock.kind === 'grace') return 'Time is up, 1 attempt left.'
  const left = minutesLeft(m.clock, now)
  return left === null ? '' : `${left} min left.`
}

const ended = (m: Module) => m.status.state === 'passed' || m.status.state === 'abandoned'

/**
 * Once the current module ends, the project ends, so the agent hears it while
 * it can still add one. A goal not yet met holds the project open instead,
 * unless the module would be the 3rd in a row to end without a win.
 */
function last(p: Project, m: Module) {
  if (!p.modules.every((x) => x === m || ended(x))) return ''
  if (!p.goal || metGoal(p)) return 'Last module in the project.'
  if (p.noWinRun === 2) return 'Last planned module, after 2 in a row without a win. If it ends without one too, the project ends short of its goal, so add the next one before then.'
  return 'Last planned module. The project stays open until it meets its goal, so plan the next one.'
}

/** The goal as a target: `25 s or lower`, or `40% lower than the start`. */
const aim = (g: ProjectGoal) => (g.target !== null ? `${round(g.target)} ${g.unit} or ${g.direction}` : `${g.targetGain}% ${g.direction} than the start`)

/** The project goal with the numbers measured so far: where it started, the value it aims for, and where it is now. */
function goalNow(p: Project): string {
  const g = p.goal!
  const { from, target, now } = goalNumbers(p)
  const span = from === null || target === null ? `${g.metric} ${aim(g)}` : `${g.metric} ${round(from)} -> ${round(target)} ${g.unit}${g.targetGain === null ? '' : `, ${g.targetGain}% ${g.direction}`}`
  return now === null ? span : `${span}, now ${round(now)} ${g.unit}`
}

function hoursLeft(p: Project, now: Date): string {
  const ends = p.goal?.budgetEndsAt
  if (!ends) return ''
  const h = minutesBetween(now, ends) / 60
  if (h <= 0) return 'Its hours are up, so no new module starts.'
  return `${h < 10 ? Number(h.toFixed(1)) : Math.round(h)} h left in the project.`
}

/** In a project short of its goal, one more module without a win ends it. */
const strikes = (p: Project) => (p.noWinRun === 2 ? '2 modules in a row ended without a win, so if the next one ends without a win too, the project ends short of its goal.' : '')

function projectGoal(p: Project, now: Date): string {
  if (!p.goal) return ''
  return [`Project goal${metGoal(p) ? ' met' : ''}: ${goalNow(p)}.`, hoursLeft(p, now)].filter(Boolean).join(' ')
}

const opposite = (d: 'lower' | 'higher') => (d === 'lower' ? 'higher' : 'lower')

/** What the project did to its metric: the final job's measurement, or an estimate from its modules until then. */
function outcome(p: Project): string {
  const f = p.progress
  if (f?.state === 'done') {
    const way = f.gain >= 0 ? f.direction : opposite(f.direction)
    return ` ${f.metric} ${round(f.from)} -> ${round(f.to)} ${f.unit}, ${Number(Math.abs(f.gain).toPrecision(2))}% ${way} over the project.`
  }
  if (f?.state === 'measuring') return ' Measuring its start against its end in one job now.'
  // Each module's change on its own benchmark, chained: only an estimate, since each was measured in a different job
  const started = p.modules.filter((m) => m.goal.baseline !== null && m.best !== null)
  const first = started[0]
  if (!first || !started.every((m) => m.goal.metric === first.goal.metric && m.goal.direction === first.goal.direction)) return ''
  const ratio = started.reduce((r, m) => r * (m.best! / m.goal.baseline!), 1)
  const change = first.goal.direction === 'lower' ? (1 - ratio) * 100 : (ratio - 1) * 100
  if (Math.abs(change) < 0.05) return ''
  return ` ${first.goal.metric} about ${Number(Math.abs(change).toPrecision(2))}% ${change >= 0 ? first.goal.direction : opposite(first.goal.direction)} overall.`
}

const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`

const ENDS = {
  goalMet: (g: ProjectGoal) => ` It met its goal of ${aim(g)}.`,
  budget: (g: ProjectGoal) => ` It fell short of its goal of ${aim(g)}: its ${hours(g.hours!)} ran out.`,
  noWins: (g: ProjectGoal) => ` It fell short of its goal of ${aim(g)}: 3 modules in a row ended without a win.`,
}

/** What an ended project achieved, and the commit a new project would start from. */
function summary(agentId: string, p: Project): string {
  const passed = p.modules.filter((m) => m.status.state === 'passed').length
  const abandoned = p.modules.length - passed
  const counts = [passed && `${passed} passed`, abandoned && `${abandoned} abandoned`].filter(Boolean).join(', ')
  const overall = outcome(p) + (p.goal && p.end && p.end !== 'modules' ? ENDS[p.end](p.goal) : '')
  // Every ended module leaves its best commit, so the last one's is where the project ended
  const commit = p.modules.at(-1)?.bestCommit
  const next = commit ? ` To keep climbing, create a new project from ${commit.slice(0, 7)}.` : ''
  return `agent ${agentId}: Project: ${p.title} ended: ${counts}.${overall}${next}`
}

/** The plain-text line the hook shows the agent and GET /board returns. */
export function boardLine(agent: Agent, now: Date): string {
  const p = agent.project
  if (!p) return `agent ${agent.id}: no open project`
  const m = p.modules.find((x) => x.id === p.current)
  const head = `agent ${agent.id}: Project: ${p.title}`
  if (p.state === 'measuring') return `${head}, every module has ended. Measuring how far it got toward its goal: ${goalNow(p)}.`
  if (p.state === 'short') {
    const from = p.reached ? ` from ${p.reached.slice(0, 7)}` : ''
    return [`${head}, short of its goal: ${goalNow(p)}. Add a module to keep climbing${from}.`, strikes(p), hoursLeft(p, now)].filter(Boolean).join(' ')
  }
  if (!m) return summary(agent.id, p)
  const done = m.steps.filter((s) => s.done).length
  const streak = m.streak >= 2 ? `${m.streak} wins in a row.` : ''
  const blurb = [agent.blurb, goal(m), streak, projectGoal(p, now), last(p, m), status(m, now)].filter(Boolean).join(' ')
  return `${head}, Module (${m.position} / ${p.modules.length}): ${m.title}, Progress: ${done} / ${m.steps.length}, Blurb: ${blurb}`
}

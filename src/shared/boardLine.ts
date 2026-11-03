import type { Agent, Module, Project } from './api.ts'
import { minutesLeft } from './clock.ts'

const round = (n: number) => Math.round(n).toLocaleString('en-US')

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
  if (s.state === 'pending') return s.waitingFor === 'turn' ? 'Not started.' : `Waiting for its ${s.waitingFor}.`
  if (s.state === 'stuck') return 'Stuck, waiting for an abandon reason.'
  if (m.clock.kind === 'grace') return 'Time is up, 1 attempt left.'
  const left = minutesLeft(m.clock, now)
  return left === null ? '' : `${left} min left.`
}

const ended = (m: Module) => m.status.state === 'passed' || m.status.state === 'abandoned'

/** Once the current module ends, the project ends, so the agent hears it while it can still add one. */
const last = (p: Project, m: Module) => (p.modules.every((x) => x === m || ended(x)) ? 'Last module in the project.' : '')

/** What an ended project achieved, and the commit a new project would start from. */
function summary(agentId: string, p: Project): string {
  const passed = p.modules.filter((m) => m.status.state === 'passed').length
  const abandoned = p.modules.length - passed
  const counts = [passed && `${passed} passed`, abandoned && `${abandoned} abandoned`].filter(Boolean).join(', ')
  const started = p.modules.filter((m) => m.goal.baseline !== null)
  const [first, end] = [started[0], started.at(-1)]
  const sameMetric = first && end && started.every((m) => m.goal.metric === first.goal.metric && m.goal.unit === first.goal.unit)
  const overall = sameMetric && end.best !== null ? ` ${first.goal.metric} ${round(first.goal.baseline!)} -> ${round(end.best)} ${first.goal.unit}.` : ''
  const lastModule = p.modules.at(-1)
  const commit = lastModule && (lastModule.status.state === 'passed' ? lastModule.headCommit : lastModule.bestCommit)
  const next = commit ? ` To keep climbing, create a new project from ${commit.slice(0, 7)}.` : ''
  return `agent ${agentId}: Project: ${p.title} ended: ${counts}.${overall}${next}`
}

/** The plain-text line the hook shows the agent and GET /board returns. */
export function boardLine(agent: Agent, now: Date): string {
  const p = agent.project
  if (!p) return `agent ${agent.id}: no open project`
  const m = p.modules.find((x) => x.id === p.current)
  if (!m) return summary(agent.id, p)
  const done = m.steps.filter((s) => s.done).length
  const streak = m.streak >= 2 ? `${m.streak} wins in a row.` : ''
  const blurb = [agent.blurb, goal(m), streak, last(p, m), status(m, now)].filter(Boolean).join(' ')
  return `agent ${agent.id}: Project: ${p.title}, Module (${m.position} / ${p.modules.length}): ${m.title}, Progress: ${done} / ${m.steps.length}, Blurb: ${blurb}`
}

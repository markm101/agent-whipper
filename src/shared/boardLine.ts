import type { Agent, Module } from './api.ts'
import { minutesLeft } from './clock.ts'

const round = (n: number) => Math.round(n).toLocaleString('en-US')

function goal(m: Module) {
  const g = m.goal
  const change = `${g.targetGain}% ${g.direction}`
  if (g.baseline === null || g.target === null) return `Goal: ${g.metric}, ${change}.`
  return `Goal: ${g.metric} ${round(g.baseline)} -> ${round(g.target)} ${g.unit}, ${change}.`
}

function status(m: Module, now: Date) {
  const s = m.status
  if (s.state === 'pending') return s.waitingFor === 'turn' ? 'Not started.' : `Waiting for its ${s.waitingFor}.`
  if (s.state === 'stuck') return 'Stuck, waiting for an abandon reason.'
  if (m.clock.kind === 'grace') return 'Time is up, 1 attempt left.'
  const left = minutesLeft(m.clock, now)
  return left === null ? '' : `${left} min left.`
}

/** The plain-text line the hook shows the agent and GET /board returns. */
export function boardLine(agent: Agent, now: Date): string {
  const p = agent.project
  const m = p?.modules.find((x) => x.id === p.current)
  if (!p || !m) return `agent ${agent.id}: no open project`
  const done = m.steps.filter((s) => s.done).length
  const streak = m.streak >= 2 ? `${m.streak} wins in a row.` : ''
  const blurb = [agent.blurb, goal(m), streak, status(m, now)].filter(Boolean).join(' ')
  return `agent ${agent.id}: Project: ${p.title}, Module (${m.position} / ${p.modules.length}): ${m.title}, Progress: ${done} / ${m.steps.length}, Blurb: ${blurb}`
}

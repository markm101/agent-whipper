import type { Project } from '../../shared/api.ts'
import { minutesBetween } from '../../shared/clock.ts'
import { goalNumbers, metGoal } from '../../shared/projectGoal.ts'
import { figure, short, type Tone } from '../view/format.ts'
import { Badge, Meter } from './parts.tsx'
import './project-goal.css'

const END = { goalMet: 'Met its goal', budget: 'Its hours ran out', noWins: '3 modules in a row ended without a win', modules: 'Its modules ran out' } as const

/** The project's goal: where it started, what it aims for, where it is now, and what holds it open or ended it. */
export function ProjectGoal({ project: p, now }: { project: Project; now: number }) {
  const g = p.goal
  if (!g) return null
  const { from, target, now: at, share } = goalNumbers(p)
  const met = metGoal(p)
  const unit = (n: number) => `${figure(n)} ${g.unit}`
  const aim = g.target !== null ? `${unit(g.target)} or ${g.direction}` : `${g.targetGain}% ${g.direction} than the start`
  const badge: { tone: Tone; text: string } =
    p.state === 'ended'
      ? met
        ? { tone: 'success', text: 'Met' }
        : { tone: 'neutral', text: 'Ended short' }
      : p.state === 'short'
        ? { tone: 'warning', text: 'Short of goal' }
        : { tone: 'accent', text: p.state === 'measuring' ? 'Measuring' : 'Climbing' }
  const left = g.budgetEndsAt === null ? null : minutesBetween(new Date(now), g.budgetEndsAt) / 60
  const notes = [
    g.hours !== null && (left !== null && left > 0 ? `${left < 10 ? left.toFixed(1) : Math.round(left)} of ${g.hours} h left` : `Its ${g.hours} h are up, so no new module starts`),
    p.noWinRun > 0 && p.state !== 'ended' && `${p.noWinRun} of 3 modules in a row without a win`,
    p.state === 'short' && p.reached && `The agent has to add a module, which starts from ${short(p.reached)}`,
    p.state === 'ended' && p.end && END[p.end],
  ].filter(Boolean)
  return (
    <section aria-labelledby="goal-title">
      <h2 id="goal-title" className="section-label">
        Project goal
      </h2>
      <div className="card goal">
        <div className="goal__head">
          <p className="goal__aim">
            {g.metric} {aim}
          </p>
          <Badge tone={badge.tone} dot={badge.tone === 'success'}>
            {badge.text}
          </Badge>
        </div>
        <Meter value={share} tone={met ? 'success' : p.state === 'short' ? 'warning' : 'accent'} className="goal__bar" />
        <div className="goal__numbers">
          <span>{from === null ? 'Start not measured yet' : `Started at ${unit(from)}`}</span>
          <span>{at === null ? 'Not measured since' : `Now ${unit(at)}, ${Math.round(share * 100)}% of the way`}</span>
          {target !== null && <span className="goal__target">Target {unit(target)}</span>}
        </div>
        {notes.length > 0 && <p className="goal__notes">{notes.join(' · ')}</p>}
      </div>
    </section>
  )
}

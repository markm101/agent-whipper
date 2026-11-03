import type { Agent, Attempt, Flag, Module } from '../../shared/api.ts'
import { Link } from '../router.tsx'
import { JOB, VERDICT, clockTime, flagTitle, short, withUnit } from '../view/format.ts'
import { currentStep, timeLeft } from '../view/module.ts'
import { attemptPath } from '../view/routes.ts'
import { ClockTimeline } from './ClockTimeline.tsx'
import { Badge, Icon, Spinner, StateBadge } from './parts.tsx'

// While a module is active, its current step fails at the 3rd failed turn
const TURNS = 3

function StepList({ m }: { m: Module }) {
  const current = currentStep(m)
  const s = m.status
  const failed = s.state === 'stuck' && s.cause === 'step' ? current : null
  const counting = s.state === 'active' || failed !== null
  // A module that passed or was abandoned before its last step skips the rest
  const over = s.state === 'passed' || s.state === 'abandoned'
  return (
    <ol className="steps">
      {m.steps.map((step, i) => {
        const state = step.done ? 'done' : over ? 'skipped' : i === failed ? 'failed' : i === current ? 'current' : 'later'
        const turns = counting && (state === 'current' || state === 'failed') ? `${step.failedTurns} of ${TURNS} failed turns` : null
        return (
          <li key={i} className="steps__row" data-state={state}>
            <span className="steps__mark">{step.done ? <Icon name="check" /> : <span className="steps__ring" />}</span>
            <span className="steps__title">
              <span className="steps__n">{i + 1}</span>
              {step.title}
            </span>
            <span className="steps__status">
              {state === 'done' && 'Done'}
              {state === 'failed' && 'Failed'}
              {state === 'skipped' && 'Skipped'}
              {state === 'current' && (s.state === 'pending' ? 'First' : 'Current')}
              {turns && (
                <span className="steps__turns" data-some={step.failedTurns > 0 || undefined}>
                  {turns}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function AttemptState({ a }: { a: Attempt }) {
  if (a.verdict)
    return (
      <Badge tone={VERDICT[a.verdict].tone} dot>
        {VERDICT[a.verdict].label}
      </Badge>
    )
  if (a.job === 'running')
    return (
      <Badge tone="accent" icon={<Spinner size={10} />}>
        Verifying
      </Badge>
    )
  return <Badge>{a.job === 'queued' ? 'Queued' : JOB[a.job]}</Badge>
}

function AttemptsTable({ agent, m }: { agent: Agent; m: Module }) {
  if (m.attempts.length === 0) return <p className="empty">No attempts yet.</p>
  return (
    <div className="attempts-wrap">
      <table className="attempts">
        <thead>
          <tr>
            <th scope="col">Attempt</th>
            <th scope="col" className="num">
              Step
            </th>
            <th scope="col" className="col-wide">
              Commit
            </th>
            <th scope="col" className="col-wide">
              Note
            </th>
            <th scope="col">Verdict</th>
            <th scope="col" className="num">
              Median
            </th>
            <th scope="col" className="num col-wide">
              Judged
            </th>
          </tr>
        </thead>
        <tbody>
          {m.attempts.map((a) => (
            <tr key={a.id}>
              <th scope="row">
                <Link href={attemptPath(agent.id, m.id, a.id)} className="attempts__link mono">
                  {a.id}
                </Link>
              </th>
              <td className="num">{a.step}</td>
              <td className="col-wide mono">{short(a.commit)}</td>
              <td className="col-wide attempts__note">{a.note}</td>
              <td>
                <AttemptState a={a} />
              </td>
              <td className="num attempts__median">{a.median !== null ? withUnit(a.median, m.goal.unit) : a.verdict ? <span className="faint">No runs</span> : <span className="faint">–</span>}</td>
              <td className="num col-wide faint">{a.judgedAt ? clockTime(a.judgedAt) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FlagList({ agent, m, flags, linkAttempts = true }: { agent: Agent; m: Module; flags: Flag[]; linkAttempts?: boolean }) {
  if (flags.length === 0) return <p className="empty">No flags.</p>
  return (
    <ul className="flags">
      {[...flags].reverse().map((f, i) => (
        <li key={`${f.at}${i}`} className="flag">
          <p className="flag__title">{flagTitle(f)}</p>
          <p className="flag__body">{f.detail}</p>
          <p className="flag__meta">
            {clockTime(f.at)}
            {f.attempt && linkAttempts && (
              <>
                {' · '}
                <Link href={attemptPath(agent.id, m.id, f.attempt)} className="text-link">
                  Open {f.attempt}
                </Link>
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function ModulePanel({ agent, m, now }: { agent: Agent; m: Module; now: number }) {
  const time = timeLeft(m, now)
  return (
    <section className="panel" aria-labelledby="panel-title">
      <h2 id="panel-title" className="section-label">
        Current module
      </h2>
      <div className="panel__head">
        <p className="panel__title">{m.title}</p>
        <span className="mono faint">{m.id}</span>
        <StateBadge state={m.status.state} />
        {m.streak >= 2 && <span className="panel__streak">{m.streak} wins in a row</span>}
      </div>
      <div className="panel__grid">
        <div className="card panel__steps">
          <div className="card__head">
            <h3 className="card__label">Steps</h3>
          </div>
          <StepList m={m} />
        </div>
        <div className="card panel__clock">
          <div className="card__head">
            <h3 className="card__label">Clock, in minutes since the module became active</h3>
            <span className="panel__note" data-kind={time.kind}>
              {time.label}
            </span>
          </div>
          <ClockTimeline m={m} now={now} />
        </div>
      </div>
      <div className="card panel__attempts">
        <div className="card__head">
          <h3 className="card__label">Attempts</h3>
        </div>
        <AttemptsTable agent={agent} m={m} />
      </div>
      <div className="card panel__flags">
        <div className="card__head">
          <h3 className="card__label">Flags</h3>
        </div>
        <FlagList agent={agent} m={m} flags={m.flags} />
      </div>
    </section>
  )
}

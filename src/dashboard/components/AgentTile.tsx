import { useRef } from 'react'
import type { Agent } from '../../shared/api.ts'
import { Collapse } from '../motion/Collapse.tsx'
import { Count } from '../motion/Count.tsx'
import { Link } from '../router.tsx'
import { cardView, type CardView } from '../view/card.ts'
import { figure } from '../view/format.ts'
import { agentPath } from '../view/routes.ts'
import { Meter, Spinner } from './parts.tsx'
import './agent-card.css'

function Dot({ dot }: { dot: CardView['dot'] }) {
  if (dot.busy) {
    return (
      <span className="agent-card__dot agent-card__dot--busy" data-tone={dot.tone} role="img" aria-label="An attempt is with the runner">
        <Spinner size={10} />
      </span>
    )
  }
  return <span className="agent-card__dot" data-tone={dot.tone} aria-hidden />
}

export function AgentTile({ agent, now }: { agent: Agent; now: number }) {
  const c = cardView(agent, now)
  // A closing callout keeps its words while it collapses, so it never goes blank mid-exit
  const lastCallout = useRef(c?.callout ?? null)
  if (c?.callout) lastCallout.current = c.callout
  const shown = c?.callout ?? lastCallout.current
  const name = (
    <h2 className="agent-card__agent">
      <Link href={agentPath(agent.id)} className="agent-card__link">
        agent {agent.id}
      </Link>
    </h2>
  )

  if (!c) {
    return (
      <article className="agent-card agent-card--idle">
        <header className="agent-card__head">
          <span className="agent-card__dot" data-tone="idle" aria-hidden />
          {name}
          <span className="agent-card__corner" data-tone="faint">
            Idle
          </span>
        </header>
        <p className="agent-card__sub">No open project</p>
        {agent.queued[0] && <p className="agent-card__under">Next: {agent.queued[0]}</p>}
      </article>
    )
  }

  return (
    <article className="agent-card" data-tone={c.dot.tone}>
      <header className="agent-card__head">
        <Dot dot={c.dot} />
        {name}
        <span className="agent-card__corner" data-tone={c.corner.tone}>
          {c.corner.text}
        </span>
      </header>
      <p className="agent-card__sub">{c.sub}</p>
      <p className="agent-card__metric">{c.metric}</p>
      <p className="agent-card__value">
        {c.value.kind === 'number' ? (
          <>
            <Count className="agent-card__number" value={c.value.best} duration={900} format={figure} />
            <span className="agent-card__unit">{c.value.unit}</span>
          </>
        ) : (
          <span className="agent-card__none">{c.value.text}</span>
        )}
        <span className="agent-card__target">{c.target}</span>
      </p>
      <Meter value={c.bar.share} tone={c.bar.tone} className="agent-card__bar" />
      <p className="agent-card__under">
        <span>{c.under.text}</span>
        {c.under.chip && <span className="agent-card__chip">{c.under.chip}</span>}
      </p>
      <p className="agent-card__goal" data-tone={c.goal?.tone}>
        {c.goal && (
          <>
            <span className="agent-card__goal-text">{c.goal.text}</span>
            {c.goal.now && <span className="agent-card__goal-now">{c.goal.now}</span>}
            <Meter value={c.goal.share} tone={c.goal.tone} className="agent-card__goal-bar" />
          </>
        )}
      </p>
      <p className="agent-card__blurb" data-empty={!c.blurb || undefined}>
        {c.blurb ?? 'No blurb yet.'}
      </p>
      <Collapse open={!!c.callout} reveal="drop" className="agent-card__callout-wrap">
        <p className="agent-card__callout" data-tone={shown?.tone}>
          {shown?.text ?? ' '}
        </p>
      </Collapse>
    </article>
  )
}

import type { Module } from '../../shared/api.ts'
import { extensionLabel, minutes } from '../view/format.ts'
import { place, timeline } from '../view/timeline.ts'
import './clock.css'

const CAUSE = { streak: 'a streak', win: 'a win', step: 'a finished step' } as const

/** The module's clock as the Clock demo draws it: minutes since it became active. */
export function ClockTimeline({ m, now }: { m: Module; now: number }) {
  const t = timeline(m.clock, m.attempts, now)
  if (!t) return <p className="empty">The clock starts when the module becomes active.</p>
  const x = (min: number) => place(min, t.span)
  const mid = (from: number, to: number) => x((from + to) / 2)
  const deadlineAt = (t.deadline / t.span) * 100
  const summary = `Deadline at ${Math.round(t.deadline)} minutes, ${Math.round(t.elapsed)} minutes ${t.live ? 'elapsed' : 'used'}.`
  return (
    <div className="clock">
      <div className="clock__plot" role="img" aria-label={summary}>
        <div className="clock__rail">
          <div className="clock__track" />
          <div className="clock__limit" style={{ width: x(t.limit) }} />
          <div className="clock__elapsed" style={{ width: x(t.elapsed) }} />
          {t.waits.map((w) => (
            <div key={w.from} className="clock__wait" style={{ left: x(w.from), width: `calc(${x(w.to)} - ${x(w.from)})` }} />
          ))}
          {t.waits
            .filter((w) => w.to - w.from >= 2)
            .map((w) => (
              <span key={w.from} className="clock__under" style={{ left: mid(w.from, w.to) }}>
                runner wait
              </span>
            ))}
          {t.extensions.map((e) => (
            <div key={e.from} className="clock__ext" style={{ left: x(e.from), width: `calc(${x(e.to)} - ${x(e.from)})` }} />
          ))}
          {t.extensions.map((e) => (
            <span key={e.from} className="clock__ext-label" data-size={e.size} style={{ left: mid(e.from, e.to) }}>
              {e.label}
            </span>
          ))}
          {t.grace && (
            <>
              <div className="clock__grace" data-open={t.grace.open || undefined} style={{ left: x(t.grace.from), width: `calc(${x(t.grace.to)} - ${x(t.grace.from)})` }} />
              <span className="clock__under clock__under--grace" style={{ left: mid(t.grace.from, t.grace.to) }}>
                grace
              </span>
            </>
          )}
          <div className="clock__deadline" style={{ left: x(t.deadline) }}>
            <span className="clock__deadline-label" data-edge={deadlineAt > 82 ? 'end' : undefined}>
              deadline {Math.round(t.deadline)} min
            </span>
          </div>
          {t.live && <div className="clock__now" style={{ left: x(t.elapsed) }} />}
          {t.steps.map((at) => (
            <span key={`s${at}`} className="clock__step" style={{ left: x(at) }} />
          ))}
          {t.markers.map((d) => (
            <span key={d.id} className="clock__dot" data-v={d.kind} style={{ left: x(d.at) }} title={d.id} />
          ))}
          {t.ticks.map((tick) => (
            <span key={tick} className="clock__tick" style={{ left: x(tick) }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      <ul className="clock__legend">
        <li>
          <span className="clock__swatch" data-kind="used" />
          {minutes(t.elapsed)} {t.live ? 'so far' : 'used'}
        </li>
        <li>
          <span className="clock__swatch" data-kind="limit" />
          {m.clock.kind !== 'notStarted' && `${m.clock.maxMinutes} min limit`}
        </li>
        {t.waits.length > 0 && m.clock.kind !== 'notStarted' && (
          <li>
            <span className="clock__swatch" data-kind="wait" />
            {minutes(m.clock.waitedMinutes)} of runner waits
          </li>
        )}
        {m.clock.kind !== 'notStarted' && m.clock.extensions.length > 0 && (
          <li>
            <span className="clock__swatch" data-kind="ext" />
            {m.clock.extensions.map((e) => `${extensionLabel(e.minutes)} for ${CAUSE[e.cause]}`).join(', ')}
          </li>
        )}
        {t.grace && (
          <li>
            <span className="clock__swatch" data-kind="grace" />
            {minutes(t.graceMinutes)} grace
          </li>
        )}
        {t.steps.length > 0 && (
          <li>
            <span className="clock__swatch" data-kind="step" />
            step done, metric held
          </li>
        )}
      </ul>
    </div>
  )
}

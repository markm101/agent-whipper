import { useRef } from 'react'
import { Badge, Bar, Collapse, Count, Meter, Roll, Spinner, States, Swap } from './kit'
import './tile.css'

export type Verdict = 'win' | 'flat' | 'fail'
export type TileState = 'pending' | 'active' | 'pastTarget' | 'stuck' | 'passed'

export type Tile = {
  agent: string
  project: string
  module: { n: number; total: number; title: string }
  state: TileState
  blurb: string
  steps: { total: number; done: number; failed?: number }
  metric: { name: string; unit: string; best: number; target: number | null }
  attempts: Verdict[]
  streak: number
  job: { label: string; busy: boolean; verdict?: Verdict } | null
  minutesLeft: number | null
  maxMinutes: number
  timeNote: string
  flag: string | null
}

const BADGE: Record<TileState, { tone: 'neutral' | 'accent' | 'success' | 'danger'; label: string }> = {
  pending: { tone: 'neutral', label: 'Pending' },
  active: { tone: 'accent', label: 'Active' },
  pastTarget: { tone: 'success', label: 'Past target' },
  stuck: { tone: 'danger', label: 'Stuck' },
  passed: { tone: 'success', label: 'Passed' },
}

const num = (n: number) => n.toLocaleString('en-US')

export function AgentTile({ t, className, target }: { t: Tile; className?: string; target?: string }) {
  const met = t.state === 'pastTarget' || t.state === 'passed'
  const stepWord = t.steps.failed ? `Step ${t.steps.failed} failed` : `${t.steps.done} / ${t.steps.total} steps`
  const targetWord = met ? 'Target met' : t.metric.target === null ? 'No target yet' : `Target ${num(t.metric.target)}`
  // Dots already on screen at load are history; only a judged attempt arrives
  const loaded = useRef({ module: t.module.n, count: t.attempts.length })
  const fresh = (i: number) => t.module.n !== loaded.current.module || i >= loaded.current.count
  return (
    <div className={`aw-tile${className ? ` ${className}` : ''}`} data-state={t.state} data-target={target}>
      <div className="aw-tile__head">
        <span className="aw-tile__agent">{t.agent}</span>
        <States
          align="end"
          value={t.state}
          states={
            Object.fromEntries(
              (Object.keys(BADGE) as TileState[]).map((k) => [
                k,
                <Badge key={k} tone={BADGE[k].tone} dot>
                  {BADGE[k].label}
                </Badge>,
              ]),
            ) as Record<TileState, JSX.Element>
          }
        />
      </div>
      <div className="aw-tile__sub">
        {t.project} · Module <Roll>{`${t.module.n} / ${t.module.total}`}</Roll>
      </div>

      <Swap id={String(t.module.n)} className="aw-tile__module">
        <div className="aw-tile__title">{t.module.title}</div>
        <div className="aw-tile__blurb" data-empty={!t.blurb || undefined}>
          <Roll variant="fade">{t.blurb || 'No blurb yet.'}</Roll>
        </div>
        <div className="aw-tile__steps">
          <div className="aw-tile__segments">
            {Array.from({ length: t.steps.total }, (_, i) => (
              <span key={i} className="aw-tile__segment" data-done={i < t.steps.done || undefined} data-failed={t.steps.failed === i + 1 || undefined} />
            ))}
          </div>
          <span className="aw-tile__steps-label">
            <Roll align="end">{stepWord}</Roll>
          </span>
        </div>
      </Swap>

      <div className="aw-tile__metric">
        <div className="aw-tile__value">
          <span className="aw-tile__metric-name">{t.metric.name}</span>
          <Count className="aw-tile__number" value={t.metric.best} duration={900} format={(n) => `${num(Math.round(n))} ${t.metric.unit}`} />
        </div>
        <span className="aw-tile__target" data-met={met || undefined}>
          <Roll align="end">{targetWord}</Roll>
        </span>
      </div>

      <div className="aw-tile__attempts">
        <span className="aw-tile__dots">
          {t.attempts.length === 0 && <span className="aw-tile__none">No attempts yet</span>}
          {t.attempts.map((v, i) => (
            <span key={i} className="aw-tile__dot" data-v={v} data-fresh={fresh(i) || undefined} />
          ))}
        </span>
        <Collapse open={t.streak >= 2} reveal="drop" className="aw-tile__streak-wrap">
          <span className="aw-tile__streak">{Math.max(2, t.streak)} wins in a row</span>
        </Collapse>
      </div>

      <div className="aw-tile__job" data-on={t.job ? '' : undefined}>
        <span className="aw-tile__job-mark">
          {t.job?.busy ? <Spinner size={11} /> : t.job?.verdict && <span className="aw-tile__dot" data-v={t.job.verdict} />}
        </span>
        <Roll variant="fade">{t.job?.label ?? ' '}</Roll>
      </div>

      <div className="aw-tile__time">
        <Meter value={t.minutesLeft === null ? 0 : Math.min(1, t.minutesLeft / t.maxMinutes)} tone={t.minutesLeft === null ? 'ink' : 'accent'} className="aw-tile__meter" />
        <States
          align="end"
          className="aw-tile__time-label"
          value={t.minutesLeft === null ? 'note' : 'running'}
          states={{
            note: t.timeNote,
            running: (
              <span>
                <Count value={t.minutesLeft ?? t.maxMinutes} duration={700} format={(n) => String(Math.round(n))} /> min left
              </span>
            ),
          }}
        />
      </div>

      <Collapse open={!!t.flag} reveal="drop">
        <div className="aw-tile__flag">{t.flag ?? ' '}</div>
      </Collapse>
    </div>
  )
}

export function FillerTile() {
  return (
    <div className="aw-tile aw-tile--filler" aria-hidden>
      <div className="aw-tile__head">
        <Bar w={58} h={7} tone={3} />
        <Bar w={52} h={18} r={9} tone={1} />
      </div>
      <div className="aw-tile__sub">
        <Bar w={96} h={6} tone={2} />
      </div>
      <div className="aw-tile__module">
        <Bar w={120} h={8} tone={3} />
        <Bar w={150} h={6} tone={2} style={{ marginTop: 10 }} />
      </div>
    </div>
  )
}

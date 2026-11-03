import { useState } from 'react'
import type { Agent, ChangeId, ChangeReview } from '../../shared/api.ts'
import { useDecide, useNow, useReview } from '../data/hooks.tsx'
import { lineDiff } from '../view/diff.ts'
import { ago } from '../view/format.ts'
import { Badge } from './parts.tsx'
import './changes.css'

function FileDiff({ path, before, after }: ChangeReview['files'][number]) {
  if (before === null && after === null)
    return (
      <div className="changes__file">
        <div className="changes__path mono">{path}</div>
        <div className="changes__meta">The demo data keeps no file contents.</div>
      </div>
    )
  const lines = lineDiff(before ?? '', after ?? '')
  return (
    <div className="changes__file">
      <div className="changes__path mono">
        {path}
        {before === null ? ' (new)' : after === null ? ' (deleted)' : ''}
      </div>
      <pre className="changes__diff">
        {lines.map((l, i) => (
          <span key={i} className="changes__line" data-kind={l.kind}>
            {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
            {l.text}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  )
}

/** Every verifier change request in the agent's project, open ones first, with your review, approve and reject actions. */
export function ChangeRequests({ agent }: { agent: Agent }) {
  const decide = useDecide()
  const review = useReview()
  const now = useNow()
  const [busy, setBusy] = useState<ChangeId | null>(null)
  const [error, setError] = useState<{ change: ChangeId; message: string } | null>(null)
  const [open, setOpen] = useState<{ change: ChangeId; review: ChangeReview | null } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const rows = (agent.project?.modules ?? []).flatMap((m) => m.changes.map((c) => ({ m, c }))).sort((x, y) => Number(y.c.state === 'open') - Number(x.c.state === 'open'))
  if (!rows.length) return null

  const act = async (change: ChangeId, approve: boolean) => {
    if (!decide) return
    setBusy(change)
    setError(null)
    const message = await decide(change, approve, notes[change]?.trim() || undefined)
    setBusy(null)
    if (message) setError({ change, message })
  }
  const toggle = async (change: ChangeId) => {
    if (open?.change === change) return setOpen(null)
    setOpen({ change, review: null })
    const r = review ? await review(change) : null
    setOpen((o) => (o?.change === change ? { change, review: r } : o))
  }

  return (
    <section aria-labelledby="changes-title">
      <h2 id="changes-title" className="section-label">
        Verifier change requests
      </h2>
      <ul className="card changes">
        {rows.map(({ m, c }) => (
          <li key={c.id} className="changes__row">
            <div className="changes__head">
              <div className="changes__main">
                <div className="changes__title">
                  {m.title} <span className="mono faint">{c.id}</span>
                </div>
                <div className="changes__reason">{c.reason}</div>
                <div className="changes__meta">
                  <span className="mono">{c.files.join(', ')}</span> · filed by agent {c.author} {ago(c.filedAt, now)}
                  {c.appliedTo.length > 0 && ` · also given to ${c.appliedTo.join(', ')}`}
                </div>
                {c.note && <div className="changes__note">Note: {c.note}</div>}
                {error?.change === c.id && <div className="changes__error">{error.message}</div>}
              </div>
              <div className="changes__side">
                {review && (
                  <button type="button" className="changes__button" aria-expanded={open?.change === c.id} onClick={() => toggle(c.id)}>
                    {open?.change === c.id ? 'Hide' : 'Review'}
                  </button>
                )}
                {c.state !== 'open' ? (
                  <Badge tone={c.state === 'approved' ? 'success' : 'neutral'} dot={c.state === 'approved'}>
                    {c.state === 'approved' ? 'Approved' : 'Rejected'}
                  </Badge>
                ) : decide ? (
                  <>
                    <button type="button" className="changes__button" disabled={busy !== null} onClick={() => act(c.id, false)}>
                      Reject
                    </button>
                    <button type="button" className="changes__button" data-primary disabled={busy !== null} onClick={() => act(c.id, true)}>
                      {busy === c.id ? 'Saving…' : 'Approve'}
                    </button>
                  </>
                ) : (
                  <Badge tone="warning">Open</Badge>
                )}
              </div>
            </div>
            {open?.change === c.id && (
              <div className="changes__review">
                {!open.review ? (
                  <div className="changes__meta">Loading the change…</div>
                ) : (
                  <>
                    {open.review.stale && <div className="changes__note">The verifiers changed after this was filed. Approving applies its edits to the current set.</div>}
                    {open.review.files.map((f) => (
                      <FileDiff key={f.path} {...f} />
                    ))}
                    {open.review.settings.map((x) => (
                      <div key={x.setting} className="changes__meta">
                        <span className="mono">{x.setting}</span>: {JSON.stringify(x.before)} → {JSON.stringify(x.after)}
                      </div>
                    ))}
                  </>
                )}
                {c.state === 'open' && decide && (
                  <input
                    className="changes__input"
                    placeholder="A note for the agent, sent with your decision"
                    value={notes[c.id] ?? ''}
                    maxLength={1000}
                    onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

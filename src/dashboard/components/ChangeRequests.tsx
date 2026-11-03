import { useState } from 'react'
import type { Agent, ChangeId } from '../../shared/api.ts'
import { useDecide, useNow } from '../data/hooks.tsx'
import { ago } from '../view/format.ts'
import { Badge } from './parts.tsx'
import './changes.css'

/** Every verifier change request in the agent's project, open ones first, with your approve and reject actions. */
export function ChangeRequests({ agent }: { agent: Agent }) {
  const decide = useDecide()
  const now = useNow()
  const [busy, setBusy] = useState<ChangeId | null>(null)
  const [error, setError] = useState<{ change: ChangeId; message: string } | null>(null)
  const rows = (agent.project?.modules ?? []).flatMap((m) => m.changes.map((c) => ({ m, c }))).sort((x, y) => Number(y.c.state === 'open') - Number(x.c.state === 'open'))
  if (!rows.length) return null

  const act = async (change: ChangeId, approve: boolean) => {
    if (!decide) return
    setBusy(change)
    setError(null)
    const message = await decide(change, approve)
    setBusy(null)
    if (message) setError({ change, message })
  }

  return (
    <section aria-labelledby="changes-title">
      <h2 id="changes-title" className="section-label">
        Verifier change requests
      </h2>
      <ul className="card changes">
        {rows.map(({ m, c }) => (
          <li key={c.id} className="changes__row">
            <div className="changes__main">
              <div className="changes__title">
                {m.title} <span className="mono faint">{c.id}</span>
              </div>
              <div className="changes__reason">{c.reason}</div>
              <div className="changes__meta">
                <span className="mono">{c.files.join(', ')}</span> · filed by agent {c.author} {ago(c.filedAt, now)}
              </div>
              {error?.change === c.id && <div className="changes__error">{error.message}</div>}
            </div>
            <div className="changes__side">
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
          </li>
        ))}
      </ul>
    </section>
  )
}

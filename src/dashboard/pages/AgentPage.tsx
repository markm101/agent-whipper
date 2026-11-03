import type { AgentId } from '../../shared/api.ts'
import { ChangeRequests } from '../components/ChangeRequests.tsx'
import { ModuleList } from '../components/ModuleList.tsx'
import { ModulePanel } from '../components/ModulePanel.tsx'
import { PageHead } from '../components/PageHead.tsx'
import { useBoard, useNow } from '../data/hooks.tsx'
import { plural } from '../view/format.ts'
import { currentModule } from '../view/module.ts'
import { NotFound } from './NotFound.tsx'
import './agent.css'

export function AgentPage({ id }: { id: AgentId }) {
  const board = useBoard()
  const now = useNow()
  const agent = board.agents.find((a) => a.id === id)
  if (!agent) return <NotFound what={`agent ${id}`} />
  const p = agent.project
  const m = currentModule(agent)
  const name = `agent ${agent.id}`
  return (
    <>
      <PageHead
        title={p ? `${name} · ${p.title}` : name}
        docTitle={name}
        crumbs={[{ href: '/', label: 'Board' }]}
        meta={
          <>
            <span className="page-head__meta">{p ? plural(p.modules.length, 'module') : 'No open project'}</span>
            {agent.queued.length > 0 && <span className="page-head__meta">Queued: {agent.queued.join(', ')}</span>}
          </>
        }
      />
      <div className="page-body agent">
        <section aria-labelledby="line-title">
          <h2 id="line-title" className="section-label">
            Board line
          </h2>
          <pre className="card line">
            <code>{agent.line}</code>
          </pre>
        </section>
        {p && (
          <section aria-labelledby="modules-title">
            <h2 id="modules-title" className="section-label">
              Modules
            </h2>
            <ModuleList agent={agent} />
          </section>
        )}
        {m ? <ModulePanel agent={agent} m={m} now={now} /> : p && <p className="empty">Every module in {p.title} has ended.</p>}
        <ChangeRequests agent={agent} />
      </div>
    </>
  )
}

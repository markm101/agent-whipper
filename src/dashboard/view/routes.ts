import type { AgentId, AttemptId, ModuleId } from '../../shared/api.ts'

export type Route = { page: 'board' } | { page: 'agent'; agent: AgentId } | { page: 'attempt'; agent: AgentId; module: ModuleId; attempt: AttemptId } | { page: 'notFound' }

export function matchRoute(pathname: string): Route {
  let parts: string[]
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return { page: 'notFound' }
  }
  const [root, agent, modules, module, attempts, attempt, ...rest] = parts
  if (root === undefined) return { page: 'board' }
  if (root !== 'agents' || agent === undefined || rest.length) return { page: 'notFound' }
  if (modules === undefined) return { page: 'agent', agent: agent as AgentId }
  if (modules === 'modules' && module !== undefined && attempts === 'attempts' && attempt !== undefined)
    return { page: 'attempt', agent: agent as AgentId, module: module as ModuleId, attempt: attempt as AttemptId }
  return { page: 'notFound' }
}

const part = encodeURIComponent
export const agentPath = (agent: AgentId) => `/agents/${part(agent)}`
export const attemptPath = (agent: AgentId, module: ModuleId, attempt: AttemptId) => `${agentPath(agent)}/modules/${part(module)}/attempts/${part(attempt)}`

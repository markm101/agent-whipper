import type { AgentId, AttemptDetail, AttemptId, Board, ModuleId } from '../../shared/api.ts'

/**
 * Where the dashboard's data comes from: the mock now, the server later.
 * `current` and `attempt` must return the same object until the data changes,
 * because React compares snapshots by identity.
 */
export interface BoardSource {
  current(): Board
  /** Calls the listener after every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Null when there is no such attempt. */
  attempt(agent: AgentId, module: ModuleId, attempt: AttemptId): AttemptDetail | null
}

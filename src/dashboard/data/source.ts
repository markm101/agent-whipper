import type { AgentId, AttemptDetail, AttemptId, Board, ChangeId, ModuleId } from '../../shared/api.ts'

/**
 * Where the dashboard's data comes from: whip-server over HTTP, or the mock.
 * `current` and `attempt` must return the same object until the data changes,
 * because React compares snapshots by identity.
 */
export interface BoardSource {
  current(): Board
  /** Calls the listener after every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Null when there is no such attempt, or while it loads. */
  attempt(agent: AgentId, module: ModuleId, attempt: AttemptId): AttemptDetail | null
  /** Approves or rejects a verifier change request. Resolves to the reason it failed, or null. */
  decide?(change: ChangeId, approve: boolean): Promise<string | null>
}

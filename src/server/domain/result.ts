// Every command returns a Result. A rejection names what was wrong in one
// sentence and leaves the world exactly as it was. Its kind is what the HTTP
// layer turns into a status: invalid is 400, notFound is 404, conflict is 409.

export type RejectionKind = 'invalid' | 'notFound' | 'conflict'

export type RejectionCode =
  // invalid: the request can never succeed as sent
  | 'badSpec'
  | 'badResults'
  | 'followUpRequired'
  | 'followUpNotAllowed'
  // notFound
  | 'noAgent'
  | 'noModule'
  | 'noAttempt'
  | 'noJob'
  | 'noChange'
  // conflict: the request doesn't fit the current state
  | 'noOpenProject'
  | 'titleTaken'
  | 'wrongState'
  | 'jobInFlight'
  | 'timeIsUp'
  | 'wrongStep'
  | 'alreadyBest'
  | 'verifiersFrozen'
  | 'verifiersMissing'
  | 'attemptIdTaken'
  | 'notYourJob'
  | 'changeDecided'
  | 'changeStale'

export interface Rejection {
  kind: RejectionKind
  code: RejectionCode
  message: string
}

export type Failure = { ok: false; rejection: Rejection }
export type Result<T> = { ok: true; value: T } | Failure

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const rejection = (kind: RejectionKind) => (code: RejectionCode, message: string): Failure => ({ ok: false, rejection: { kind, code, message } })
export const invalid = rejection('invalid')
export const notFound = rejection('notFound')
export const conflict = rejection('conflict')

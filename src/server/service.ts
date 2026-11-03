// The world in memory, kept in step with the store. Every write runs one
// domain command at the server's clock, saves what changed, and logs the
// call. Every read settles the world first, so a transition that came due
// between requests is applied before anyone sees the board.
import { settle } from './domain/commands.ts'
import { DEFAULTS, type Config, type Ms, type World } from './domain/records.ts'
import type { Result } from './domain/result.ts'
import type { Files, Store } from './store.ts'

export interface Service {
  /** Runs a command. `args` is what the log records, without file contents. */
  write<T>(call: string, args: unknown, run: (w: World, at: Ms, config: Config) => Result<T>): Result<T>
  read<T>(view: (w: World, now: Ms) => T): T
  putFiles(hash: string, files: Files): void
  files(hash: string): Files | null
  config: Config
}

export function createService(store: Store, config: Config = DEFAULTS, clock: () => Ms = Date.now): Service {
  let world = store.load()

  // A command that throws may have changed the world partway; go back to what was saved
  function guarded<T>(run: () => T): T {
    try {
      return run()
    } catch (e) {
      world = store.load()
      throw e
    }
  }

  return {
    config,
    write(call, args, run) {
      return guarded(() => {
        const at = clock()
        const r = run(world, at, config)
        store.save(world)
        // A runner polling an empty queue changes nothing worth a log row
        if (!(call === 'claimJob' && r.ok && r.value === null)) store.log({ at, call, args, outcome: r.ok ? 'ok' : r.rejection.code })
        return r
      })
    },
    read(view) {
      return guarded(() => {
        const now = clock()
        settle(world, now, config)
        store.save(world)
        return view(world, now)
      })
    },
    putFiles: (hash, files) => store.putFiles(hash, files),
    files: (hash) => store.files(hash),
  }
}

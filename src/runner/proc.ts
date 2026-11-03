// Running a process with a time limit and an abort signal, keeping the tail
// of its output.
import { spawn, type SpawnOptions } from 'node:child_process'

export interface Exit {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

const KEEP = 1024 * 1024

export function run(command: string, args: string[], opts: SpawnOptions & { timeoutMs?: number; signal?: AbortSignal; input?: string } = {}): Promise<Exit> {
  const { timeoutMs, signal, input, ...spawnOpts } = opts
  // An abort that already happened won't fire its event again, so check before starting anything
  if (signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true })
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...spawnOpts, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    const keep = (s: string, chunk: Buffer) => (s + chunk.toString('utf8')).slice(-KEEP)
    child.stdout!.on('data', (c: Buffer) => (stdout = keep(stdout, c)))
    child.stderr!.on('data', (c: Buffer) => (stderr = keep(stderr, c)))
    child.stdin!.end(input ?? '')
    const kill = () => child.kill('SIGKILL')
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => ((timedOut = true), kill()), Math.max(0, timeoutMs))
    const onAbort = () => ((aborted = true), kill())
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = (code: number | null) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut, aborted })
    }
    child.on('error', (e) => ((stderr += String(e)), done(null)))
    child.on('close', (code) => done(code))
  })
}

/** Runs a command that must succeed, and returns its stdout. */
export async function must(command: string, args: string[], opts: SpawnOptions & { timeoutMs?: number } = {}): Promise<string> {
  const r = await run(command, args, opts)
  if (r.code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${r.stderr.trim().slice(-500) || `exit ${r.code}`}`)
  return r.stdout
}

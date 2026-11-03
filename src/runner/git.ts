// Checkouts. Each remote is mirrored once under the work directory, and a
// commit is exported from the mirror as plain files, without .git, so the
// job container sees the tree and nothing else.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { must, run } from './proc.ts'

export class MissingCommit extends Error {}

/** Agents name the remote, so only plain transports are allowed: no ext:: commands. */
const env = (protocols: string) => ({ ...process.env, GIT_ALLOW_PROTOCOL: protocols, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' })

export function createGit(cacheRoot: string, protocols = 'https:ssh:git:file') {
  mkdirSync(cacheRoot, { recursive: true })
  const opts = (timeoutMs: number) => ({ env: env(protocols), timeoutMs: Math.min(10 * 60_000, timeoutMs) })
  const has = async (mirror: string, commit: string) => (await run('git', ['-C', mirror, 'cat-file', '-e', `${commit}^{commit}`], opts(60_000))).code === 0
  const mirrorPath = (repo: string) => join(cacheRoot, `${createHash('sha256').update(repo).digest('hex').slice(0, 16)}.git`)

  async function mirrorOf(repo: string, commit: string, timeoutMs: number): Promise<string> {
    const mirror = mirrorPath(repo)
    if (!existsSync(mirror)) await must('git', ['clone', '--mirror', '--quiet', '--', repo, mirror], opts(timeoutMs))
    if (await has(mirror, commit)) return mirror
    await run('git', ['-C', mirror, 'fetch', '--quiet', '--prune', 'origin'], opts(timeoutMs))
    if (!(await has(mirror, commit))) await run('git', ['-C', mirror, 'fetch', '--quiet', 'origin', commit], opts(timeoutMs))
    if (!(await has(mirror, commit))) throw new MissingCommit(`Commit ${commit} isn't in ${repo}. Push it where the runner can fetch it.`)
    return mirror
  }

  /** Writes the commit's tree into `into`. */
  async function checkout(repo: string, commit: string, into: string, timeoutMs: number): Promise<void> {
    const mirror = await mirrorOf(repo, commit, timeoutMs)
    mkdirSync(into, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const archive = spawn('git', ['-C', mirror, 'archive', '--format=tar', commit], { env: env(protocols), stdio: ['ignore', 'pipe', 'pipe'] })
      const tar = spawn('tar', ['-x', '-C', into], { stdio: ['pipe', 'ignore', 'pipe'] })
      let err = ''
      const timer = setTimeout(() => {
        err += 'timed out'
        archive.kill('SIGKILL')
        tar.kill('SIGKILL')
      }, Math.min(10 * 60_000, timeoutMs))
      archive.stderr.on('data', (c: Buffer) => (err += c))
      tar.stderr.on('data', (c: Buffer) => (err += c))
      archive.stdout.pipe(tar.stdin)
      let left = 2
      const done = () => (clearTimeout(timer), resolve())
      const fail = (what: string, code: number | null) => (clearTimeout(timer), reject(new Error(`${what} exited ${code}: ${err.trim().slice(-500)}`)))
      archive.on('close', (code) => (code === 0 ? --left || done() : fail('git archive', code)))
      tar.on('close', (code) => (code === 0 ? --left || done() : fail('tar', code)))
    })
  }

  /** Which of `paths` differ between two commits, added and deleted ones included. */
  async function changed(repo: string, from: string, to: string, paths: string[], timeoutMs: number): Promise<string[]> {
    const out = await must('git', ['-C', mirrorPath(repo), 'diff', '--name-only', '--no-renames', from, to, '--', ...paths], opts(timeoutMs))
    return out.split('\n').filter(Boolean)
  }

  return { checkout, changed }
}

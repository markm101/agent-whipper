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
const env = (protocols: string) => ({ ...process.env, GIT_ALLOW_PROTOCOL: protocols, GIT_TERMINAL_PROMPT: '0' })

export function createGit(cacheRoot: string, protocols = 'https:ssh:git:file') {
  mkdirSync(cacheRoot, { recursive: true })
  const opts = { env: env(protocols), timeoutMs: 10 * 60_000 }
  const has = async (mirror: string, commit: string) => (await run('git', ['-C', mirror, 'cat-file', '-e', `${commit}^{commit}`], opts)).code === 0

  async function mirrorOf(repo: string, commit: string): Promise<string> {
    const mirror = join(cacheRoot, `${createHash('sha256').update(repo).digest('hex').slice(0, 16)}.git`)
    if (!existsSync(mirror)) await must('git', ['clone', '--mirror', '--quiet', '--', repo, mirror], opts)
    if (await has(mirror, commit)) return mirror
    await run('git', ['-C', mirror, 'fetch', '--quiet', '--prune', 'origin'], opts)
    if (!(await has(mirror, commit))) await run('git', ['-C', mirror, 'fetch', '--quiet', 'origin', commit], opts)
    if (!(await has(mirror, commit))) throw new MissingCommit(`Commit ${commit} isn't in ${repo}. Push it where the runner can fetch it.`)
    return mirror
  }

  /** Writes the commit's tree into `into`. */
  async function checkout(repo: string, commit: string, into: string): Promise<void> {
    const mirror = await mirrorOf(repo, commit)
    mkdirSync(into, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const archive = spawn('git', ['-C', mirror, 'archive', '--format=tar', commit], { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] })
      const tar = spawn('tar', ['-x', '-C', into], { stdio: ['pipe', 'ignore', 'pipe'] })
      let err = ''
      archive.stderr.on('data', (c: Buffer) => (err += c))
      tar.stderr.on('data', (c: Buffer) => (err += c))
      archive.stdout.pipe(tar.stdin)
      let left = 2
      const fail = (what: string, code: number | null) => reject(new Error(`${what} exited ${code}: ${err.trim().slice(-500)}`))
      archive.on('close', (code) => (code === 0 ? --left || resolve() : fail('git archive', code)))
      tar.on('close', (code) => (code === 0 ? --left || resolve() : fail('tar', code)))
    })
  }

  return { checkout }
}

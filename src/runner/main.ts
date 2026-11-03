// whip-runner: claims jobs from whip-server one at a time and runs each in
// throwaway containers. Configured by environment variables; see .env.example.
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { dockerExecutor, localExecutor } from './exec.ts'
import { createGit } from './git.ts'
import { createApi, runJob, type JobDeps } from './job.ts'

const env = process.env
const need = (name: string) => {
  const v = env[name]?.trim()
  if (!v) throw new Error(`Set ${name}.`)
  return v
}

const server = need('WHIP_URL').replace(/\/$/, '')
const runner = env.WHIP_RUNNER_NAME?.trim() || hostname()
const labels = (env.WHIP_LABELS ?? 'cpu').split(',').map((l) => l.trim()).filter(Boolean)
const work = resolve(env.WHIP_WORK ?? '/tmp/whip-runner')
const pollMs = Number(env.WHIP_POLL_SECONDS ?? 5) * 1000
const local = env.WHIP_EXECUTOR === 'local'
if (local) console.warn('WHIP_EXECUTOR=local runs jobs on this machine without a container. Use it for tests only.')

const git = createGit(resolve(work, 'repos'), env.WHIP_GIT_PROTOCOLS)
const deps: JobDeps = {
  api: createApi(server, need('WHIP_RUNNER_TOKEN')),
  executor: local ? localExecutor : dockerExecutor({ ...(env.WHIP_CPUSET ? { cpuset: env.WHIP_CPUSET } : {}), ...(env.WHIP_MEMORY ? { memory: env.WHIP_MEMORY } : {}) }),
  checkout: git.checkout,
  runner,
  work,
  defaultRepo: env.WHIP_REPO?.trim() || null,
  renewEveryMs: Number(env.WHIP_RENEW_SECONDS ?? 30) * 1000,
  log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
}

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    // A job cut short is requeued when its lease lapses
    if (stopping) process.exit(1)
    stopping = true
    deps.log('stopping after the current job; signal again to stop now')
  })

deps.log(`${runner} claiming ${labels.join(', ')} jobs from ${server}`)
while (!stopping) {
  try {
    const job = await deps.api.claim(runner, labels)
    if (!job) {
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    deps.log(`running ${job.job}: ${job.kind} for agent ${job.agent} ${job.module}`)
    await runJob(job, deps)
    deps.log(`finished ${job.job}`)
  } catch (e) {
    deps.log(`error: ${(e as Error).message}`)
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

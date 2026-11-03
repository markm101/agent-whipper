// whip-runner: claims jobs from whip-server one at a time and runs each in
// throwaway containers. Configured by environment variables; see .env.example.
import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
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
  executor: local ? localExecutor : dockerExecutor({ runner, ...(env.WHIP_CPUSET ? { cpuset: env.WHIP_CPUSET } : {}), ...(env.WHIP_MEMORY ? { memory: env.WHIP_MEMORY } : {}) }),
  checkout: git.checkout,
  changed: git.changed,
  runner,
  work,
  defaultRepo: env.WHIP_REPO?.trim() || null,
  renewEveryMs: Number(env.WHIP_RENEW_SECONDS ?? 30) * 1000,
  log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
}

// Stopping abandons the current job and removes its containers; its lease lapses and another runner takes it
const stop = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stop.signal.aborted) process.exit(1)
    deps.log('stopping')
    stop.abort()
  })

const swept = (await deps.executor.sweep?.()) ?? 0
if (swept) deps.log(`removed ${swept} containers a previous run left behind`)
deps.log(`${runner} claiming ${labels.join(', ')} jobs from ${server}`)
while (!stop.signal.aborted) {
  try {
    const job = await deps.api.claim(runner, labels)
    if (!job) {
      await sleep(pollMs, null, { signal: stop.signal }).catch(() => {})
      continue
    }
    deps.log(`running ${job.job}: ${job.kind} for agent ${job.agent} ${job.module}`)
    await runJob(job, deps, stop.signal)
    deps.log(`finished ${job.job}`)
  } catch (e) {
    deps.log(`error: ${(e as Error).message}`)
    await sleep(pollMs, null, { signal: stop.signal }).catch(() => {})
  }
}

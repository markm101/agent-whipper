// The HTTP API from DESIGN.md, the dashboard's JSON, and the built dashboard
// itself. Each route names the tokens it takes, parses its body, and hands
// one call to the service. A rejection becomes 400, 404 or 409 with its code
// and sentence. Browser page loads (Accept: text/html) get the dashboard, so
// /agents/1 is a page in a browser and the board line for curl.
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { AgentId, AttemptId, ModuleId } from '../shared/api.ts'
import * as cmd from './domain/commands.ts'
import { locate, verifiersOf } from './domain/queries.ts'
import type { JobResults, ModuleSpec, ProjectSpec } from './domain/records.ts'
import type { Result } from './domain/result.ts'
import { verifierProblem } from './domain/rules.ts'
import * as view from './domain/view.ts'
import type { Service } from './service.ts'
import { filesProblem, merge, specOf, type ChangeBody, type VerifierUpload } from './verifiers.ts'

export type Role = 'agent' | 'runner' | 'admin'
export type Tokens = Record<Role, string>

export interface HttpOptions {
  service: Service
  tokens: Tokens
  /** The built dashboard, or null to serve none. */
  dashboard: string | null
}

interface Reply {
  status: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

interface Ctx {
  req: IncomingMessage
  params: string[]
  body: () => Promise<unknown>
}

class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const json = (value: unknown, status = 200): Reply => ({ status, json: value })
const STATUS = { invalid: 400, notFound: 404, conflict: 409 } as const
const reply = <T>(r: Result<T>, shape: (v: T) => unknown = (v) => v): Reply =>
  r.ok ? json(shape(r.value)) : json({ error: r.rejection.code, message: r.rejection.message }, STATUS[r.rejection.kind])
const missing = (what: string): Reply => json({ error: 'notFound', message: `There is no ${what}.` }, 404)

// Auth

const CHALLENGE = 'Basic realm="Agent Whipper", charset="UTF-8"'
const digest = (s: string) => createHash('sha256').update(s).digest()
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

/** The roles the request's token grants: a bearer token, or the admin token as a Basic password for the browser. */
function rolesOf(req: IncomingMessage, tokens: Tokens): Set<Role> {
  const header = req.headers.authorization ?? ''
  let token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim()
  const basic = /^Basic\s+(.+)$/i.exec(header)?.[1]
  if (!token && basic) token = Buffer.from(basic, 'base64').toString('utf8').split(':').slice(1).join(':')
  const roles = new Set<Role>()
  if (!token) return roles
  for (const role of ['agent', 'runner', 'admin'] as const) if (same(token, tokens[role])) roles.add(role)
  return roles
}

// Bodies

const LIMIT = 1024 * 1024
const UPLOAD_LIMIT = 12 * 1024 * 1024

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, 'tooLarge', `The body can be at most ${limit / 1024 / 1024} MB.`)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  if ((req.headers['content-type'] ?? '').startsWith('text/plain')) return text
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'badJson', 'The body must be JSON.')
  }
}

const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, 'badJson', 'The body must be a JSON object.')
  return x as Record<string, unknown>
}

function upload(body: unknown, steps: number): VerifierUpload {
  const b = object(body)
  const problem = filesProblem(b.files)
  if (problem) throw new HttpError(400, 'badSpec', problem)
  const u = { files: b.files, image: b.image, commands: b.commands, hardware: b.hardware, timeLimitMinutes: b.timeLimitMinutes } as VerifierUpload
  const specProblem = verifierProblem({ ...u, hash: 'pending', paths: Object.keys(u.files) }, steps)
  if (specProblem) throw new HttpError(400, 'badSpec', specProblem)
  return u
}

// Routes

type Handler = (s: Service, c: Ctx) => Reply | Promise<Reply>
type Route = [method: string, path: RegExp, roles: Role[], handler: Handler, limit?: number]

const P = (pattern: string) => new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`)
const find = (s: Service, agent: string, module: string) => s.read((w) => locate(w, agent, module))

/** The module's step count, for checking an upload, or a 404 when there's no such module. */
const stepsOf = (s: Service, agent: string, module: string) => {
  const found = find(s, agent, module)
  if (!found) throw new HttpError(404, 'noModule', `Agent ${agent} has no module ${module}.`)
  return found.m.steps.length
}

const ROUTES: Route[] = [
  [
    'POST',
    P('/agents/:id/projects'),
    ['agent'],
    async (s, { params: [agent], body }) => {
      const spec = object(await body()) as unknown as ProjectSpec
      return reply(s.write('createProject', { agent, spec }, (w, at, config) => cmd.createProject(w, at, { agent: agent!, spec }, config)))
    },
  ],
  [
    'PUT',
    P('/agents/:id/blurb'),
    ['agent'],
    async (s, { params: [agent], body }) => {
      const b = await body()
      const blurb = typeof b === 'string' ? b.trim() : (object(b).blurb as string)
      return reply(
        s.write('setBlurb', { agent, blurb }, (w, at, config) => cmd.setBlurb(w, at, { agent: agent!, blurb }, config)),
        () => ({ blurb: blurb.trim() }),
      )
    },
  ],
  [
    'POST',
    P('/agents/:id/modules'),
    ['agent'],
    async (s, { params: [agent], body }) => {
      const spec = object(await body()) as unknown as ModuleSpec
      return reply(s.write('addModule', { agent, spec }, (w, at, config) => cmd.addModule(w, at, { agent: agent!, spec }, config)))
    },
  ],
  [
    'POST',
    P('/agents/:id/modules/:m/verifiers'),
    ['agent'],
    async (s, { params: [agent, module], body }) => {
      const b = object(await body())
      const u = upload(b, stepsOf(s, agent!, module!))
      const spec = specOf(u)
      const author = b.author as string
      s.putFiles(spec.hash, u.files)
      return reply(
        s.write('freezeVerifiers', { agent, module, author, hash: spec.hash, paths: spec.paths }, (w, at, config) =>
          cmd.freezeVerifiers(w, at, { agent: agent!, module: module!, author, verifiers: spec }, config),
        ),
      )
    },
    UPLOAD_LIMIT,
  ],
  [
    'POST',
    P('/agents/:id/modules/:m/verifiers/changes'),
    ['agent'],
    async (s, { params: [agent, module], body }) => {
      const b = object(await body()) as unknown as ChangeBody
      const found = find(s, agent!, module!)
      if (!found) return missing(`module ${module} for agent ${agent}`)
      const current = verifiersOf(found.m)
      if (!current) return json({ error: 'verifiersMissing', message: `${module} has no verifiers to change. Submit them instead.` }, 409)
      const files = s.files(current.hash)
      if (!files) throw new Error(`The files of verifier set ${current.hash} are missing from the store`)
      if (b.files !== undefined && (typeof b.files !== 'object' || b.files === null)) throw new HttpError(400, 'badSpec', 'files must map each path to its content, or to null to delete it.')
      const { upload: next, changed } = merge({ ...current, files }, b)
      const problem = filesProblem(next.files) ?? verifierProblem({ ...specOf(next) }, found.m.steps.length)
      if (problem) throw new HttpError(400, 'badSpec', problem)
      const proposed = specOf(next)
      s.putFiles(proposed.hash, next.files)
      return reply(
        s.write('fileChange', { agent, module, reason: b.reason, hash: proposed.hash, changed }, (w, at, config) =>
          cmd.fileChange(w, at, { agent: agent!, module: module!, reason: b.reason, proposed, changed }, config),
        ),
      )
    },
    UPLOAD_LIMIT,
  ],
  [
    'GET',
    P('/agents/:id/modules/:m/verifiers/changes/:change'),
    ['agent'],
    (s, { params: [agent, module, change] }) => {
      const c = s.read((w) => view.changeOf(w, agent!, module!, change!))
      return c ? json(c) : missing(`change request ${change} on ${module}`)
    },
  ],
  [
    'POST',
    P('/agents/:id/modules/:m/attempts'),
    ['agent'],
    async (s, { params: [agent, module], body }) => {
      const b = object(await body())
      const args = { agent: agent!, module: module!, attempt: b.attemptId as string, commit: b.commit as string, note: b.note as string }
      const r = s.write('postAttempt', args, (w, at, config) => cmd.postAttempt(w, at, args, config))
      return reply(r, (v) => s.read((w, now) => view.attemptStatusOf(w, agent!, module!, v.attempt, now)))
    },
  ],
  [
    'GET',
    P('/agents/:id/modules/:m/attempts/:a'),
    ['agent'],
    (s, { params: [agent, module, attempt] }) => {
      const status = s.read((w, now) => view.attemptStatusOf(w, agent!, module!, attempt!, now))
      return status ? json(status) : missing(`attempt ${attempt} on agent ${agent}'s ${module}`)
    },
  ],
  [
    'POST',
    P('/agents/:id/modules/:m/steps/:n/done'),
    ['agent'],
    (s, { params: [agent, module, n] }) => {
      const args = { agent: agent!, module: module!, step: Number(n) }
      return reply(s.write('stepDone', args, (w, at, config) => cmd.stepDone(w, at, args, config)))
    },
  ],
  [
    'POST',
    P('/agents/:id/modules/:m/abandon'),
    ['agent'],
    async (s, { params: [agent, module], body }) => {
      const b = object(await body())
      const args = { agent: agent!, module: module!, reason: b.reason as string, ...(b.followUp ? { followUp: b.followUp as ModuleSpec } : {}) }
      return reply(s.write('abandon', args, (w, at, config) => cmd.abandon(w, at, args, config)))
    },
  ],
  [
    'GET',
    P('/agents/:id'),
    ['agent'],
    (s, { params: [agent] }) => {
      const line = s.read((w, now) => {
        const a = w.agents.find((x) => x.id === agent)
        return a ? view.agentView(a, now).line : null
      })
      return line ? { status: 200, text: `${line}\n` } : { status: 404, text: `agent ${agent}: unknown to whip-server\n` }
    },
  ],
  ['GET', P('/board'), ['agent', 'admin'], (s) => ({ status: 200, text: `${s.read((w, now) => view.boardText(w, now))}\n` })],

  // The dashboard's data and actions
  ['GET', P('/api/board'), ['admin'], (s) => json(s.read((w, now) => view.boardOf(w, now)))],
  [
    'GET',
    P('/api/agents/:id/modules/:m/attempts/:a'),
    ['admin'],
    (s, { params: [agent, module, attempt] }) => {
      const d = s.read((w) => view.attemptDetailOf(w, agent as AgentId, module as ModuleId, attempt as AttemptId))
      return d ? json(d) : missing(`attempt ${attempt}`)
    },
  ],
  [
    'POST',
    P('/admin/changes/:change'),
    ['admin'],
    async (s, { params: [change], body }) => {
      const b = object(await body())
      if (typeof b.approve !== 'boolean') throw new HttpError(400, 'badSpec', 'Send {"approve": true} or {"approve": false}.')
      const args = { change: change!, approve: b.approve }
      return reply(s.write('decideChange', args, (w, at, config) => cmd.decideChange(w, at, args, config)))
    },
  ],
  [
    'PUT',
    P('/admin/agents/:id/modules/:m/verifiers'),
    ['admin'],
    async (s, { params: [agent, module], body }) => {
      const u = upload(await body(), stepsOf(s, agent!, module!))
      const spec = specOf(u)
      s.putFiles(spec.hash, u.files)
      return reply(s.write('replaceVerifiers', { agent, module, hash: spec.hash, paths: spec.paths }, (w, at, config) => cmd.replaceVerifiers(w, at, { agent: agent!, module: module!, verifiers: spec }, config)))
    },
    UPLOAD_LIMIT,
  ],
  [
    'GET',
    P('/admin/verifiers/:hash'),
    ['admin'],
    (s, { params: [hash] }) => {
      const files = s.files(hash!)
      return files ? json(files) : missing(`verifier set ${hash}`)
    },
  ],

  // Runners
  [
    'POST',
    P('/jobs/claim'),
    ['runner'],
    async (s, { body }) => {
      const b = object(await body())
      const args = { runner: b.runner as string, labels: b.labels as string[] }
      const r = s.write('claimJob', args, (w, at, config) => cmd.claimJob(w, at, args, config))
      if (r.ok && r.value === null) return { status: 204 }
      return reply(r, (t) => ({ ...t, files: s.files(t!.verifierHash) }))
    },
  ],
  [
    'POST',
    P('/jobs/:job/lease'),
    ['runner'],
    async (s, { params: [job], body }) => {
      const args = { job: job!, runner: object(await body()).runner as string }
      return reply(s.write('renewLease', args, (w, at, config) => cmd.renewLease(w, at, args, config)))
    },
  ],
  [
    'POST',
    P('/jobs/:job/results'),
    ['runner'],
    async (s, { params: [job], body }) => {
      const b = object(await body())
      const results = { outcome: b.outcome, tests: b.tests ?? null, runs: b.runs, touched: b.touched ?? [], ...(b.error ? { error: b.error } : {}) } as JobResults
      const args = { job: job!, runner: b.runner as string, results }
      return reply(s.write('sendResults', args, (w, at, config) => cmd.sendResults(w, at, args, config)))
    },
  ],
]

// The dashboard

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

async function serveFile(dir: string, path: string): Promise<Reply & { body?: Buffer }> {
  const root = resolve(dir)
  let file = resolve(join(root, decodeURIComponent(path)))
  if (file !== root && !file.startsWith(root + sep)) return { status: 404, text: 'Not found\n' }
  const isFile = await stat(file).then((x) => x.isFile(), () => false)
  // Every other path is a dashboard route
  if (!isFile) file = join(root, 'index.html')
  const body = await readFile(file).catch(() => null)
  if (!body) return { status: 503, text: 'The dashboard isn’t built. Run npm run build.\n' }
  const immutable = file.includes(`${sep}assets${sep}`)
  return { status: 200, body, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } }
}

export function createHandler({ service, tokens, dashboard }: HttpOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (r: Reply & { body?: Buffer }) => {
      const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', ...r.headers }
      let payload: string | Buffer | undefined = r.body
      if (r.json !== undefined) {
        headers['content-type'] = 'application/json; charset=utf-8'
        payload = JSON.stringify(r.json)
      } else if (r.text !== undefined) {
        headers['content-type'] = 'text/plain; charset=utf-8'
        payload = r.text
      }
      res.writeHead(r.status, headers).end(payload)
    }
    try {
      const url = new URL(req.url ?? '/', 'http://whip')
      const method = req.method ?? 'GET'
      const roles = rolesOf(req, tokens)
      if (url.pathname === '/healthz') return send({ status: 200, text: 'ok\n' })

      const page = method === 'GET' && dashboard !== null && ((req.headers.accept ?? '').includes('text/html') || url.pathname.startsWith('/assets/'))
      if (page) {
        if (!roles.has('admin')) return send({ status: 401, text: 'The dashboard takes the admin token as the password.\n', headers: { 'www-authenticate': CHALLENGE } })
        return send(await serveFile(dashboard, url.pathname))
      }

      const matches = ROUTES.filter(([, path]) => path.test(url.pathname))
      const route = matches.find(([m]) => m === method)
      if (!route) return send(matches.length ? json({ error: 'badMethod', message: `${method} isn't allowed here.` }, 405) : missing(`route ${url.pathname}`))
      const [, path, allowed, handler, limit = LIMIT] = route
      if (!allowed.some((r) => roles.has(r))) {
        const status = roles.size ? 403 : 401
        // The challenge lets a browser resend the admin password it gave for another page
        const headers = status === 401 ? { 'www-authenticate': CHALLENGE } : undefined
        return send({ ...json({ error: status === 401 ? 'noToken' : 'wrongToken', message: `This call takes the ${allowed.join(' or ')} token.` }, status), ...(headers ? { headers } : {}) })
      }
      const params = path.exec(url.pathname)!.slice(1).map(decodeURIComponent)
      send(await handler(service, { req, params, body: () => readBody(req, limit) }))
    } catch (e) {
      if (e instanceof HttpError) return send(json({ error: e.code, message: e.message }, e.status))
      console.error(e)
      send(json({ error: 'internal', message: 'whip-server hit an error. Its log has the details.' }, 500))
    }
  }
}

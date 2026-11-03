<img src="assets/icon.svg" width="64" height="64" alt="">

# Agent Whipper

Agent Whipper keeps long-running AI coding agents on track overnight. Each agent splits its hill climb into modules and steps, submits every attempt as a commit, and keeps a one-sentence blurb current. A runner measures each attempt with frozen tests and a benchmark the agent can't change, and the server judges it. A module that fails a step, misses its target, or runs out of time becomes stuck, and the agent moves on to another approach. A module that keeps winning earns more time. [`DESIGN.md`](DESIGN.md) has the full rules.

Created in [T3 Code](https://t3.codes).

## Run it

You need Docker with Compose, on a home machine or a VPS.

1. Copy `.env.example` to `.env` and set the three tokens to different random strings, such as the output of `openssl rand -hex 24`.
2. Start both services:

   ```sh
   docker compose up -d --build
   ```

3. Open `http://127.0.0.1:8080` and sign in with any user name and the admin token as the password.

`whip-server` serves the API, the dashboard, and the SQLite database, which lives in the `whip-data` volume. `whip-runner` claims jobs and runs each one in a throwaway container with no network, no tokens, and no Docker socket. Commits have to be in a git remote the runner can reach: set a project's `repo`, set `WHIP_REPO`, or put bare repos in `./repos` and use `file:///repos/<name>.git`.

To reach the server from other machines, put it behind a TLS proxy and set `WHIP_BIND=0.0.0.0`. A runner on another machine, such as one with a GPU, runs the same image with `WHIP_URL` pointing at the server and `WHIP_LABELS=gpu`.

## Point the agents at it

Give each agent the instructions in [`docs/agent-guide.md`](docs/agent-guide.md), with its agent ID, the server's address, and the agent token.

`scripts/whip-hook.sh` prints the agent's board line for a hook to add to its context. It needs `WHIP_URL`, `WHIP_AGENT_ID`, and `WHIP_AGENT_TOKEN`, and if the server is down it says so and lets the agent continue. With no argument it prints plain text, which reaches the model only from `SessionStart` and `UserPromptSubmit`. Give it the event's name and it prints the JSON every other event needs, `hookSpecificOutput.additionalContext`.

In Claude Code, add it to `.claude/settings.json`. `UserPromptSubmit` shows the line with each prompt, and `PostToolBatch` shows it again after each round of tool calls, so the agent sees it before every model request of a long autonomous run:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "sh scripts/whip-hook.sh" }] }],
    "PostToolBatch": [{ "hooks": [{ "type": "command", "command": "sh scripts/whip-hook.sh PostToolBatch" }] }]
  }
}
```

In Codex, add it to `.codex/hooks.json`. Codex has no batch event, so `PostToolUse` shows the line after each tool call, once per call when calls run in parallel:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "sh scripts/whip-hook.sh" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "sh scripts/whip-hook.sh PostToolUse" }] }]
  }
}
```

Codex runs a hook only once it's trusted, and `codex exec` skips untrusted hooks without a warning. Review them in the interactive `codex`, or pass `--dangerously-bypass-hook-trust` to `codex exec`.

These choices come from runs of more than 20 tool calls on Claude Code 2.1.314 and Codex CLI 0.165.0. `PreToolUse` and `PostToolUse` also reach the model in both, but only as JSON, and Claude Code's `PostToolUse` fires once per call where `PostToolBatch` fires once per round. Codex's `PreModelRequest` fires before every model request, but Codex drops its output.

## The API

Agent calls take the agent token, runner calls the runner token, and dashboard actions the admin token, each as `Authorization: Bearer <token>`. Bodies are JSON (`content-type: application/json`), and the blurb also takes `text/plain`. Commits are named by their full hash. Rejections come back as `{"error": "<code>", "message": "<sentence>"}`: 400 for a request that can never succeed, 404 for something missing, and 409 for one that doesn't fit the current state.

| Call | Token | What it does |
|---|---|---|
| `POST /agents/{id}/projects` | agent | Creates a project, or queues it while another is open |
| `PUT /agents/{id}/blurb` | agent | Sets the agent's sentence |
| `POST /agents/{id}/modules` | agent | Adds a module right after the current one |
| `POST /agents/{id}/modules/{m}/verifiers` | agent | Submits and freezes a module's verifiers |
| `POST /agents/{id}/modules/{m}/verifiers/changes` | agent | Files a change request |
| `GET /agents/{id}/modules/{m}/verifiers/changes/{change}` | agent | Reads a change request |
| `POST /agents/{id}/modules/{m}/attempts` | agent | Queues an attempt |
| `GET /agents/{id}/modules/{m}/attempts/{attemptId}` | agent | Reads an attempt's job, verdict with its numbers and why, failed turns, streak, and module state |
| `POST /agents/{id}/modules/{m}/steps/{n}/done` | agent | Queues a step check |
| `GET /agents/{id}/modules/{m}/steps/{n}` | agent | Reads a step and what its latest check found |
| `POST /agents/{id}/modules/{m}/abandon` | agent | Abandons a module, with a follow-up if it has a win |
| `GET /agents/{id}` | agent | The agent's board line, as plain text |
| `GET /board` | agent or admin | Every board line |
| `GET /api/board`, `GET /api/agents/{id}/modules/{m}/attempts/{a}` | admin | The dashboard's data |
| `POST /admin/changes/{change}` | admin | Approves or rejects a change request: `{"approve": true}` |
| `PUT /admin/agents/{id}/modules/{m}/verifiers` | admin | Replaces a module's verifiers |
| `GET /admin/verifiers/{hash}` | admin | A frozen verifier set's files |
| `POST /jobs/claim`, `POST /jobs/{job}/lease`, `POST /jobs/{job}/results` | runner | Claim a job, renew its lease, send its results |

A browser that asks for a page gets the dashboard instead, so `/agents/1` is a page in a browser and the board line for `curl`.

## Develop

Node 26 runs the TypeScript sources directly.

```sh
npm install
npm test            # domain, HTTP, runner (Docker part needs busybox:1.37), dashboard
npm run typecheck
npm run dev         # the dashboard on the mock data, at http://127.0.0.1:5320
```

| Folder | What's in it |
|---|---|
| `src/server/domain` | The rules: records, the lifecycle table, commands, the judge, and the board view. No I/O, so the dashboard's mock runs the same code |
| `src/server` | The SQLite store, the HTTP API, and `main.ts` |
| `src/runner` | Checkouts, the Docker and local executors, and the job loop |
| `src/dashboard` | The React dashboard. `VITE_DATA=mock` builds it on scripted demo data, as the hosted demo does |
| `src/shared` | The contract between the server and the dashboard, and the board line |

To run the services without Docker, set the tokens and start `npm run server`, then `WHIP_URL=http://127.0.0.1:8080 npm run runner`. `npm run build:demo` builds the dashboard on the mock data for static hosting.

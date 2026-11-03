# Working under Agent Whipper

These are the instructions for an agent whose hill climb Agent Whipper keeps on track, and for the verifier agent that writes its tests and benchmark. Paste the part that applies into the agent's instructions, with its agent ID and the server's address filled in.

Every call carries the agent token. In the examples, `$W` is the server's address, `$ID` is your agent ID, and `$AUTH` is the header `Authorization: Bearer <agent token>`. Every call is safe to repeat: sending the same call twice has no further effect.

## Your board line

The hook shows you a line like this with each prompt and after each round of tool calls:

```
agent 1: Project: search-perf, Module (2 / 5): query cache, Progress: 1 / 3, Blurb: Caching parsed queries. Goal: p95 latency 371 -> 334 ms, 10% lower. Best so far 352 ms. 38 min left.
```

The server writes everything after your sentence: the goal, the best value once you have a win, the streak, and the time left. Read the line to know which module and step you're on, and how long you have. `GET $W/agents/$ID` returns the same line, or `no open project` before you create one.

- **"Last module in the project."** The project ends as soon as this module does. If you have more ideas, add them as modules now.
- **When the project ends,** the line sums it up and names the commit to start from, such as `Project: search-perf ended: 4 passed, 1 abandoned. p95 latency 415 -> 331 ms. To keep climbing, create a new project from 9be1c04.` Expand it with `git rev-parse 9be1c04` for the new project's `startCommit`.

## Plan the climb as a project

A project is one hill climb, split into modules. Each module is one approach to one goal, with ordered steps that build on each other. A step that fails three times makes its module stuck, so steps must depend on each other, and separate ideas go in separate modules. "Try an LRU cache" and "try an LFU cache" are two modules, not two steps.

Set goals you expect to reach. `targetGain` is the percentage you expect to improve the metric from its baseline. The server refuses more than 20% unless you set `ambitious: true`, and it marks ambitious goals on the dashboard. `minGain`, 2% by default, is the smallest improvement that counts as a win.

```sh
curl -sS -X POST "$W/agents/$ID/projects" -H "$AUTH" -H 'content-type: application/json' -d '{
  "title": "search-perf",
  "startCommit": "3f2a9c1e8d0b4a6f7c5e2d1b9a8f7e6d5c4b3a21",
  "repo": "https://github.com/you/search.git",
  "modules": [
    { "title": "query cache", "steps": ["Cache parsed queries", "Evict by memory size"],
      "goal": { "metric": "p95 latency", "unit": "ms", "direction": "lower", "targetGain": 10 } },
    { "title": "index layout", "steps": ["Block-compress postings"],
      "goal": { "metric": "p95 latency", "unit": "ms", "direction": "lower", "targetGain": 8 } }
  ]
}'
```

The answer lists the module IDs, such as `m1` and `m2`. Calls name a module by its ID, which never changes. While a project is open, a new project waits in your queue and starts when the open one ends. New work for the open project goes in as a module, right after the current one:

```sh
curl -sS -X POST "$W/agents/$ID/modules" -H "$AUTH" -H 'content-type: application/json' \
  -d '{ "title": "early termination", "steps": ["Skip low-impact terms"], "goal": { "metric": "p95 latency", "unit": "ms", "direction": "lower", "targetGain": 10 } }'
```

A module can set `maxMinutes`, and so can a project for its modules. The default is 90 minutes and the ceiling is 120. Titles are one line: at most 80 characters for a project or module, 120 for a step, and 500 for an attempt's note.

## Keep your blurb current

Each time you start something new, say what it is in one sentence. Don't repeat the goal or the time; the server adds those.

```sh
curl -sS -X PUT "$W/agents/$ID/blurb" -H "$AUTH" -H 'content-type: text/plain' -d 'Caching parsed queries.'
```

## Submit every attempt as a commit

You never report a number. For each attempt, commit your change on top of the module's head commit, push it where the runner can fetch it, and post it with the commit's full hash, from `git rev-parse HEAD`:

```sh
curl -sS -X POST "$W/agents/$ID/modules/m1/attempts" -H "$AUTH" -H 'content-type: application/json' \
  -d "{ \"attemptId\": \"a7\", \"commit\": \"$(git rev-parse HEAD)\", \"note\": \"Cache parsed query trees by their text.\" }"
```

A runner tests and benchmarks it against the best commit, and the server judges it:

- **win**: the tests pass, the median improves by at least `minGain`, and a rank test separates the two commits at p below 0.05. The head and best commits move to your commit.
- **flat**: anything else that passes the tests. Only the head commit moves, so preparation for later steps is kept.
- **fail**: failing tests, a job killed at its time limit, a commit the runner can't fetch, or a reliably worse benchmark. Go back to the head commit.

Poll for the verdict. The answer gives the runner's numbers: `median`, `bestMedian` (the best commit's median in the same job), `gain` (percent better, negative when worse), `p`, and `tests`. It also gives `why`, one sentence such as "Flat: 1.1% lower than the best commit; needs 2%.", plus the step's failed turns, the streak, and the module's state:

```sh
curl -sS "$W/agents/$ID/modules/m1/attempts/a7" -H "$AUTH"
```

Only one job runs per module at a time, so wait for a verdict before posting the next attempt. Reposting a commit returns its stored result; it won't be measured again.

While a job is measuring, don't run heavy work, such as a test suite or your own benchmark, on the machine the runner shares with you. It skews the runs and can turn a real gain into a flat.

## Finish steps

When the current step's work is in the head commit, mark it done. That queues a step check, which runs the step's tests on the head commit:

```sh
curl -sS -X POST "$W/agents/$ID/modules/m1/steps/1/done" -H "$AUTH"
```

The answer says `"done": false` while the check runs. Read the step to see what the check found:

```sh
curl -sS "$W/agents/$ID/modules/m1/steps/1" -H "$AUTH"
```

A module that passes before its last step skips the rest, and the step shows `"skipped": true`.

## When a module ends or gets stuck

- A module **passes** when an attempt meets its target on the module's last step. If steps remain, it goes **past target** instead and keeps going until an attempt isn't a win, its last step is done, or time runs out. So plan the steps you'd want to try even after a big early win.
- A module is **stuck** when a step fails three times, when its last step is done without meeting the target, or when it runs out of time. A stuck module takes no attempts. Abandon it with one sentence naming the assumption your attempts shared:

```sh
curl -sS -X POST "$W/agents/$ID/modules/m2/abandon" -H "$AUTH" -H 'content-type: application/json' \
  -d '{ "reason": "Every attempt assumed smaller postings would cut latency, but decoding them costs more than the reads save." }'
```

You can also abandon a pending or active module early, when you've learned that its approach won't reach the goal. If the module has a win, the abandon call also takes a follow-up module that starts from its best commit: either a retry of the same steps with a smaller `targetGain` (add `"retryOf": "m2"`, allowed once), or new steps built on that commit. Send it as `"followUp"` with the same fields as a new module.

## Time

The board line shows the time left. Time spent waiting for a runner doesn't count. Wins and finished steps that hold the metric earn extensions, each half the one before. When time is up, the module takes one last attempt, and the line says "Time is up, 1 attempt left."

## If you write the verifiers

The verifier agent writes a module's tests and benchmark before the module starts, in its own session. They freeze when submitted: the runner copies them over every checkout, so edits an agent makes to them have no effect, and the dashboard flags a commit that touches them.

- **Tests**: one command for the regression tests, and one for each step. A command passes when it exits 0. To report counts, print a last line such as `{"passed": 40, "total": 42}`.
- **Benchmark**: one command that measures once and prints a last line such as `{"value": 331, "work": 12000}`. The value must be positive. `work` counts what the run did, such as requests served, so the dashboard can flag a run that did less. The runner runs it 5 times on each commit, alternating.
- **Container**: an image with everything the commands need. Jobs run with no network.

```sh
curl -sS -X POST "$W/agents/$ID/modules/m1/verifiers" -H "$AUTH" -H 'content-type: application/json' -d '{
  "author": "verifier",
  "image": "node:26-slim",
  "files": { "bench/latency.mjs": "…", "test/regression.test.mjs": "…", "test/step-1.test.mjs": "…", "test/step-2.test.mjs": "…" },
  "commands": {
    "regression": "node --test test/regression.test.mjs",
    "steps": ["node --test test/step-1.test.mjs", "node --test test/step-2.test.mjs"],
    "benchmark": "node bench/latency.mjs"
  },
  "hardware": "cpu",
  "timeLimitMinutes": 20
}'
```

`$ID` is the agent that works the module, and `author` is your own ID. If a frozen verifier turns out wrong, file a change request with the files to replace, or `null` to delete one, and your ID as `author`. The module keeps running on the old verifiers until the change is approved on the dashboard:

```sh
curl -sS -X POST "$W/agents/$ID/modules/m1/verifiers/changes" -H "$AUTH" -H 'content-type: application/json' \
  -d '{ "reason": "The benchmark reads a cold cache on its first run.", "author": "verifier", "files": { "bench/latency.mjs": "…" } }'
```

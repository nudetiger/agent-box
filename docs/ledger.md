# The ledger

`ledger/events.jsonl` (git-ignored; `AGENT_BOX_LEDGER` overrides the path) holds one JSON object
per line for every run, check, review, label, outcome and bench result, across all projects. The
harness writes it deterministically from each run's `summary.json` and `events.jsonl`; no model
writes to it. `delegate.sh stats` reads it. Nothing is ever deleted from it.

Lines are appended under a lock directory (`ledger/.lock`), at most 8 KB each. A broken line is
skipped by every reader. Secrets are redacted before writing.

## Envelope (every event)

| key | meaning |
| --- | --- |
| `v` | schema version, `1` |
| `id` | 8 hex chars, unique |
| `ts` | ISO 8601 UTC, second precision |
| `type` | one of the types below |
| `project` | repo folder name, lowercase |
| `run` | run name (`runs/<project>/<run>`), or null |
| `role` | role from `agent-box.conf`, or null when `--model` was used |
| `model` | OmniRoute model id, or null |
| `harness` | 8-hex content hash of the worker-facing harness files (`lib/harness-hash`); compares versions |

## Types

### `run`: one per container run, written when it ends

| key | meaning |
| --- | --- |
| `mode` | `implement`, `review`, `tests`, `explore`, `baseline` |
| `parent` | run this one continued (`continue`), or null; `round` is 1 for a first run |
| `task` | sha1 (8 hex) of the task body, so the same task is comparable across runs |
| `title` | first line of the task body, at most 80 chars |
| `feature`, `ticket` | ticket mode only, else null |
| `bench` | `{suite, task}` when the run is a benchmark attempt, else null |
| `base`, `head` | commit shas, 10 chars |
| `effort` | reasoning effort, or null |
| `seconds` | `{total, setup, agent, test}`; null where a phase did not run |
| `exits` | `{setup, agent, test, first_test}`; -1 not run, -2 OmniRoute unreachable, -3 stopped by the red check, 124 timeout. `first_test` is the harness's test run before any auto-fix round |
| `steps`, `tools`, `tool_s` | model steps, tool calls, seconds spent inside tools |
| `tokens` | `{input, output, reasoning, cache_read, cache_write}` summed over steps |
| `cost` | as OpenCode reports it (0 for models it has no price for). Never a computed price |
| `commits`, `diff` | worker commits; `{files, insertions, deletions}` against the base |
| `verdict` | `pass`, `fail`, `blocked`, `no_change`, `error`, `timeout`, `setup_failed`, `weak_spec`, `review` |
| `flags` | `[{flag, detail}]`, see below |
| `autofix` | in-container fix rounds the harness ran after a failing test |
| `questions` | `{asked, answered}` mid-run questions |
| `report` | the worker's own claim from its final report block: `{status, tests, context_gaps, decisions}`, or null |
| `steps_budget` | the task's `steps:` budget, or null |

Flags (each is evidence, computed by the harness):

| flag | set when |
| --- | --- |
| `SEALED-EDIT` | the worker changed a sealed file (the harness reverted it) |
| `OUT-OF-SCOPE` | a changed file is outside `files:`, `scope:` and the tests next to them (a test file that only gains lines is in scope) |
| `MISREPORT` | the worker's report claims the tests pass and the harness's test run failed |
| `WEAK-SPEC` | a sealed test already passed on the base before the worker started |
| `STAND-IN` | added lines contain a skip/only/TODO/FIXME/debugger marker |
| `SENSITIVE` | the diff touches dependencies, CI, build scripts, migrations, or deletes files |
| `REVIEW-EDIT` | a read-only run changed the repo (discarded) |
| `LEFTOVERS` | the worker left uncommitted changes (the harness committed them) |

### `review`: one per review run whose report has a findings block

`{target, verdict: clean|issues|error, findings: [{n, severity: critical|high|medium|low,
confidence: CONFIRMED|PLAUSIBLE, category, file, line, issue}]}`. `target` is the reviewed branch.

### `label`: why something failed

`{refs: ["<event id>#<flag | finding n | verdict | context>"], cause, source: auto|worker|orchestrator, why}`.
`#context` is the worker's own `context_gaps` (source `worker`, cause `ctx_missing`); it never needs a reason.
An orchestrator label overrides any other on the same ref. `why` is markdown.

Causes, and who they point at:

| cause | owner |
| --- | --- |
| `ctx_missing`, `spec_vague`, `scope_too_narrow` | orchestrator (the task) |
| `worker_careless`, `worker_scope_creep`, `worker_misreport`, `worker_ignored_rule` | worker |
| `model_limit` | the model could not do it |
| `seal_correct`, `seal_too_tight` | harness rules |
| `review_false_positive` | reviewer |
| `env` | tooling, quota, network, flaky check |
| `other` | none fits (why required) |

### `outcome`: the orchestrator's decision on a run

`{target_run, result: accepted|rejected|merged|discarded, cause, why}`. This is the trust ledger:
what fraction of each model's work was accepted.

### `tests`: ticket mode's test gate

`{ok, mode: red|refactor|none, files, problems}`.

### `escalate`, `land`

`escalate {from_model, to_model, at_round}`; `land {feature, ticket, commit, branch}`.

### `bench`: hidden check of a benchmark attempt

`{suite, task, target: <run event id>, pass, check_exit, check_s}`. The hidden check runs after the
worker is gone, on files the worker never saw.

## Needs a reason

An item needs a label when it is: a run flag (except `SENSITIVE` and `LEFTOVERS`; ref `<id>#<FLAG>`), a
run verdict of `fail`, `blocked`, `error` or `timeout` (ref `<id>#verdict`), a review finding (ref `<review id>#<n>`), or a `rejected` outcome (ref `<outcome id>`). `stats unlabeled`
lists them. Obvious ones are labelled automatically (`source: auto`): `OUT-OF-SCOPE` →
`worker_scope_creep`, `MISREPORT` → `worker_misreport`, `SEALED-EDIT` → `worker_ignored_rule`,
`WEAK-SPEC` → `spec_vague`, quota/auth/network errors and failed setup → `env` (on `#verdict`).

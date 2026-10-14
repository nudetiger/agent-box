# agent-box

Runs [OpenCode](https://opencode.ai) workers on a git repo inside disposable Podman or Docker
containers, with models served through OmniRoute. Built for Claude Code to orchestrate: it plans,
writes acceptance tests, runs the gate and merges; workers implement and review.

Evidence behind the design: [research/workflow.md](research/workflow.md) (which pipeline shapes pay
off) and [research/opencode-customization.md](research/opencode-customization.md) (OpenCode skills,
agents, effort, permissions; OmniRoute behaviour).

## Trust boundary

- **In:** a `git bundle` of one committed revision, the task, a generated context pack, and the
  project's OmniRoute key. No host `.git`, home directory, SSH keys, `gh` token or uncommitted work.
- **Out:** a `git bundle` of the worker's commits, fetched as branch `agent/<name>`, plus logs. No file
  written by the container is ever executed on the host.
- **Container:** non-root `node` user, `--cap-drop ALL`, `no-new-privileges`, `--init`, pid and memory
  limits. Removed after every run.
- **Not covered:** network egress is open (needed for `npm ci`). A hostile model can send out the repo
  source and the OmniRoute key, nothing more. Shared kernel (`runc`), not a VM.
- The npm cache is a shared named volume (`agent-box-npm-cache`); npm checks lockfile integrity hashes.
  Gradle projects share `agent-box-gradle-cache` (wrapper, dependencies, toolchain JDKs). The image
  has JDK 17 to launch Gradle; a project's toolchain JDK downloads into that volume once.
  Java projects: `{tests}` in `test_file_command` expands to `--tests <class>` for each sibling `*Test.java`.

## Setup per project

```bash
cp projects/example.env projects/<repo-folder-name-lowercase>.env   # fill OMNIROUTE_API_KEY
./delegate.sh models   /path/to/repo     # model ids the key can use
./delegate.sh baseline /path/to/repo     # setup + tests with no agent: know the starting state
```

Optional but recommended: `projects/<repo>.context.yaml`, the **context map** (see below).

## Commands

```bash
./delegate.sh run    <repo> <task.md> --role <role> [--name N] [--base REF] [--timeout MIN] [--test CMD]
./delegate.sh run    <repo> <task.md> --model <id> [--effort E] [--review] [--web] ...
./delegate.sh continue <repo> <run-name> (-m TEXT | -f FILE) [--timeout MIN]    # resume that worker's session
./delegate.sh questions <repo> <run-name> [--wait]                              # open questions of a running worker
./delegate.sh answer <repo> <run-name> <id> (-m TEXT | -f FILE)                 # answer one; it keeps working
./delegate.sh fanout <repo> <task.md> --roles implement,feature [--base REF] ...   # parallel, comparison table
./delegate.sh review <repo> <branch> [--roles a,b] [--against REF] [--focus TEXT]  # generated read-only review
./delegate.sh loop   <repo> <run> [--spec FILE] [--max-rounds N]  # review, verify, fix until nothing blocks
./delegate.sh loop resume <repo> <loop> [--answer T] [--drop IDs] [--add F] [-m T]  # the orchestrator's decisions
./delegate.sh ask    <repo> [--role advise] [--prompt q.md] [--file ctx ...]       # one-pass advisor
./delegate.sh show   <repo> <name>
./delegate.sh clean

# ledger, trust, dashboard
./delegate.sh stats  [overview|models|runs|run R|flags|causes|notes|reviews|bench|compare|unlabeled|live] [--since 7d]
./delegate.sh stats json <view>                     # exact numbers for an agent
./delegate.sh dash                                  # interactive TUI over the ledger
./delegate.sh refs   <repo> <run>                   # what in a run still needs a reason
./delegate.sh note   <repo> <run> --refs a,b|--all --cause C --why "md"
./delegate.sh accept|reject|merged|discard <repo> <run> [--cause C] --why "md"

# more ways to delegate
./delegate.sh explore <repo> "<question>"           # read-only research digest with path:line evidence
./delegate.sh batch  <repo> a.md b.md ... [run options]          # different tasks in parallel
./delegate.sh continue <repo> <run> --findings RV-RUN[:n,m] [--drop RV-RUN:n] [-m TEXT]  # fix round from review findings
./delegate.sh tui    <repo> <run>                   # the real OpenCode TUI attached to a running worker
./delegate.sh check  <repo> <ref> [--test CMD] [--hidden DIR]    # tests on any commit, no agent

# ticket mode (to-tickets features)
./delegate.sh feature <repo> <feature-dir> [status|next|report|run [--parallel N] [--auto-land]]
./delegate.sh ticket  <repo> <feature-dir>/issues/NN-slug.md     # tests first, implement, review
./delegate.sh ticket-review <repo> <run>            # two-axis review again after a fix round
./delegate.sh land    <repo> <run>                  # one commit on box/<feature>, ticket stamped done
./delegate.sh defect  <repo> <feature-dir> "<title>" "<report>"

# benchmark
node lib/bench.mjs list [suite]
node lib/bench.mjs run <suite[/task]> --roles a,b [--repeat N] [--parallel K]
node bench/validate.mjs [suite]                     # base fails, reference passes, cheats fail
```

## Evidence per run

`lib/checks.mjs` computes on the host, from git and the run's files: `SEALED-EDIT`, `OUT-OF-SCOPE`
(changed files outside `files:`, `scope:` and their tests), `MISREPORT` (the worker's report block
claims passing tests and the harness's run failed), `WEAK-SPEC` (the sealed tests already passed on
the base; the container stops before the agent), `STAND-IN` (added skip/only/TODO), `SENSITIVE`
(dependencies, CI, build scripts, deletions), `LEFTOVERS`, `REVIEW-EDIT`. The run gets a verdict and
one `next` token (`review_or_accept`, `inspect_flags`, `continue_with_failure`, `answer_question`,
`fix_sealed_test`, `triage_findings`, ...) in `summary.json`, and one line in the ledger.

Inside the container: a red check runs the sealed tests before the worker (frontmatter `red: false`
skips it); a plugin parses every file the worker edits and puts any syntax error into that tool's
result; when the harness's tests fail after a worker that finished normally, one automatic fix round
resumes the same session with the failing tail (`--no-autofix`, `--autofix N`). `exits.first_test` in
the ledger keeps the result before that round, so rescued runs are counted apart. `steps: N` in the
frontmatter is a step budget.

`issue: N` (or `owner/repo#N`, or a list) in the frontmatter makes `lib/pack.mjs` fetch the GitHub
issue on the host with `gh` (`lib/issue.mjs`) and append it to the task: body, comments, the issue its
`Spec: #N` line names in full, and other cited issues cut to 1500 chars. Being part of the task, it
reaches the worker, every `continue` and both reviewers. No GitHub token enters the container. A failed
fetch stops the run before the container starts.

## The ledger and the dashboard

`ledger/events.jsonl` (schema: [docs/ledger.md](docs/ledger.md)): every run, review, label, outcome,
ticket test gate, landing and benchmark result, with the harness version (content hash of `image/`,
`lib/pack.mjs`, `lib/checks.mjs`). Obvious causes are labelled automatically; the orchestrator labels
the rest with `note` and records each decision with `accept`/`reject`, which is the trust record per
model. `stats` and `dash` (Node, no dependencies) show it: KPIs with deltas against the previous
window, models (pass, first-try pass, rescue rate, seconds per step, cache hit, flags per run, accepted),
flags and causes with trends, reviews (confirmed and false-positive rates), the benchmark matrix,
harness versions side by side, and live cards for running workers.

## Ticket mode

Ported from AgentOrchestratingSkill. Tickets are Matt Pocock `to-tickets` files
(`.scratch/<feature>/issues/NN-slug.md` with `**Blocked by:**`, `**Status:**`, optional `**Model:**`, and
`- [ ]` criteria; `spec.md` beside `issues/`). Per ticket: the `tests` role (Gemini Flash high) writes the
tests first; the harness accepts them only if nothing but test files changed, nothing is skipped, and
they fail on the current code (one fix round otherwise); they are sealed for the implementer, which
works on top of them; a failing implementation escalates once to `TICKET_ESCALATE_ROLE` with its
changes kept; `review-spec` and `review-std` review in parallel. `land` squashes tests and code into
one commit on the local integration branch `box/<feature>` (never pushed, never checked out; if the
branch moved, the merge is tested in a container first), stamps the ticket done, and appends the
feature's decisions ledger, which later tickets get in their task. The project's context map needs
`test_file_command`; `test_globs` and `done_dir` are optional; `TICKET_CHECKS` and `LAND_TRAILERS`
(`\n`-separated, e.g. co-author lines) come from `projects/<repo>.env`.

## Benchmark

`bench/` holds frozen tasks on fixture repos materialized with fixed commit shas (`bench/README.md`).
Each task has a hidden check the worker never sees, a reference solution and cheat patches;
`validate.mjs` proves the base fails, the reference passes and every cheat fails. `lib/bench.mjs`
runs tasks through the harness per role and records the hidden check as a `bench` event; `expect:
blocked` tasks pass only when the worker stops BLOCKED and the behaviour is intact. The task files are
harness-agnostic: run another harness on the same task, base sha and check to compare.

Each run leaves `runs/<project>/<name>/`: `summary.json` (setup/agent/test exit codes, commits,
`blocked`, `sealed_violation`, `review_violation`), `final.md` (the worker's last message),
`prompt.md` (exactly what it was given), `context.md`, `test.log`, `events.jsonl`. The worker's message
is a claim; `test_exit`, the flags and the diff are evidence.

## The task file and the context pack

```markdown
---
files: [lykos/providers/gitlab-duo/oauth.ts]       # what the change is about
sealed: [lykos/providers/gitlab-duo/oauth.test.ts] # worker cannot edit these
test: "npx tsx --test some.test.ts"                # optional; default: sibling tests of `files`
---
Objective, required behaviour, out of scope.
```

`lib/pack.mjs` turns that into `context.md` deterministically: no model involved, same input gives the
same pack. From the context map it adds the areas the files belong to, their governing docs and ADRs,
the rules a change there can break, glossary definitions quoted from the repo, recent commits per
file, related tests and the narrowest verification command. It points at files; it does not paste them.
The map's `requires:` lists (top level, and per area for the areas a task hits) are the docs a change
must keep current; they go at the end of the task text as its definition of done, so the fix round and
both reviewers see them too.

**Sealed files** are enforced twice: an OpenCode `edit` deny rule, and a post-run diff check that
reverts any change made through bash before the harness runs the tests, flagged as `SEALED-EDIT`.

**BLOCKED**: workers are told they may stop with `BLOCKED: <reason>` when the task cannot be done as
written; the harness records it. This exit cut test-cheating sharply in ImpossibleBench (see research).
It is also how a worker asks a question: it phrases BLOCKED as one, and the orchestrator answers with
`continue`.

**Watching**: when [herdr](https://herdr.dev) is running, every run opens a tab in an `agent-box`
workspace. Left: the real OpenCode TUI attached to the worker's session (the container runs `opencode
serve`, the worker runs `opencode run --attach`, the pane runs `podman exec -it ... opencode attach`),
with its subagent sessions; typing there reaches the worker. Right: the agent-box feed (`watch`):
phases, every tool call, questions the moment they are asked, the verdict and `next`; it reports the
state to herdr (working, blocked, done). Enter closes the tab. `AGENT_BOX_TUI=0` keeps only the feed,
`AGENT_BOX_HERDR=0` turns tabs off. Without herdr: `watch <repo> <run>`, `tui <repo> <run>`, or
`stats live` for every running worker at once.

A `loop` opens one more tab of its own (`loop-watch <repo> <loop>` without herdr), fed by
`runs/<project>/_loops/<loop>/progress.jsonl`: each round and its kind, the step running now with its
time, every finding with its severity and where it went (PROVEN, dropped, note, QUESTION, TRIAGE,
advice), what is fixed and still open, regressions, each decision and escalation, and when it stops,
what the orchestrator does next with the command. The check that reruns the reproductions has no tab
of its own; it shows only here.

**Concurrency**: at most `AGENT_BOX_SLOTS` containers run at once (default 4), whatever starts them;
the rest wait for a slot.

**Measurements** live in [research/findings.md](research/findings.md), with the method to compare
another harness (Lykos) against this one on the same task files.

**Speed**: the delay between tool calls is model time (Gemini 3.8 Flash 4.6-10.6 s per step, DeepSeek
Flash 5.4-9.0 s, Composer 2.4 s; 16 Lykos runs, research/findings.md §1), so the harness cuts steps: small named files and sealed
tests are pasted into the pack (8 KB each, 24 KB total), the Ponytail and box-verify rules are in the
preamble instead of loaded as skills, and `gradlew`/`mvnw` are made executable. One task (add a
one-line Javadoc, RakunMiniItems, 2026-10-12, one run each): Gemini before 66 calls / 546 s, after 50
calls / 345 s (Gradle daemon also on); Composer `quick` 19 calls / 77 s. Gemini still explores widely
on trivial tasks: use `quick` for those.

**Mid-run questions**: workers get an `ask_orchestrator` tool (`image/ask-mcp.mjs`, a dependency-free
local MCP server; off with `run --no-ask`, never given to reviewers or the scout). A question lands in
`/out/questions/<n>.md` inside the running container; `questions <repo> <run> --wait` returns it, and
`answer <repo> <run> <n> -m TEXT` delivers the answer while the worker waits. Each tool call waits at
most 45 s (`ASK_WAIT_S`), under MCP clients' usual 60 s request timeout; the worker calls
`wait_for_answer` to keep waiting, and after 10 min (`ASK_TIMEOUT_MIN`) it is told to decide itself.
Questions and answers stay in `runs/<project>/<run>/questions/`; `summary.json` counts them.
Verified 2026-10-12: a Gemini worker asked, waited through one empty 45 s call, received an answer
that contradicted its own preferred option, and followed it.

**Continue**: every run saves its OpenCode session (`opencode-data.tgz`, session id in
`summary.json`) and its settings (`meta.sh`). `continue` starts a fresh container on the run's branch,
restores the session and sends the message: the worker keeps everything it read and tried, and the
same model, sealed files, test and checks apply. The result is `agent/<run>-r2`, `-r3`...; the base
stays the first round's, so the sealed check covers every round. Continuing an earlier round again
forks it (`-r2b`). Verified 2026-10-12: a resumed Gemini worker edited without re-reading the file
and recalled what it read in round 1 (cache read 155k tokens).

## Roles (`agent-box.conf`)

| role | model | use |
| --- | --- | --- |
| implement | `gemini-3.8-flash-tiered` high | **every coding task starts here** |
| implement-hard | `deepseek/deepseek-flash-max` | retry after a gate failure (a different family) |
| quick | `deepseek/deepseek-flash-max` | trivial edits whose place is known |
| escalate (= last-resort) | `antigravity/claude-opus-4-6-thinking` | after two failed rounds, with the failure history |
| write / draft | Opus 4.6 / Gemini 3.8 Flash high | prose that ships / drafts |
| explore | Gemini 3.8 Flash high | `delegate.sh explore`: read-only research digest |
| bughunt | Gemini 3.8 Flash high | `delegate.sh hunt`: reproduces, locates and pins a reported bug. Out of the workflow (2026-10-13): it added 23-30 min on Lykos T194/T174b and changed neither; the orchestrator hunts with an Opus 5.5 subagent instead |
| tests | Gemini 3.8 Flash high | ticket mode: writes the failing tests first |
| review-spec | `deepseek/deepseek-flash-max` | requirements, edge cases, test strength, against the spec |
| review-spec-alt | Opus 4.6 | the spec review instead when the implementer is review-spec's family (DeepSeek); `review` and ticket mode swap it in by themselves |
| review-std | Opus 4.6 | the repo's documented standards, design, smells |
| adjudicate | Kimi K3 (`cursor/kimi-k3-high`), Opus after 2026-10-24 | settles a disputed finding (read-only) |
| advise / advise-alt | Kimi K3 / Opus 4.6 | `delegate.sh ask`: one-pass advisor, never a coder |

One worker per task; `fanout` stays available but no workflow uses it. `review` and ticket mode run the
same two review axes with the same prompts (`lib/ticket/review-*.md`), and both reviewers get the spec.

**The review and fix loop** (`delegate.sh loop <repo> <run>`, `lib/loop.mjs`, `lib/verify.mjs`).
The loop refuses a run with no sealed acceptance test (`--no-spec` overrides): without one, reviewers
become the spec. Round 1 is the only full review, both axes. Every behaviour finding carries a
reproduction (a file under `/tmp` and a command); one check container per round reruns all of them on
the branch, with the existing tests next to the change (same stem, or importing a changed module; at
most `LOOP_NEIGHBOURS`). The harness's result decides, not the reviewer's CONFIRMED:

| finding | goes to |
| --- | --- |
| reproduction fails on the branch, critical/high/medium, with a `basis` (the clause it defends) | the worker, with the reproduction; blocks |
| the same without a `basis` | sent with the next fix as advice |
| category `regression`: fails on the branch and passes on the base | blocks (failing on the base too: a note) |
| reproduction fails, low | merge note; sent with the next fix as optional |
| reproduction passes on the branch | dropped, labelled `review_false_positive` |
| after round 1, in a file the fix did not touch, no failing reproduction | merge note |
| `spec_question` | stop: `next: answer_spec` |
| no reproduction, CONFIRMED critical/high logic, edge case, security or requirement | stop: `next: triage` |
| no reproduction, other medium+ | sent with the next fix; one advice-only fix round at most |
| a test next to the change fails on the branch and not on the base (names compared) | a regression; blocks |
| a proof fixed in an earlier round fails again | reopened; blocks |
| the worker disputes a finding (`disputes` in its report) that still fails | stop: `next: triage` |

Every proven reproduction joins the proof suite, rerun every round. A fix round sends everything open
at once and tells the worker to run the proof suite and the neighbour tests green before it ends.
After a fix, the round-1 reviewer sessions are resumed on it (`continue --at agent/<fix>`, at most
`LOOP_RECHECK_STEPS` steps): the spec reviewer, and the standards reviewer when one of its findings was
sent. There is no final full review. The base's neighbour results are kept per test set, so the base
runs once. A stall (a reproduction still failing after `LOOP_STUCK` (2) fixes, a regression or a
re-broken proof after 1, serious items after `LOOP_SOFT_ROUNDS` (2) fix rounds, `LOOP_MAX_FIXES` (3)
fix rounds, or a fix that fails its own tests) starts `LOOP_FRESH` attempts once, in parallel from the
base, with the task, the rulings and the proof suite (no earlier diff); each passing one is checked
against the proofs and the neighbours, `LOOP_SELECTOR` picks between equals (the smaller diff when it
cannot), and the pick gets a full review. A second stall, or `LOOP_MAX_ROUNDS` (4) reviews:
`next: decide`. A round that stopped before its review or check finished runs again on `resume`.
`loop resume <repo> <loop>` takes the orchestrator's `--answer` (also given to every later reviewer),
`--drop`, `--add`, `-m` and `--max-rounds`, and goes on. State:
`runs/<project>/_loops/<name>/state.json`. Review runs are capped at `REVIEW_STEPS` (90) steps.

**A turn cut off at the output cap** (step reason `length`, Gemini thinking ~30,700 tokens of a ~32k
cap, Lykos T174b) is resumed in the same session up to twice (`CUT_RESUMES`) before the run ends;
`cut_resumes` in the summary counts them.

**Per project**: any `ROLE_*`, `REVIEW_ROLES`, `SCOUT_MODEL`, `TICKET_ESCALATE_*` or `LOOP_*` line in
`projects/<repo>.env` overrides `agent-box.conf` for that project, in `delegate.sh` and in ticket mode
alike. `delegate.sh roles <repo>` prints what is in effect and marks the project's own lines.

Budget (user, 2026-10-12/13). Quota pools: Opus and Sonnet share one, all Gemini models share one;
DeepSeek and Kimi each have their own. Gemini does the bulk; DeepSeek takes retries, the quick lane and
the spec review; Opus (~$30-40 per 5 hours) the standards review, escalation and prose; Kimi K3 ($20,
ends 2026-10-24) advice and disputed findings. Unused: Sonnet (spends Opus's pool) and Composer
(misreported tool results and passed an impossible task without BLOCKED, research/findings.md §6).

For Antigravity Gemini, `high`, `xhigh` and `max` map to the same 32768-token thinking budget, so `high`
is the top tier. OmniRoute drops `reasoning_effort` for `antigravity/claude-*`, and Cursor ids carry
their effort in the name. Codex/GPT models are not coding workers: they fail at multi-step agent work
through this router. GPT-5.6 Sol and Grok 4.6 are not available (2026-10-12).

Measured so far (one task each, so treat as anecdotes): on a comment fix, Composer 134 s and Gemini
3.8 Flash 280 s both passed; on the dual-loopback fix, DeepSeek 326 s and Gemini 669 s both passed.

## Inside the container

`image/make-config.mjs` writes the OpenCode config per run:

- **`worker`** agent (edits; sealed globs denied) or **`reviewer`** agent (no edits in the repo;
  scratch files under `/tmp`).
- **`scout`** subagent on Gemini 3.8 Flash: read-only search that every worker may call, so premium
  workers spend their quota on reasoning.
- **Skills**: Ponytail (`ponytail`, `ponytail-review`; baked into the image), the project's own `.claude/skills/` (filtered by `worker_skills` in the context map, so
  skills that interview a human are hidden) plus agent-box's `box-verify` and `box-prove-finding`.
- `reasoning_effort` from the role, as a model option.

## Engine

`AGENT_BOX_ENGINE` in `agent-box.conf`: `podman` (default) or `docker`. Build once per engine.
Podman needs user-mode networking (`podman machine set --user-mode-networking`), because OmniRoute
listens on 127.0.0.1 and only gvproxy's host address reaches the host's loopback.

Measured 2026-10-12, one full Lykos suite each, same commit, same machine:

| | Docker 29.6.2 | Podman 6.1.3 |
| --- | --- | --- |
| image | 2.15 GB | 1.55 GB |
| `npm ci` | 27 s | 22 s |
| test suite | 504 s | 653 s |
| Windows-side processes, idle | ~770 MB | ~13 MB |

## Files

| | |
| --- | --- |
| `delegate.sh` | Host side: pack, bundle in, container lifecycle, bundle out, fetch, report, fanout, review |
| `lib/pack.mjs` | Deterministic context pack (named files pasted, code index of the task's identifiers, red command, scope) |
| `lib/checks.mjs`, `lib/ledger.mjs` | Evidence flags, verdict and `next`; the ledger writer, labels and outcomes |
| `lib/stats.mjs`, `lib/stats/` | Ledger dashboard and TUI |
| `lib/ticket.mjs`, `lib/ticket/` | Ticket mode and its worker prompts (adapted from Matt Pocock's skills, MIT) |
| `lib/bench.mjs`, `bench/` | Benchmark runner and the frozen suites |
| `lib/watch.mjs`, `lib/forward.mjs` | Live feed; review findings into a fix round |
| `image/progress.mjs`, `image/plugin.js`, `image/syntax-check.mjs` | Live progress file; syntax check after every edit |
| `image/run-task.sh` | Container side: clone, setup, config, OpenCode, sealed check, tests, bundle |
| `image/make-config.mjs` | Per-run OpenCode config: agents, scout, permissions, skills, effort |
| `image/preamble*.md`, `image/skills/` | Operating conditions and worker skills |
| `agent-box.conf` | Engine, roles, review defaults, scout model |
| `projects/*.env` | Per-project key and settings. Git-ignored |
| `projects/*.context.yaml` | Per-project context map |
| `research/` | The research this design rests on |
| `runs/` | Run outputs. Git-ignored |

After changing anything under `image/`, run `./delegate.sh build`. To update OpenCode, change
`OPENCODE_VERSION` in `image/Dockerfile` and rebuild.

# agent-box

Runs [OpenCode](https://opencode.ai) workers on a git repo inside disposable Podman or Docker
containers, with models served through OmniRoute. Built for Claude Code to orchestrate: it plans,
writes acceptance tests, runs the gate and merges; workers implement and review.

Evidence behind the design: [research/workflow.md](research/workflow.md) (which pipeline shapes pay
off) and [research/opencode-customization.md](research/opencode-customization.md) (OpenCode skills,
agents, effort, permissions; OmniRoute behaviour).

## Requirements

| | |
| --- | --- |
| bash | Git Bash on Windows; any bash on Linux or macOS |
| Node.js 20.11+ | host-side scripts (`lib/`); tested on 24.11 |
| git, jq, curl | on `PATH` |
| Podman or Docker | the worker containers. Podman is the default (`AGENT_BOX_ENGINE` in `agent-box.conf`) |
| OmniRoute | running on the host (default `http://localhost:20128/v1`), with an API key per project |
| `gh` (optional) | only for `issue: N` in a task: issues are fetched on the host |
| herdr (optional) | a live tab per run and per loop |

## Install

```bash
git clone https://github.com/nudetiger/agent-box.git
cd agent-box
npm ci                          # host-side helpers (one dependency: yaml)
podman machine start            # Podman on Windows or macOS; skip on Linux or with Docker
./delegate.sh build             # the base worker image: Node, git, ripgrep, OpenCode (image/Dockerfile)
./delegate.sh doctor            # checks everything below; each failure prints its fix
```

Rebuild after changing anything under `image/`. `doctor <repo>` also checks the project file, its
key, and that a container reaches OmniRoute over the route workers use.

### Platforms

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| shell | Git Bash | bash 4+ (`brew install bash`; macOS ships 3.2) | bash |
| Podman | `podman machine`, user-mode networking | `podman machine` | native, rootless |
| Docker | Docker Desktop | Docker Desktop | Docker Engine 20.10+ |
| host address in containers | found through the machine (`host.containers.internal`) | same | `host-gateway` |

Containers reach OmniRoute as `host.docker.internal`. On Linux the host service must listen where a
container can reach it (not only `127.0.0.1`), or set `AGENT_BOX_NETWORK=host` and
`OMNIROUTE_BASE_URL=http://localhost:20128/v1`. `AGENT_BOX_HOST_IP` overrides the address on any
platform. Tested on Windows 10 with Podman 6.1 (2026-10-17); the unit tests and `doctor` also run in
a Linux container. macOS and Docker Engine on Linux are untested.

### Configuration files

| file | in git | what |
| --- | --- | --- |
| `agent-box.conf` | yes | engine, roles, review and loop defaults, context and self-check settings |
| `agent-box.local.conf` | no | this machine's overrides: `AGENT_BOX_SLOTS`, `AGENT_BOX_ENGINE`, `AGENT_BOX_NS`, `AGENT_BOX_REPOS` |
| `projects/<repo>.env` | no | the project's OmniRoute key and settings; any `agent-box.conf` key wins here |
| `projects/<repo>.context.yaml`, `.Dockerfile` | yes | context map; the project's toolchain image |
| `prices.conf`, `prices.local.conf` | yes / no | USD per 1M tokens per model, for `stats` |

**A second checkout** (a worktree, a test install) sets `AGENT_BOX_NS=<name>` in its
`agent-box.local.conf`: its images (`agent-box-<name>`), containers, cache volumes and herdr workspace
are then its own, and `clean` and `gc` touch only those.

## Set up a project

A project is a git repo on your machine. Its settings live in `projects/<repo-folder-name-lowercase>.env`.

```bash
./delegate.sh setup    /path/to/myrepo         # projects/myrepo.env, .Dockerfile, .context.yaml from its manifests
                                               # fill OMNIROUTE_API_KEY in the .env; never commit it (git-ignored)
./delegate.sh build    /path/to/myrepo         # only when setup wrote a Dockerfile (Go, Rust, CMake, JDK, Python)
./delegate.sh models   /path/to/myrepo         # model ids the key can use
./delegate.sh roles    /path/to/myrepo         # which model each role uses here
./delegate.sh baseline /path/to/myrepo         # setup + tests with no agent: the starting state
```

Recommended: `projects/myrepo.context.yaml`, the context map that decides which docs, traps and tests
each worker is given (see [The task file and the context pack](#the-task-file-and-the-context-pack)).

`setup` reads package.json, go.mod, Cargo.toml, CMakeLists.txt, Gradle, Maven and Python manifests at
the root or up to two folders down, and never overwrites a file; `--dry-run` prints what it would write.
Its commands are guesses: `baseline` shows whether they work.

**Toolchain.** The base image has Node only (plus make, g++, python3 for node-gyp). A project that
needs Go, Rust, CMake or a JDK gets its own image, built on the base (`setup` writes it, or by hand):

```bash
cp projects/example.Dockerfile projects/myrepo.Dockerfile    # uncomment what the project needs
./delegate.sh build /path/to/myrepo                          # builds agent-box-myrepo, used for every run
./delegate.sh config /path/to/myrepo                         # image, caches, every setting the .env sets
```

**Settings.** Any `agent-box.conf` key can be set in the project's `.env` and wins there. The ones
made for other stacks (examples in `projects/example.env`):

| Key | What it does |
| --- | --- |
| `SETUP_CMD`, `TEST_CMD` | Install and test commands (default `npm ci`, `npm test`) |
| `CACHES` | `name:/path` named volumes kept across runs, e.g. `go:/home/node/go` |
| `CONTAINER_ENV` | Names of `.env` settings passed into the container, e.g. `GOFLAGS` |
| `SYNTAX_<ext>` | Fast check after every edit of a `.<ext>` file, e.g. `SYNTAX_go='gofmt -e {file} >/dev/null'` |
| `FAIL_REGEX` | Failing test names in the test output. Default knows node:test, TAP, Go, cargo, GoogleTest, pytest, Gradle |
| `NEIGHBOUR_SOURCES` | Changed files whose neighbouring tests rerun each review round. Default: JS/TS, Java, Kotlin, Python, Go, Rust, C/C++ |
| `SENSITIVE_EXTRA` | More paths flagged `SENSITIVE` when a worker edits them |
| `BASE_SUITE_CMD` | The base's whole suite, run once per base commit for the loop (default `TEST_CMD`) |
| `ROLE_*`, `REVIEW_MODE`, `REVIEW_ROLES`, `LOOP_*` | Models, reviewers and loop limits for this project only |

`test_file_command` in the context map takes `{files}`, `{tests}` (Gradle `--tests` filters) and
`{dirs}` (the files' directories as `./dir`, for `go test {dirs}`).

## Quick start

1. Write a task file. Frontmatter drives the context pack; the body is the request.

   ```markdown
   ---
   files: [src/parser.ts]
   sealed: [src/parser.accept.test.ts]   # your acceptance test: the worker cannot edit it
   test: "npx tsx --test src/parser.accept.test.ts"
   ---
   Make the parser accept trailing commas. Out of scope: the CLI.
   ```

2. Run a worker. The result comes back as branch `agent/<name>` in your repo.

   ```bash
   ./delegate.sh run /path/to/myrepo task.md --role implement --name parser-commas
   ```

3. Read the last line, not the worker's report: `verdict <v>  flags <F,...>  next <token>`. The same
   is in `runs/<project>/<name>/summary.json`. `next` says what to do (see the table in
   [Evidence per run](#evidence-per-run)).

4. For a non-trivial change, run the review and fix loop. It reviews once, proves each finding with a
   reproduction, sends the proven ones back to the same worker, and rechecks the fix:

   ```bash
   ./delegate.sh loop /path/to/myrepo parser-commas            # prints a summary ending in next: approve, decide, ...
   ./delegate.sh loop resume /path/to/myrepo loop-parser-commas --answer "..."   # when it stops for you
   ```

5. Read `git diff <base>..agent/<last>`, rerun your tests, merge, and record the decision:
   `./delegate.sh accept /path/to/myrepo <run> --why "..."`.

Watching: with herdr running, every run and loop opens a tab. Without it:
`./delegate.sh watch <repo> <run>`, `./delegate.sh loop-watch <repo> <loop>`, `./delegate.sh dash`.

## Use from Claude Code

agent-box is built to be driven by an orchestrating agent. Install the skill so Claude Code knows the
procedure (task file, verdicts, the loop, accepting):

```bash
./delegate.sh install-skill        # writes ~/.claude/skills/agent-box/SKILL.md with this clone's path
```

Then ask Claude Code to "delegate this to agent-box". Keep `claude-skill/` and your installed copy in
step when either changes.

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
  Other caches are the project's `CACHES` volumes, shared by every project that names the same one
  (RakunMiniItems: `gradle`, holding the wrapper, dependencies and toolchain JDKs). Each concurrency
  slot mounts its own copy, `agent-box-<name><slot>-cache`, seeded once from `agent-box-<name>-cache`:
  two containers on one Gradle cache deadlock on its journal lock (RakunMiniItems, 2026-10-15).
  `AGENT_BOX_SLOT_CACHES=0` shares one volume again.
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
./delegate.sh review <repo> <branch> [--review-mode split|both] [--roles a,b] [--against REF] [--focus TEXT]  # generated read-only review
./delegate.sh loop   <repo> <run> [--spec FILE] [--max-rounds N] [--review-mode M] [--roles a,b] [--fresh R|none]  # review, verify, fix until nothing blocks
./delegate.sh loop resume <repo> <loop> [--answer T] [--drop IDs] [--add F] [-m T] [--max-rounds N] [--review-mode M]  # the orchestrator's decisions
./delegate.sh wait   <repo> <run-or-loop>... [--any] [--questions]  # block until they end; their short reports
./delegate.sh ask    <repo> [--role advise] [--prompt q.md] [--file ctx ...]       # one-pass advisor
./delegate.sh show   <repo> <name>
./delegate.sh clean
./delegate.sh doctor [<repo>]                       # prerequisites, images, OmniRoute route; fixes
./delegate.sh gc     [--days N] [--yes]             # disk: old session archives, model lists, untagged images

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
./delegate.sh bench list [suite]
./delegate.sh bench run <suite[/task]> --roles a,b [--repeat N] [--parallel K]   # AGENT_BOX_REPOS: real repos elsewhere
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
changes kept; the review mode's reviewers review in parallel (`--review-mode`, `--roles` override it). `land` squashes tests and code into
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
the rest wait for a slot. `delegate.sh wait <repo> <name>... [--any] [--questions]` blocks until runs
or loops end and prints each one's short report, so an orchestrator waits on one background command
instead of polling.

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
| implement-hard | `deepseek/deepseek-flash-max` | the same bug failing twice (a different family, max effort) |
| quick | `deepseek/deepseek-flash-high` | trivial edits whose place is known |
| escalate (= last-resort) | `deepseek/deepseek-flash-max` | after two failed rounds, with the failure history |
| write / draft | Opus 4.6 / Gemini 3.8 Flash high | prose that ships / drafts |
| explore | Gemini 3.8 Flash high | `delegate.sh explore`: read-only research digest |
| bughunt | Gemini 3.8 Flash high | `delegate.sh hunt`: reproduces, locates and pins a reported bug. Out of the workflow (2026-10-13): it added 23-30 min on Lykos T194/T174b and changed neither; the orchestrator hunts with an Opus 5.5 subagent instead |
| tests | Gemini 3.8 Flash high | ticket mode: writes the failing tests first |
| review-spec | Opus 4.6 high | requirements, edge cases, test strength, against the spec |
| review-spec-alt | `deepseek/deepseek-flash high` | the spec review instead when the implementer is review-spec's family (Claude); `review`, the loop and ticket mode swap it in by themselves |
| review-std | `deepseek/deepseek-flash high` | the repo's documented standards, design, smells |
| review-both | `deepseek/deepseek-flash high` | review mode `both`: one reviewer for both axes (`lib/ticket/review-both.md`) |
| review-both-alt | Opus 4.6 high | review-both when DeepSeek wrote the code |
| adjudicate | Kimi K3 (`cursor/kimi-k3-high`) | settles a disputed finding (read-only) |
| advise / advise-alt | Kimi K3 / Opus 4.6 | `delegate.sh ask`: one-pass advisor, never a coder |

One worker per task; `fanout` stays available but no workflow uses it. Independent tasks run in
parallel, up to `AGENT_BOX_SLOTS`.

**Review mode** (`REVIEW_MODE` in `agent-box.conf`, per project in `projects/<repo>.env`;
`lib/reviewmode.mjs`): `split` (the default) is two reviewers in parallel, review-spec and review-std;
`both` is one review-both covering both axes. `review`, `loop`, `loop resume`, `ticket`, `feature ...
run` and `ticket-review` take `--review-mode split|both` or `--roles a,b` (one axis: `--roles
review-spec`). Precedence: `--roles`, `--review-mode`, a project's `REVIEW_ROLES`, `REVIEW_MODE`. Every
reviewer gets the spec, with the same prompts everywhere (`lib/ticket/review-*.md`).

**The review and fix loop** (`delegate.sh loop <repo> <run>`, `lib/loop.mjs`, `lib/verify.mjs`).
The loop refuses a run with no sealed acceptance test (`--no-spec` overrides): without one, reviewers
become the spec. Round 1 is the only full review, by the review mode's reviewers. Every behaviour finding carries a
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
sent; in mode `both`, the one review-both session. Each gets every sent finding, so a session on a model matching `LOOP_RECHECK_AVOID` (default
`opus`, the scarce quota) is left out while another can recheck. There is no final full review. Beside the first review, the base's whole suite runs once per
base commit (`BASE_SUITE_CMD`, default the project's `TEST_CMD`; `LOOP_BASE_SUITE=0` turns it off) and
its failing test names are kept in `runs/<project>/.basecache/<sha>.json`: checks then run the neighbour
tests on the branch only and compare names. Without a usable suite result (a crash, a timeout, no
names) a check runs the base itself, once per test set. Each check logs its seconds per step
(`AGENT-BOX-TIME`), shown by `loop-watch`. A stall (a reproduction still failing after `LOOP_STUCK` (2) fixes, a regression or a
re-broken proof after 1, serious items after `LOOP_SOFT_ROUNDS` (2) fix rounds, `LOOP_MAX_FIXES` (3)
fix rounds, or a fix that fails its own tests) starts `LOOP_FRESH` attempts once, in parallel from the
base, with the task, the rulings and the proof suite (no earlier diff); each passing one is checked
against the proofs and the neighbours, `LOOP_SELECTOR` picks between equals (the smaller diff when it
cannot), and the pick gets a full review. A second stall, or `LOOP_MAX_ROUNDS` (5) reviews:
`next: decide`. A round that stopped before its review or check finished runs again on `resume`.
`loop resume <repo> <loop>` takes the orchestrator's `--answer` (also given to every later reviewer),
`--drop`, `--add`, `-m` and `--max-rounds`, and goes on. At the start and on a resume the orchestrator
also picks `--review-mode`, `--roles`, `--fresh ROLES|none` (one role: a single fresh implementer;
`none`: a stall stops for it) and `--max-fixes`; new reviewers on a resume make the next review cold. State:
`runs/<project>/_loops/<name>/state.json`. Review runs are capped at `REVIEW_STEPS` (90) steps.

**A turn cut off at the output cap** (step reason `length`, Gemini thinking ~30,700 tokens of a ~32k
cap, Lykos T174b) is resumed in the same session up to twice (`CUT_RESUMES`) before the run ends;
`cut_resumes` in the summary counts them.

**Per project**: any `ROLE_*`, `REVIEW_MODE`, `REVIEW_ROLES`, `SCOUT_MODEL`, `TICKET_ESCALATE_*` or `LOOP_*` line in
`projects/<repo>.env` overrides `agent-box.conf` for that project, in `delegate.sh` and in ticket mode
alike. `delegate.sh roles <repo>` prints what is in effect and marks the project's own lines.

Budget (user, 2026-10-12/13). Quota pools: Opus and Sonnet share one, all Gemini models share one;
DeepSeek and Kimi each have their own. Gemini does the bulk; DeepSeek takes escalation, the quick
lane, the standards review and review-both; Opus (~$30-40 per 5 hours) the spec review and prose;
Kimi K3 ($20, ends 2026-10-24) advice and disputed findings (default stack: user, 2026-10-15). Unused: Sonnet (spends Opus's pool) and Composer
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
- **Context**: each model gets limits, so OpenCode compacts the session at `COMPACT_AT` tokens
  (110000) and prunes old tool output in continued rounds. OpenCode never compacts a model registered
  without `limit.context`. Step latency grows with context: median 4 s a step under 60k tokens, 42 s
  at 120-180k (RakunMiniItems t51, 2026-10-16). `COMPACT_AT=0` turns it off.
- **`api`** (`image/api.mjs`): `api find|show|grep` print signatures from the JVM dependency jars in
  the Gradle and Maven caches, indexed once into the shared `agent-box-api-cache` volume. Workers had
  spent 36 of 61 shell calls decompiling jars by hand (t51). The plugin points at it when a worker runs
  javap or unzip on the caches.
- **Self-check** (`SELF_CHECK=1`): a first round that changed code gets one more turn auditing its diff
  against the task (each requirement, the usual edge cases, the doc duties) before the harness tests.
  The report keeps the decisions of the report before it.
- **Lessons**: the project's accepted review findings (`lib/examples.mjs --lessons`) go into the
  implementer's context pack. `LESSONS=0` turns them off; `LESSONS_BEFORE` limits them to an earlier time.

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
| `lib/doctor.mjs`, `lib/gc.mjs`, `lib/prices.mjs` | `doctor`; `gc`; prices applied to the ledger |
| `image/api.mjs` | `api` in the container: dependency signatures from the build caches |
| `lib/reviewmode.mjs`, `lib/family.mjs` | Who reviews (review mode, roles, axes); the implementer's family never reviews its own code |
| `image/progress.mjs`, `image/plugin.js`, `image/syntax-check.mjs` | Live progress file; syntax check after every edit |
| `image/run-task.sh` | Container side: clone, setup, config, OpenCode, sealed check, tests, bundle |
| `image/make-config.mjs` | Per-run OpenCode config: agents, scout, permissions, skills, effort |
| `image/preamble*.md`, `image/skills/` | Operating conditions and worker skills |
| `agent-box.conf` | Engine, roles, review defaults, scout model |
| `projects/*.env` | Per-project key and settings. Git-ignored |
| `projects/*.context.yaml` | Per-project context map |
| `projects/*.Dockerfile` | Per-project image: the toolchain on top of the base (`projects/example.Dockerfile`) |
| `research/` | The research this design rests on |
| `runs/` | Run outputs. Git-ignored |
| `claude-skill/agent-box/SKILL.md` | The Claude Code skill: the orchestrator's procedure |

After changing anything under `image/`, run `./delegate.sh build`, then `./delegate.sh build <repo>` for each project with its own Dockerfile. To update OpenCode, change
`OPENCODE_VERSION` in `image/Dockerfile` and rebuild.

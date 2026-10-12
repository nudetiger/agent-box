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
./delegate.sh fanout <repo> <task.md> --roles implement,feature [--base REF] ...   # parallel, comparison table
./delegate.sh review <repo> <branch> [--roles a,b] [--against REF] [--focus TEXT]  # generated read-only review
./delegate.sh ask    <repo> [--role advise] [--prompt q.md] [--file ctx ...]       # one-pass advisor
./delegate.sh show   <repo> <name>
./delegate.sh clean
```

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

**Sealed files** are enforced twice: an OpenCode `edit` deny rule, and a post-run diff check that
reverts any change made through bash before the harness runs the tests, flagged as `SEALED-EDIT`.

**BLOCKED**: workers are told they may stop with `BLOCKED: <reason>` when the task cannot be done as
written; the harness records it. This exit cut test-cheating sharply in ImpossibleBench (see research).
It is also how a worker asks a question: it phrases BLOCKED as one, and the orchestrator answers with
`continue`.

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
| implement / implement-hard | `gemini-3.8-flash-tiered` medium / high | **main worker** (large quota) |
| implement-alt | `cu/composer-2.5-fast` | second family, fan-out partner |
| implement-alt2 | `deepseek/deepseek-flash-max` | third family, hard bugs only (paid per token) |
| escalate | `antigravity/claude-sonnet-4-6` | after two cheap gate failures |
| last-resort | `antigravity/claude-opus-4-6-thinking` | one attempt with the full failure history |
| write / draft | Sonnet 4.6 / Gemini 3.8 Flash | prose that ships / throwaway prose |
| review / review-alt | DeepSeek Flash / Composer 2.5 fast | default two-family review gate (read-only) |
| review-gemini | Gemini 3.8 Flash | reviewer when the change came from Composer or DeepSeek |
| deep-review, bughunt | `antigravity/gemini-3.1-pro-high` | slow, thorough; large or risky diffs (read-only) |
| adjudicate | Opus 4.6 thinking | settles a disputed high-severity finding (read-only) |
| advise / advise-alt | GPT-5.6 Sol / Opus 4.6 | `delegate.sh ask`: one-pass debate partner, never a coder |
| grok | `cursor/cursor-grok-4.6-high` | not reachable on 2026-10-12 (Cursor `not_found`) |

Sonnet and Opus are never a first attempt and never in a fan-out. OmniRoute drops `reasoning_effort`
for `antigravity/claude-*`, and Cursor ids carry their effort in the name. Codex/GPT models are not
coding workers: they fail at multi-step agent work through this router. Sol is reachable only for
one-pass advice, and on 2026-10-12 not at all (Cursor `not_found`, Codex token invalidated).

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
| `lib/pack.mjs` | Deterministic context pack |
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

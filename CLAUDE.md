# agent-box — agent context

## What this is

Runs OpenCode workers on a git repo inside disposable Podman or Docker containers, with models served
through OmniRoute. Orchestrated from the outside (Claude Code, Hermes, or developer): it plans, writes
acceptance tests, runs gates and merges; workers implement and review. It is not an interactive chat
assistant or an IDE plugin — it is an isolated headless execution harness for autonomous agent loops.

## Layout

```text
delegate.sh          Main CLI entrypoint: run, loop, review, continue, resume, doctor, clean, gc, stats
agent-box.conf       Default configuration: engines, roles, review modes, loop caps, context settings
agent-box.local.conf Machine-local overrides: AGENT_BOX_SLOTS, AGENT_BOX_ENGINE, AGENT_BOX_NS (not in git)
image/               Worker container definition: Dockerfile, run-task.sh, changed-tests.sh
lib/                 Host-side Node.js orchestration logic: loop, ledger, verify, config, doctor
projects/            Per-project configurations: <repo>.env (keys), <repo>.context.yaml, <repo>.Dockerfile
bench/               Benchmark fixtures, suites, and materialize scripts
test/                Host-side Node.js unit tests (node --test)
docs/                Documentation: known-gaps.md, ledger.md, project run stats and reviews
research/            Workflow analyses, model performance logs, findings
tasks/               Task specifications and proof tests organized by project and phase
runs/                Runtime execution logs and artifacts (gitignored)
ledger/              Persistent run outcomes and metrics (gitignored)
.agents/skills/      Vendored RakunCodingKit skills, tracked in git
.agents/KIT.md       Kit version, sources, pinned commits
```

## Build, test, run

| Task | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Test | `bash -n delegate.sh && bash -n image/run-task.sh && bash -n image/changed-tests.sh && node --test test/*.test.mjs` |
| Build worker image | `./delegate.sh build` |
| Environment check | `./delegate.sh doctor [repo-path]` |
| Run single worker | `./delegate.sh run <repo-path> <task.md> [options]` |
| Run review loop | `./delegate.sh loop <repo-path> <task.md> [options]` |

Toolchain:
- Bash: Git Bash on Windows, bash 4+ on Linux / macOS.
- Node.js 20.11+ (tested on Node 24), `yaml` is the only host-side npm dependency.
- Podman (default engine, `podman machine` on Windows) or Docker.
- OmniRoute gateway running on host (`http://localhost:20128/v1`).

## Conventions

- Shell scripts strictly use POSIX / bash syntax (`ls`, `$HOME`, `&&`, `|`, single quotes). No PowerShell or cmd idioms.
- Host-to-container network paths use `host.containers.internal` (Podman) or `host.docker.internal` (Docker).
- Unit tests use Node's built-in test runner (`node:test`, `node:assert/strict`). No extra test frameworks.
- Do not check in `projects/*.env`, `agent-box.local.conf`, or `runs/`.
- Tasks are grouped under `tasks/<project>-<phase>/` (e.g. `tasks/lykos-p3/`, `tasks/rakunloots-p9/`).
- `.agents/skills/` is vendored. Never hand-edit it. Refresh with `RakunCodingKit/update.sh`.

## Rules

1. **Check premises against source.** Read the installed dependency when building against it. Never rely
   on an unverified claim about its behaviour.
2. **Adopt, don't rebuild — behind a bar.** Evaluate a third-party piece against a stated bar before
   writing your own. Never delegate what this project must own.
3. **Never fabricate a number.** No evidence means "unmeasured". An agent's self-report never counts as
   success.
4. **Freeze the head.** If this project depends on prompt or schema cache hits, say which surfaces are
   frozen at boot.
5. **Evidence over report.** The diff, the test run, and the artifact are the evidence. Summaries are
   claims.
6. **Container isolation.** Worker runs must stay completely confined to their disposable containers;
   host modifications by workers are violations.

## Agent setup

Built with **RakunCodingKit** (1.1.0). `.agents/skills/` is vendored and tracked in git.
`CLAUDE.md` is a copy of this file (symlinks require elevated privileges on Windows). See `.agents/KIT.md`
for the exact sources and commits.

Delegation: `agent-box` skill, workers in Podman through OmniRoute, per-project `.env` holds the API key.

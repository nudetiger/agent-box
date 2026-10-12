# agent-box

Runs an [OpenCode](https://opencode.ai) worker on a git repo inside a disposable Docker container,
with models served through OmniRoute. Built for Claude Code to delegate to.

## Trust boundary

- **In:** a `git bundle` of one committed revision, the task file, and the project's OmniRoute key.
  Nothing else: no host `.git`, no home directory, no SSH keys, no `gh` token, no uncommitted work.
- **Out:** a `git bundle` of the worker's commits, fetched into the repo as branch `agent/<name>`,
  plus logs. No file written by the container is ever executed on the host.
- **Container:** non-root `node` user, `--cap-drop ALL`, `no-new-privileges`, pid and memory limits.
  Removed after every run.
- **Not covered:** network egress is open (needed for `npm ci`). A hostile model can send out the
  repo source and the OmniRoute key, nothing more. Shared kernel (`runc`), not a VM.
- The npm cache is a shared named volume (`agent-box-npm-cache`). npm checks lockfile integrity
  hashes, so a poisoned cache entry fails install instead of being used.

## Setup per project

```bash
cp projects/example.env projects/<repo-folder-name-lowercase>.env   # fill OMNIROUTE_API_KEY, DEFAULT_MODEL
./delegate.sh models  /path/to/repo      # which model ids the key can use
./delegate.sh baseline /path/to/repo     # setup + tests with no agent: know the starting state
```

## Use

```bash
./delegate.sh run /path/to/repo task.md --role <role> [--name N] [--base REF] [--timeout MIN] [--test CMD]
./delegate.sh run /path/to/repo task.md --model <id> [--review] [--variant V] [--web] ...
./delegate.sh show /path/to/repo <name>
./delegate.sh clean
```

Each run prints a report: `summary.json` (exit codes of setup, agent and tests, commit count),
commits, diffstat, the test tail, token totals and the agent's final message. Full logs stay in
`runs/<project>/<name>/`. The agent's message is a claim; `test_exit` and the diff are evidence.

`--test CMD` overrides the project's `TEST_CMD` for one run, e.g. a single test file.

`--web` allows OpenCode's `webfetch` tool, which is denied by default (prompt-injection surface).

## Roles

Defined in `agent-box.conf`. `--role` picks the model; `review` and `bughunt` are read-only.

| role | model | job |
| --- | --- | --- |
| implement | `deepseek/deepseek-flash` | default worker: specified features, bug fixes, tests |
| implement-hard | `deepseek/deepseek-flash-high` | retry of a failed implement, cross-module work |
| feature | `gemini-3.8-flash-tiered` | multi-file features and refactors, parallel second attempt |
| easy | `cx/gpt-5.6-luna-xhigh` | mechanical edits: renames, moves, lint/type fixes, boilerplate |
| write | `cx/gpt-5.6-terra-medium` | prose: docs, ADR drafts, README, issue text |
| review, bughunt | `antigravity/gemini-3.1-pro-high` | read-only review or bug hunt; findings in the report |

A read-only run (`--review` or a read-only role) discards every edit, records any attempt in
`review-violation.txt`, skips tests, and fetches no branch.

## Engine

`AGENT_BOX_ENGINE` in `agent-box.conf` (or the environment): `podman` or `docker`. Build once per
engine. Measured 2026-10-12, one full Lykos suite each, same commit, same machine:

| | Docker 29.6.2 | Podman 6.1.3 |
| --- | --- | --- |
| image | 2.15 GB | 1.55 GB |
| `npm ci` | 27 s | 22 s |
| test suite | 504 s | 653 s |
| wall | 543 s | 683 s |
| Windows-side processes, idle | ~770 MB (Docker Desktop, backend, agent, build) | ~13 MB (win-sshproxy) |

Both run inside the same WSL2 VM (`vmmem`), so the VM's memory is shared and not attributed here.
Podman's RAM saving only appears once Docker Desktop is closed.

## Files

| | |
| --- | --- |
| `delegate.sh` | Host side: bundle in, container lifecycle, bundle out, fetch, report |
| `image/run-task.sh` | Container side: clone, setup, OpenCode, leftover commit, tests, bundle |
| `image/preamble.md`, `image/preamble-review.md` | Operating conditions prepended to every task / review |
| `agent-box.conf` | Engine and roles |
| `projects/*.env` | Per-project key and settings. Git-ignored |
| `runs/` | Run outputs. Git-ignored |

After changing anything under `image/`, run `./delegate.sh build`. To update OpenCode, change
`OPENCODE_VERSION` in `image/Dockerfile` and rebuild.

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
./delegate.sh run /path/to/repo task.md --model <id> [--name N] [--base REF] [--timeout MIN] [--variant V] [--web] [--test CMD]
./delegate.sh show /path/to/repo <name>
./delegate.sh clean
```

Each run prints a report: `summary.json` (exit codes of setup, agent and tests, commit count),
commits, diffstat, the test tail, token totals and the agent's final message. Full logs stay in
`runs/<project>/<name>/`. The agent's message is a claim; `test_exit` and the diff are evidence.

`--test CMD` overrides the project's `TEST_CMD` for one run, e.g. a single test file.

`--web` allows OpenCode's `webfetch` tool, which is denied by default (prompt-injection surface).

## Files

| | |
| --- | --- |
| `delegate.sh` | Host side: bundle in, container lifecycle, bundle out, fetch, report |
| `image/run-task.sh` | Container side: clone, setup, OpenCode, leftover commit, tests, bundle |
| `image/preamble.md` | Operating conditions prepended to every task |
| `projects/*.env` | Per-project key and settings. Git-ignored |
| `runs/` | Run outputs. Git-ignored |

After changing anything under `image/`, run `./delegate.sh build`. To update OpenCode, change
`OPENCODE_VERSION` in `image/Dockerfile` and rebuild.

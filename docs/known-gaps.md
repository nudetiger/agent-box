# Known gaps

Found while driving Lykos P2's third band (T208–T218) through `loop` with
`AGENT_BOX_SLOTS=3 AGENT_BOX_PARK=1`, 2026-10-19 to 2026-10-20. Each entry says what was seen, why,
and the workaround used. Lykos P3 (2026-10-22) added 5 to 8. All eight were fixed on 2026-10-23
(**Fixed** lines); the RakunLoots P9 gaps are in docs/rakunloots-p9/rakunloots-phase9-2026-10-21.md.
Unit tests cover the host-side logic (test/gaps.test.mjs). The shell-side fixes are checked by
`bash -n` and by hand, not yet in a live run.

## 1. A resumed parked session waits for its own slot number

**Seen.** L209's `rv1` and L217's `rv2` looked hung: the loop waited, the reviewer printed nothing.

**Why.** A parked container frees its slot, but resuming it waits for the same slot number
(`runs/.slots/N`) it held before. Another run (t215) had taken slot 3, so the resume blocked until
t215 ended, although slots 1 and 2 were free. Nothing in the loop output says it is waiting on a
slot.

**Workaround.** Let the run holding that slot finish, or `unpark` it. Better: a resume takes any
free slot, and a wait for a slot prints which run holds it.

**Fixed.** `slot_acquire` prefers the parked slot only for `SLOT_PREFER_WAIT` seconds (default 0),
then takes any free slot and starts a fresh container (the parked one is removed, with a message).
A wait prints the holders (`slot:run (project)`). Slots of dead owners are reclaimed.

## 2. A stopped Podman VM reads as "ended with no summary"

**Seen.** `loop resume L212` started fix round `L212-fix1-1`, which ended 9 ms later with
`next fix_environment: fix round L212-fix1-1 ended with no summary`. No run directory was created.

**Why.** The Podman machine (`podman-machine-default`, WSL) had stopped; `podman` refused the
connection on `127.0.0.1:50461`. The loop does not check the engine before a step and does not
surface podman's error.

**Workaround.** `podman machine start`, then `loop resume`. Better: check `podman info` before each
step and stop with the engine's own message.

**Fixed.** `launch` calls `engine_up` (`podman info`) first and dies with the engine's error and
"podman machine start?". The loop's "ended with no summary" messages now quote the step log's tail.

## 3. An environment failure in a check container ends the loop

**Seen.** L212's `check1` failed `npm ci` with exit 6: node-gyp's headers download for
`better-sqlite3` reported "Completion callback never invoked". The loop stopped before reviewing,
although the base suite had passed.

**Why.** A network flake during dependency install is treated like a failing check. There is no
retry for install steps.

**Workaround.** `loop resume`. Better: retry `npm ci` once on a non-test failure, and label the stop
`environment` with the failing command.

**Fixed.** `run-task.sh` retries `SETUP_CMD` once after 5 s (`SETUP_RETRIES=0` turns it off; the
first log stays as `setup-1.log`) and logs the failing command with its tail. A check whose setup
failed stops the loop with `check <name>: setup failed (exit N), no test ran`, and `resume` reruns
only the check.

## 4. A worker whose gateway is down still runs the tests, and the round is spent

**Seen.** L212's fix round `L212-fix1-2`: `harness.log` shows `OmniRoute unreachable at
http://host.docker.internal:20128/v1: curl: (22) The requested URL returned error: 503`, then the
test step ran anyway (3 minutes), and the round ended `verdict error`, `next fix_environment`. No
model ran. Later `doctor` reported OmniRoute reachable from a container.

**Why.** The reachability probe only logs. The run continues to the test step, and the loop counts
the round.

**Workaround.** `doctor <repo>`, then `loop resume`. Better: stop the run at the failed probe with
an `environment` verdict, retry the probe a few times first, and do not count the round.

**Fixed.** The `/models` probe tries 4 times (10, 20, 30 s apart); still unreachable, the run skips
the agent and the tests (`agent_exit -2`, verdict `error`, next `fix_environment`). The loop counts a
fix round only when it passes. A worker that exits 0 without one model step is a provider error
("no model output", lib/ledger.mjs `noOutput`).

## 5. The repo argument must be a path, but the docs show a name

**Seen.** Lykos P3, 2026-10-22: `delegate.sh doctor lykos` and `doctor Lykos` failed with "not a git
repo". `doctor /c/Workspace/Projects/Lykos` worked. The skill and README write `<repo>` without
saying it is a path, and `projects/lykos.env` is found from the path's basename.

**Workaround.** Always pass the full path. Better: resolve a bare name through `projects/<name>.env`,
or say "path" in the usage line.

**Fixed.** `repo_path` resolves a bare name through `REPO_PATH` in `projects/<name>.env`; otherwise it
dies with "not a folder: X (pass the repo's path …)". The usage says `<repo>` is a path.

## 6. `loop` takes no `--add` at the start

**Seen.** Lykos P3 T195: I had my own findings before the first review. `loop` rejects `--add`; only
`loop resume` accepts it. The skill's "the same options at the start and on `loop resume`" reads as
if it applied to `--add` too.

**Workaround.** `continue <run> -f findings.md` first, then `loop` on the new round. Better: accept
`--add` at the start and send it to the first fixer with the review's findings.

**Fixed.** `loop --add FILE` at the start goes to the first fixer. A JSON findings array in `--add`
(start or resume) joins the loop: items with a valid reproduction become proven open items and
proofs, the rest go to the fixer as advice. `resume --retire ID` takes an item out without a
false-positive label.

## 7. A node_modules junction in a seal worktree can empty the main checkout

**Seen.** Lykos T195's first round linked the host's `node_modules` into a temporary `git worktree`
and removed the worktree with `git worktree remove --force` without unlinking first. The same
pattern emptied Lykos's `node_modules` once before (user memory "AGY worktree node_modules
junction"). The harness's review did not flag it.

**Workaround.** Name this in the task for any worker that creates worktrees. Better: a standing
lesson in the Lykos context pack.

**Fixed.** `lib/pack.mjs` reads top-level `traps:` from a context map into every pack.
`projects/lykos.context.yaml` has the trap: unlink `node_modules` before `git worktree remove --force`.

## 8. `wait --questions` returns at once on a question already answered

**Seen.** Lykos T197 loop: after `answer ... 1`, a new `wait loop-t197-r2 t199-r2 --any --questions`
returned immediately with "loop-t197-r2-rv1-review-both asks:" and an empty question;
`questions` said "no open questions".

**Workaround.** Check `questions <run>` before trusting the wake; start the wait again. Better: count
only unanswered questions.

**Fixed.** `wait --questions` skips parked runs, uses a file of its own per process (two waits
shared one before), and wakes only on output with a `## question` heading. `questions` skips empty
question files and answered ones.

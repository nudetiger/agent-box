# Maturity pass: journal (2026-10-17 onward)

Working checkout: `C:/Workspace/agent-box-dev/agent-box`, branch `harness-mature` (user merges it).
Project worktrees: `C:/Workspace/agent-box-dev/Lykos` (abdev/master), `.../RakunMiniItems` (abdev/main).
`agent-box.local.conf` here: AGENT_BOX_NS=dev, AGENT_BOX_SLOTS=2, AGENT_BOX_HERDR=0.
User rules for this pass: Gemini and DeepSeek free; Opus 4.6 rare (spec review only, a few per bench
round); 2 slots; target users are cross-platform (Linux/macOS/Windows, Docker and Podman); never push;
no co-author trailer in commits.

## Evidence that set the plan (master 93df15a)

- Step latency grows with context (t51: median 4.1 s under 60k, 11 s 60-120k, 41.7 s 120-180k; 74 of
  119 steps above 120k). Tools and Gradle: 101 s of ~50 min.
- t51: 36 of 61 bash calls were dependency discovery (javap/unzip/find ~/.gradle). Reviews: 21/50, 22/58.
- Fix rounds resume the whole session: L51-fix1-1 first step at 201k context.
- OpenCode 1.19 never compacts: `vl()` returns false when `model.limit.context === 0`, and
  make-config.mjs registers models without limits. `compaction.prune` defaults false and only prunes
  tool outputs older than the last 2 user turns (so: continued sessions), forked at the end of a prompt.
- Round 1 had a medium+ finding in 8 of 10 loops.
- 33 of 71 loop findings are low standards/test findings, never fed back.
- Ledger cost is 0 everywhere (no price table).
- Disk: models.json (1 MB, the whole OmniRoute list) in all 280 runs = 261 MB; session tgz 428 MB.

## Plan and status

| # | Item | Status |
| --- | --- | --- |
| 1 | Namespace (AGENT_BOX_NS), local conf, prune on build | done 64af04d |
| 2 | Model limits in make-config + compaction/prune config | done c14e01a (bench pending) |
| 3 | `api` lookup tool for dependency jars (JVM), cached index | done c14e01a |
| 4 | Fix rounds: smaller context (prune or fresh handoff), bench | prune+compaction; bench C pending |
| 5 | Self-check turn before the worker ends | done c14e01a, report merge 36e3ef1 |
| 6 | Project lessons from past findings into the pack | done c14e01a |
| 7 | Price table, cost in ledger and stats | done 36e3ef1 (prices not filled) |
| 8 | models.json out of /out; `gc` command | done |
| 9 | `doctor`; cross-platform fixes | done 36e3ef1; Linux container: tests + doctor ok |
| 10 | Docs: install, platforms, config files | done 40c8cf6; install-skill d3e3abe |
| 11 | Bench: old vs new on the same tasks | A running; B (core, high vs medium) and C (loops t49/t50) next |
| 12 | Diff inline in reviews and rechecks | done a07ad7a |

## Setup for benches

- `agent-box-base` worktree (branch harness-base = master + namespace commit), NS=base, 1 slot,
  repos in `repos-base/` (clones, origin fetch = GitHub, push disabled).
- `agent-box-run` worktree (detached, the commit under test), NS=dev, 2 slots, repos in `repos-dev/`.
  Edit in `agent-box`, never in `agent-box-run` while it runs; move it with `git checkout --detach`
  and rebuild images between benches.
- Bench C driver: `benchC/pipe.sh <base|dev> <t49|t50>` (same rulings as the E2E after-side).

## Log

- 2026-10-17 14:30 smoke (core/feature-report-sort, dev): pass, 265 s, 36 steps, self-check 19 s.
- Editing delegate.sh during a run: the run's tail executed new text ("syntax error near `)`" at exit).
  Benches now run from agent-box-run.
- New namespace: first run seeds the Gradle volumes (12 min for RakunMiniItems), once.
- OpenCode provider timeouts: headerTimeout/chunkTimeout default 300 s; retry regex covers
  "request/response/stream timeout" but whether the abort errors match is unverified: left alone.
- Bench A (real/rakun-lifesteal, real/rakun-reduction-incoming; Gemini implement; one run each):
  base 2/2 pass (467 s / 51 steps, 542 s / 31 steps); dev 2/2 pass (473 s / 50 steps, 879 s / 66
  steps, 92k reasoning tokens vs 5k: model variance). Self-check 38 s and 57 s, found nothing. Neither
  task touched dependency jars or passed 110k context: api and compaction not exercised.

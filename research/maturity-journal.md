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
| 2 | Model limits in make-config + compaction/prune config | |
| 3 | `api` lookup tool for dependency jars (JVM), cached index | |
| 4 | Fix rounds: smaller context (prune or fresh handoff), bench | |
| 5 | Self-check turn before the worker ends | |
| 6 | Project lessons from past findings into the pack | |
| 7 | Price table, cost in ledger and stats | |
| 8 | models.json out of /out; `gc` command | |
| 9 | `doctor` command; cross-platform fixes (bash 4, GNU-isms, Linux host networking) | |
| 10 | Docs: install, quickstart, platform notes | |
| 11 | Bench: old vs new on the same tasks | |

## Log

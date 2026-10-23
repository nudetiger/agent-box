Spec: #106

## Parent

#106

## What to build

Proof on real servers that phase 9 runs. RakunLoots enables with both menu files shipped, and the `rltest` smoke test passes on Paper 26.2, Spigot 26.2, and Folia 26.2. This ticket needs the RakunProbe test servers. The orchestrator runs it, not a sandboxed worker.

## Deliver

- Build the shadow jar from the branch with every phase 9 ticket merged.
- On a fresh install on each of Paper 26.2, Spigot 26.2, and Folia 26.2: enable, run `rltest`, reload once, and run `rltest` again.
- Check the log for any ERROR from RakunLoots, and for any RakunLoots WARN on the fresh install. Both menu files must load quiet.
- Open the claim command and the wiki command once from the console on each server, and record the player-only reply.
- Write the results as a comment on this issue: server, build, `rltest` checks passed, ERROR and WARN counts.

## Do not

- Do not change code to make a run pass. A failure becomes a new issue under #106 with the log lines, and this ticket waits for it.
- Do not run the full version matrix from 1.18.2. Phase 9 adds no version-specific code beyond the sound registry check. If that check fails on any server, open an issue.

## Acceptance criteria

- [ ] `rltest` passes on Paper 26.2, Spigot 26.2, and Folia 26.2, before and after a reload.
- [ ] No ERROR from RakunLoots, and no RakunLoots WARN, on a fresh install on each.
- [ ] Results are commented on this issue.
- [ ] The owner's client check of both menus follows and does not block this ticket: opening, paging, claim clicks, sounds, and the wiki on each server.

## Blocked by

- #110
- #112

Final #113 real-server verification passed on2026-10-23 Asia/Bangkok, using product source `79c50b0` and jar SHA-256 `c513c8595c7b28e797486e2267e0b0d5685124b63cb23a639a6737a5e21ac5fc`.

| Server/build | Mode | PASS | FAIL | RakunLoots ERROR | RakunLoots WARN |
|---|---|---:|---:|---:|---:|
| Paper26.2-129 /9240f58 | Fresh |58|0|0|0|
| Paper26.2-129 /9240f58 | After reload |59|0|0|0|
| Spigot26.2 /4648-Spigot-8db49a2-96ae8cd | Fresh |58|0|0|0|
| Spigot26.2 /4648-Spigot-8db49a2-96ae8cd | After reload |59|0|0|0|
| Folia26.2-7 /14b7fee | Fresh |58|0|0|0|
| Folia26.2-7 /14b7fee | After reload |59|0|0|0|

351 passed, zero failed. Both shipped menu files loaded quietly in every run. All three servers stopped afterward, with no game/RCON listeners.

The second run on each server verified the installed jar hash, preserved configuration/database, started the existing install and reloaded before all checks. Actual claim-row click gave exactly2 items and closed the empty menu; claim-all stayed direct; wiki ordering/info/back passed, plus summons, blocks, lock, hologram packets, reload, restart persistence and removal.

All three servers recorded the same console replies:
- `claimsummon` and `claimsummon all`: “Only a player can take summon items, because they go into an inventory.”
- `loots`: “Only a player can open the loots wiki, because it shows the world they are in.”

Initial broad-startup assertion failures were external Windows OSHI crash-report diagnostics, tracked/fixed as test attribution in #114. Accepted runs retain the complete external diagnostics (one external registry ERROR record and three process-statistic diagnostics per startup); zero ERROR/WARN above refers to RakunLoots as this ticket requires. Four parser tests, actual-log replay and a completed independent High recheck pass. No product change was made to make a server test pass.

Final full Gradle check+shadowJar: BUILD SUCCESSFUL7m54s,135tasks;1480 root tests (35 existing conditional skips),126 Folia,24 Fancy,17 Java17 loader,506 tests across18 packet adapters;0 failures/errors. The strict chance accuracy and timing tests are unchanged and pass.

Full results and reproducible helper patch are committed in `docs/rewrite/phase9-verification.md` and `docs/rewrite/phase9-rakunprobe.patch`. Logs/XML/probes remain under C:/Workspace/Tools/agent-box/runs/rakunloots/. The owner's client opening/paging/claim/appearance/sound check follows and is nonblocking. Issue closure follows branch merge.
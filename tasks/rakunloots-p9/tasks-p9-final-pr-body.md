The claim command now opens a menu for pending summon items; `claimsummon all` retains direct claiming. `/loots` shows timer ordering, read-only loot contents and cached inclusion chances. The plugin owns layouts, inventories and scheduled actions across Paper, Spigot and Folia, including menu-file fallbacks, atomic claims, stale-view guards and localized chance formatting.

The Phase 9 review follow-up closes physical menus during Folia's supported owner-thread shutdown and retires wiki sessions on ordinary/explicit close, reload and supersession. Exact epochs preserve navigation sessions; overlapping failed opens now retire the old session exactly once while preserving newer pending or successful sessions. DeepSeek Max implemented and the same DeepSeek High reviewer completed the recheck with no findings. Sealed regressions were confirmed failing before the fixes and preserved unchanged.

Validation on final product `d53a589`:
- Full `check shadowJar`: 1,495 root tests (35 existing conditional skips), 131 Folia, 24 FancyHolograms, 17 Java 17 loader, 506 tests across 18 packet adapters; zero failures/errors.
- Final-jar RakunProbe fresh passes on Folia 26.2-7, Paper 26.2-129 and Spigot 26.2: 174 checks passed, zero failed, zero RakunLoots WARN/ERROR. Each pass also exercises reload and restart persistence. Earlier 351 fresh/after-reload checks are retained separately as historical evidence for the previous jar.
- A real Folia client receives the server's menu-close packet before shutdown disconnect. The identical check failed on the old jar.
- Owner-approved ADR cost correction preserves stable calculation, 1e-9 accuracy and the original 50 ms test. Independent large-input regressions and exact external Windows OSHI diagnostic attribution remain covered.

Known limitation: arbitrary live Folia disable from a thread that does not own the player still cannot guarantee physical inventory closure. The fix covers supported owner-thread shutdown; it introduces no unsafe cross-region access or blocking workaround.

[Verification, exact final jar SHA, reviewer IDs/tests and resource handoff](https://github.com/nudetiger/RakunLoots/blob/codex/phase9-menus/docs/rewrite/phase9-verification.md). The owner's client appearance, paging and sound check follows and does not block #113. No shipped resources changed in the review-fix pass. This branch also preserves the two local dependency-cleanup and phase-specification commits present at task start.

Closes #106
Closes #107
Closes #108
Closes #109
Closes #110
Closes #111
Closes #112
Closes #113
Closes #114

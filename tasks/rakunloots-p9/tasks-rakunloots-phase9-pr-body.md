The claim command now opens a menu for pending summon items; `claimsummon all` retains direct claiming. The new `/loots` wiki shows timer ordering, read-only loot contents and cached inclusion chances. The plugin owns the layouts, inventories and scheduled actions across Paper, Spigot and Folia, and closes menus on reload.

This includes menu-file fallbacks, atomic per-loot claims, stale-view/session guards, localized text, async chance-cache generation guards and `{chance:N}` formatting. The owner-approved ADR cost correction preserves the stable calculation, 1e-9 accuracy and original 50 ms test. Independent large-input numerical regressions and the completed DeepSeek High reviews are recorded in the handoffs.

Validation:
- Final full `check shadowJar`: 1,480 root tests (35 existing conditional skips), 126 Folia, 24 FancyHolograms, 17 Java 17 loader and 506 tests across all 18 packet adapters; no failures/errors.
- RakunProbe: fresh and after-reload runs on Paper 26.2-129, Spigot 26.2 and Folia 26.2-7; all 351 checks pass, zero RakunLoots WARN/ERROR. All servers stopped afterward.
- Four test-driver attribution tests and a completed independent High recheck verify the exact Windows OSHI startup diagnostics remain visible while plugin/unknown errors still fail. The reproducible helper patch is included because RakunProbe is a local-only sibling repository.

[Full verification, exact jar SHA, server builds and review handoffs](https://github.com/nudetiger/RakunLoots/blob/codex/phase9-menus/docs/rewrite/phase9-verification.md). The owner's client appearance, paging and sound check follows and does not block #113.

The branch also contains the two existing local dependency-cleanup and phase-specification commits present at task start.

Closes #106
Closes #107
Closes #108
Closes #109
Closes #110
Closes #111
Closes #112
Closes #113
Closes #114
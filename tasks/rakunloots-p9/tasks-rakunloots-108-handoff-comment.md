The #108 candidate is verified on `codex/phase9-108-accepted` at `2965ae6`. The issue remains open until final phase integration; #113 will provide the real-server proof.

Review evidence:

| Finding | Fix | Retained test | Verification |
|---|---|---|---|
| `1.both.1` | Validate the effective button slot after shipped inheritance; a slot outside the chosen rows warns high and drops the button. | `ConfigMenuFileTest.anInheritedButtonSlotOutsideAShrunkPageWarnsHighAndIsDropped` | Reviewer reproduction was red, then green. Host deliberately removed the guard: `:test --tests '*ConfigMenuFileTest.anInheritedButtonSlotOutsideAShrunkPageWarnsHighAndIsDropped'` failed in 13s; exact source restoration passed in 13s. |

`p9-108-loop-rv1-review-both-alt` reviewed the full change; the same DeepSeek High session rechecked the fix with zero findings. The loop replayed the reproduction and approved. Host `:test --tests '*config.*' --tests '*server.*'` passed in 30s: **544 tests, 0 failures, 0 errors, 0 skips**, counted from XML. The worker also ran the broader root suite: 1,345 tests, no failures/errors, 35 skips. The sealed menu-file acceptance was confirmed red before implementation; it stayed unchanged.

Other implementation changes: menu-file reading and immutable source maps in `ConfigFolder`/`ConfigSources`; snapshot page accessors; immutable `MenuPage`, `MenuButton`, and `MenuSound`; a `MenuConfig` parser with ordered bounded ranges, sparse defaults, validation and whole-file fallback; reuse of the existing item-reference parser; twelve warning kinds and severities; strict default sound checking; and config, folder, shipped-resource, and Bukkit catalog tests. No menu opening or language keys were added.

Sound API: `Registry.SOUNDS.get(NamespacedKey)` compiles against paper-api 1.18.2. The catalog has a fallback over actual `Sound.getKey()` values if registry initialization fails; it does not guess keys from enum names. The reviewer checked the 1.18.2 and 26.2 API surfaces. Actual 26.2 server verification belongs to #113.

Shipped-resource handoff:

| Path | Change | Why |
|---|---|---|
| `src/main/resources/menus/claim.yml` | New documented six-row layout, slots 0–44, gray pane filler, previous/claim-all/next at 45/49/53 with click sounds. | The claim menu has a quiet, recoverable default. |
| `src/main/resources/menus/wiki.yml` | New documented list/loot layouts, paging, back at 48 and book info at 49 without a sound. | Each wiki page has a shipped default and separate layout. |
| `src/main/resources/warnings.yml` | Twelve menu warning kinds, high validation warnings and severe `MENU_FALLBACK`. | Owners can identify and configure menu validation/fallback warnings. |

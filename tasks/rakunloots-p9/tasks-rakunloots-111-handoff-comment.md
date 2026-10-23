Wiki-list candidate `5621224` (`codex/phase9-111-accepted`) is accepted after full root diff inspection, the same DeepSeek High reviewer recheck with no findings, and an independent host gate. Final phase integration, #107's pending design ruling, and #113 remain open.

| Reviewer ID | Fix and retained test | Evidence |
| --- | --- | --- |
| `1.both.1` | `MenuService.replaceIf` reopens only the tracked inventory; WikiMenu tracks the replacement epoch. `aLootPage...` and `aLootPageWithDifferentRowsReplacesTheListInventory` cover title, size, slot48 back and prior list page. | Review reproduction failed before, passes after; host gate green. |
| `1.both.2` | Wrong-typed show/icon resets the whole map to shown/block icon. Both `aWrongTyped...` ConfigWikiTest cases retain the warning/default assertions. | Review reproduction failed before, passes after; host gate green. |
| `1.both.3` | `shippedWorldsAndLootsPinTheListOrder` loads all seven shipped loot files and worlds.yml; no-settings test inserts beta first and asserts alpha/beta output. | Reviewer reran both; host gate green. |
| `1.both.4` | Head fallback test asserts the adapter received the configured head data, not just PLAYER_HEAD material. | Same reviewer explicitly verified; host gate green. |

Other changes: production root command registration and permission enable/reload; immutable beside-Loot wiki settings and command settings; one captured config/location/world lookup; timer ordering preserves hidden loots in the denominator; item/block/head/barrier icons; description and chance lore; paging and back-only stub. Contents/info/cache follow in #112. The obsolete phase8 absence assertion was updated only for the newly required wiki permission.

Host command: `bash ./gradlew --console=plain :test --tests '*config.*' --tests '*command.*' --tests '*menu.*' --tests '*wiki.*' --tests '*Shipped*' --tests '*PermissionDefaultTest' --tests '*PluginEnableTest' :foliaTest`.
Output: BUILD SUCCESSFUL in2m18s; 537 root +126 Folia tests, zero failures/errors/skips. Original sealed settings test unchanged. Worker gate532 green; optional full suite1450 tests, zero failures,35 skips. An earlier initial-candidate full-suite50ms chance benchmark failure is retained as #107 evidence; this passing run does not waive the threshold or establish that earlier failure was pre-existing.

| Shipped path | Change | Why |
| --- | --- | --- |
| src/main/resources/config.yml | wiki_command defaults/comment | Player command name, aliases, permission policy |
| src/main/resources/plugin.yml | rakunloots.wiki default true | Register required permission |
| src/main/resources/languages/en.yml | Ten wiki/list/back keys | English player text |
| src/main/resources/languages/vi.yml | Same keys translated | Vietnamese player text |
| src/main/resources/languages/zh.yml | Same keys translated | Chinese player text |
| src/main/resources/loots/airdrops.yml | Commented wiki example | Explain optional icon/hiding settings |
| src/main/resources/warnings.yml | UNUSABLE_WIKI and UNUSABLE_WIKI_COMMAND_VALUE | Required registry for the new high warning kinds |

The warnings scope exception and read-only recheck's cumulative scope false positive were labelled in agent-box. Original feature leftovers were fully inspected and will be squashed into one #111 integration commit.

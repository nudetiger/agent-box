Loot-page candidate `13af9d5` (`codex/phase9-112-accepted`) is accepted. Root read the full original diff and every fix; the same DeepSeek High reviewer completed its final recheck with zero findings. Final phase integration with the corrected #107 math and real-server #113 checks remain pending.

| Finding | Fix and retained regression | Evidence |
| --- | --- | --- |
| `1.both.1` | Negative weights use always-included text even before cache readiness. `anAlwaysIncludedEntrySaysSoBeforeChancesArrive` and root `anAlwaysEntryIsKnownEvenBeforeTheChanceJobRuns`. | Independent root red showed calculating instead of Always; final host gate green. |
| `1.both.2` | Keep renderer missing-info barrier name/lore, using the same rendered resolution. `aMissingInfoLayoutItemKeepsTheMenuBarrierNameAndLore` and `Phase9WikiInfoResolutionProofTest`. | Root changing source missed once then hit; old fix relabelled the barrier. Final exactly-one-resolution test green. The corrected canonical label is Missing vanilla:id; an obsolete bare-label replay was dropped explicitly, not the original behavior check. |
| `1.both.3`, `2.both.1`, `3.both.2` | Commit target page state only after physical replacement succeeds. Refused, exceptional, two concurrent, and list-paging-during-refused opens leave the visible page intact. | Retained `aLootPageThatFailsToOpen...`, `anExceptionalLootPageOpen...`, `twoLootPageOpensThatFail...`, `pagingTheListDuringAFailedLootOpen...`; reviewer reproductions and final gate green. |
| `3.both.1` | Missing back item preserves missing name/lore and still has its back action. `aMissingBackLayoutItemKeepsItsBarrierNameAndStillReturnsToList`. | Reviewer red reproduced no back navigation; final gate green. |
| `root.stale_world_read` | Session registration happens after a menu lands, not during a pending request. `anOlderWorldReadCannotRemoveTheCurrentLootPagesRefreshRegistration`. | Root real ConfigLoader/adapter-held future proof red: expected1 update, actual0. Same retained assertion green. |
| `4.both.1` | A refused newer request cannot unregister a still-visible earlier menu; a late old callback cannot replace a registered newer epoch. `anInverseWorldReadCannotUnregisterTheVisibleMenu`. | Reviewer inverse-order reproduction failed before; final reviewer5 and host gate green. |

Other feature changes: snapshot-bound `LootChanceCache` schedules all loaded loot calculations on adapter.async at enable/reload, checks generation after calculation before publication, and never calculates on page reads. A deterministic `Phase9ChanceCacheMidCalculationTest` holds real math while a newer load publishes, then verifies the old completion cannot overwrite it. Full content icons preserve own lore, cap stack amounts, show chance/full amount, hide zero weight, show missing source:id barriers, sort rarest first/always last, and stay inert. Info shows description/mode/lock/life/count and sorted world timer shares; blank lines drop out. One extracted `TimeText` implementation serves both wiki and holograms, whose existing tests stayed unchanged. Shipped treasure_chest and50-entry paging/back checks retained; prior #111 list order, permissions and title/size tests retained with only obsolete stub expectations updated.

Host command: `bash ./gradlew --console=plain :test --tests '*menu.*' --tests '*wiki.*' --tests '*hologram.*' --tests '*Shipped*' --tests '*Plugin*' :foliaTest`.
Output: BUILD SUCCESSFUL in51s;303 root tests,0 failures/errors,1 intentional existing FancyHolograms loader conditional skip (its property is set by java17Test);126 Folia tests,0 failures/errors/skips. The original sealed chance-cache test is unchanged. Final worker also ran the unfiltered root suite without build cache successfully38s.

One earlier worker run hit `PluginListenerWiringTest.aChunkUnloadAbandonsThePendingSummonInThatChunk`; isolated and later gate/full runs passed, but no baseline reproduction was run, so this is not labelled proven pre-existing. No unrelated test or threshold was changed.

| Shipped path | Change | Why |
| --- | --- | --- |
| src/main/resources/languages/en.yml |18 loot-content/info keys | English loot-page text and placeholders |
| src/main/resources/languages/vi.yml |Same18 keys translated | Vietnamese loot-page text |
| src/main/resources/languages/zh.yml |Same18 keys translated | Chinese loot-page text |

No layout, loot, config, warning registry or plugin.yml resource changed in #112. Agent-box stale-reproduction replay, prompt-only --add behavior, and read-only cumulative scope-attribution gaps are recorded in C:/Workspace/Tools/agent-box/docs. No simulation, on-open chance work, or #107 math workaround was added.

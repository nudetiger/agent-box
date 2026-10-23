Claim-menu candidate `12aa6f2` (`codex/phase9-110-accepted`) is accepted after the independent host gate and final same-session DeepSeek High recheck returned zero findings. The reviewer reran the sealed proof plus five extra edge checks (click before/after physical refresh, failed-update recovery, stale update vs replacement, and close with a pending update), all green. Final phase integration and #113 remain pending.

Review and regression evidence:
| Finding | Fix and retained test | Evidence |
| --- | --- | --- |
| `p9-110-review1-review-both-alt:1` | Per-row item-build failure becomes an inert barrier, retains the row, reports the failure, and leaves valid rows usable. `ClaimMenuTest.anUnbuildableSummonItemShowsABarrierAndKeepsTheOtherRowUsable` uses real SummonItemMaker/SQLite. | Red: menu did not open. Green in the 258-test host gate. |
| `p9-110-review1-review-both-alt:2` | Immutable per-session state, locking, refresh sequence and revision checks. `ClaimMenuTest.aRefreshCannotDispatchItsStaleViewAfterANewerClaimDuringRendering`. | Red: stale beta view dispatched after newer gamma view. Green: one current view dispatched. |
| `root.queue_order` | Per-handle physical update completion chain with current-handle checks and recovery after failed updates. `Phase9ClaimLanguageSnapshotProofTest.anOlderQueuedRefreshCannotOverwriteANewerPageTurn`. | Root red: page 1 overwrote newer page 2 (loot1 instead of loot9). Green unchanged. |
| `root.language_snapshot` | MenuRenderer accepts captured page messages; claim rendering uses the same config for rows, title, buttons, navigation names and lore. `Phase9ClaimLanguageSnapshotProofTest.pageLabelsUseTheSameSnapshotAsTheRowsWhenReloadInstallsNewConfigDuringRender`. | Root red: OLD_NEXT expected, NEW_NEXT displayed. Green unchanged. |
| `p9-110-review2-review-both-alt:1` | Separate desired and physically visible views; click actions follow the physically applied view. `Phase9ClaimVisibleViewProofTest.aClickOnTheStillVisibleOldRowCannotClaimADifferentLoot`. | Independent red: visible loot0 click took loot1 too, inventory5 instead of2. Green unchanged. |
| `p9-110-review2-review-both-alt:2` | Deferred click captures visible version and handle; a changed visible view invalidates it. `Phase9ClaimVisibleViewProofTest.aDeferredClickCannotRunTheNewIconActionAfterAnInPlaceRefresh`. | Independent red: replacement action ran once instead of0. Green unchanged. |

Other feature changes:
- `UnclaimedSummonItems.owed(UUID)` reads storage order asynchronously with missing-loot flags. Single-loot `claim(UUID,String)` reuses the existing per-loot state machine and preserves lowering storage before giving and writing back what did not fit.
- Root claim command opens the menu or reports nothing waiting; `all` retains the direct claim. Both enforce existing permission/player-only behavior. Existing claim and join message texts remain unchanged.
- Production plugin/command wiring, amount-capped icons with full amount lore/title, missing/unavailable barrier rows, claim-all, same-page refresh/clamp and close when empty.
- Held/failing-future guard tests, reopen/page protection, partial inventory128 given/72 remaining, 46-row shipped-layout paging, and initial-read/completion guards across reload, close and replacement. Each operation uses one config snapshot.
- Root corrected its own sealed fixture by adding required open_mode and explicit known-loot assertions; production config rules were never changed. All three sealed classes remained unchanged in the final worker pass.

Host command: `bash ./gradlew --console=plain :test --tests '*claim.*' --tests '*menu.*' --tests '*command.*' --tests '*Shipped*' --tests '*ClaimPermissionDefaultTest' :foliaTest`.
Output: BUILD SUCCESSFUL in48s; XML258 root tests +126 Folia tests; zero failures, errors or skips. Worker supplied the same green counts. Full unfiltered phase checks and real servers follow final integration.

Shipped resources:
| Path | What changed | Why |
| --- | --- | --- |
| src/main/resources/config.yml | claim_command comment explains menu and `all` | Describe the two player flows |
| src/main/resources/languages/en.yml | Seven claim-menu keys; unavailable-item wording covers missing or unbuildable summon items | Full counts and meaningful inactive rows |
| src/main/resources/languages/vi.yml | Vietnamese translations of the same keys and wording | Same claim behavior in Vietnamese |
| src/main/resources/languages/zh.yml | Chinese translations of the same keys and wording | Same claim behavior in Chinese |

No menu layout or warnings resource changed in #110. Agent-box seal-restoration and read-only-review scope-attribution gaps were recorded under C:/Workspace/Tools/agent-box/docs, with original evidence retained.
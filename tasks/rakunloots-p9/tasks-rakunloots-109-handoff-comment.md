Menu engine candidate accepted at `7e7aed9` (`codex/phase9-109-accepted`), pending final phase integration and #113 real-server proof. No issue closed yet.

Review findings and evidence:
- `1.both.1`: unused content slots are empty after filler placement. MenuRenderer paging tests cover 0/10/11/25 entries, navigation and clamp; reviewer reproduction passed after fix. Independent shipped-layout host reproduction failed before the fix.
- `1.both.2`: added close-one-player with identity-safe cleanup and pending replacement cancellation; MenuServiceTest.closeRetiresOnlyThatPlayersMenu and closeCancelsAPendingReplacement pass, as does the reviewer reproduction.
- `1.both.3` / `2.both.1`: AdminCommandsTest.reloadClosesEveryRealMenuAfterTheSearchTakesTheNewConfig opens two real service menus and checks both closed after the new snapshot reaches the search. Worker mutation removing reload closeAll failed; restored behavior passed.
- `1.both.4` / `2.both.2`: LootBoxInteractionListenerTest.aMenuClosePassesBothListenersWithoutClosingTheLootBoxInventory drives both real listeners and proves the emptied loot box remains. Worker mutation routing menu close into the loot lifecycle failed; restored behavior passed.
- Additional stop fix: FoliaMenuTest.aCloseAtPluginStopCompletesAndRetiresTheMenuWithoutTheDisabledScheduler failed with a strict fake reproducing Folia's disabled-plugin callback drop, then passed after onEntity completes with the left-out value when already disabled. Full Folia shutdown disconnects players after regions stop; this proves logical retirement/completed cleanup without unsafe off-thread inventory calls, not physical UI closure during unsupported hot disable.

Final DeepSeek High same-session recheck: zero findings. Host command `bash ./gradlew --console=plain :test --tests '*menu.*' --tests '*server.*' --tests '*PluginListenerWiringTest' --tests '*PluginEnableTest' --tests '*command.*' --tests '*LootBoxInteractionListenerTest' :foliaTest`: BUILD SUCCESSFUL in 1m35s, 379 root tests +126 Folia tests, zero failures/errors/skips.

Other changes: immutable view/icon types, paging renderer, generation/handle-safe open/refresh/close/click service; separate menu holder and inventory; Paper/Spigot/Folia adapter calls, sound playback and offline no-ops; deferred click actions through player scheduling; real Bukkit click/drag/close listener; enable/reload/disable wiring; item-resolution barrier and warning deduplication per reload. A sound without an action is inert. Inventory title API at the 1.18.2 floor accepts longer than32 characters, so no truncation/warning was introduced.

Shipped resources:
| Path | Change | Why |
| --- | --- | --- |
| src/main/resources/languages/en.yml | Four previous/next page name/lore keys | Paging text and destination placeholders |
| src/main/resources/languages/vi.yml | Vietnamese translations of the four keys | Same paging behavior in active Vietnamese |
| src/main/resources/languages/zh.yml | Chinese translations of the four keys | Same paging behavior in active Chinese |
| src/main/resources/warnings.yml | Runtime missing menu-layout item warning | Report barrier fallback once per reload |
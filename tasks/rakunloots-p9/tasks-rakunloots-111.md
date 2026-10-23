---
issue: 111
files: [src/main/java/me/rakkoon69/rakunloots/config/ConfigSnapshot.java, src/main/java/me/rakkoon69/rakunloots/command/ClaimCommand.java, src/main/java/me/rakkoon69/rakunloots/menu/MenuService.java, src/main/java/me/rakkoon69/rakunloots/RakunLootsPlugin.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/config/Phase9WikiSettingsAcceptanceTest.java]
scope: [src/main/java/**, src/main/resources/config.yml, src/main/resources/plugin.yml, src/main/resources/languages/**, src/main/resources/loots/airdrops.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*config.*' --tests '*command.*' --tests '*menu.*' --tests '*wiki.*' --tests '*Shipped*' --tests '*PermissionDefaultTest'"
steps: 130
---
Implement #111 completely with actual command/plugin wiring and all acceptance criteria. No scouts/subagents; one model at a time. This is the authorized DeepSeek Max fallback implementation; DeepSeek High reviews as explicitly authorized by the user after AGY Opus route failed.

Use #109 menu engine and #107 TimerChance. Keep all wiki fields beside Loot in the snapshot as the issue/ADR0008 demand. No chance cache/content/info yet; implement only the required back-capable stub page. Read the full issue/parent and relevant ADRs before code. The sealed settings tests specify the small config interface; other menu design follows existing #109/#110 seams. Every additional test must be seen red first. Include genuine translations, command permission defaults at enable/reload, current-world lookup read once, stable shipped order, real block/head item fallback, formatted chance decimals, paging/back preservation. Retain all existing shipped-resource tests and list each changed resource in the report.

Use :test for filtered root tests. Run the exact task gate after changes and finish promptly. The final report must be JSON in a fence whose opening is three backticks followed by agent-box-report, followed by a JSON object on the next line and a closing three-backtick fence. Do not wrap YAML under a yaml fence: the harness cannot parse that. Include actual test results, red proofs, decisions and disputes; no invented timings.

The config accessor specified by the sealed tests is ConfigSnapshot.wiki(String lootId), Optional of the beside-Loot settings with show() and icon() accessors, following existing hologram(String). ConfigSnapshot.wikiCommand() provides name(), aliases(), permissionDefault(). Keep immutable settings and no wiki fields on Loot.

Use the final #110 MenuRenderer API for captured snapshot messages, including paging labels/lore, and the MenuService update-order guarantee. Do not reintroduce live global language lookups into a render that otherwise captured one config snapshot, or build a second update-dispatch mechanism in this feature.

Contract checks to keep explicit: hiding a loot from the wiki changes only displayed rows, not the timer chance denominator (include every eligible timer loot, even hidden ones). The stub loot page has no content or info icon yet; use only its back button plus ordinary layout filler, without mutating the snapshot layout. Read sender location/world once for the list open and match its world UUID to loadedWorlds, per the issue. Existing adapter futures are required thread-safe reads; do not introduce a new async chance/calculation job in this ticket. Capture menu state/config before asynchronous reads, use the final menu service's visible-view and stale-open guards, and preserve list page on back.

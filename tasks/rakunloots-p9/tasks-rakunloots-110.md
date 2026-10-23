---
issue: 110
files: [src/main/java/me/rakkoon69/rakunloots/claim/UnclaimedSummonItems.java, src/main/java/me/rakkoon69/rakunloots/command/ClaimCommand.java, src/main/java/me/rakkoon69/rakunloots/menu]
sealed: [src/test/java/me/rakkoon69/rakunloots/claim/Phase9SingleClaimAcceptanceTest.java]
scope: [src/main/java/**, src/main/resources/languages/**, src/main/resources/config.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*claim.*' --tests '*menu.*' --tests '*command.*' --tests '*Shipped*' --tests '*ClaimPermissionDefaultTest'"
steps: 120
---
Implement #110 completely, including production wiring, actual SQLite tests and all acceptance criteria. Do not launch scouts/subagents: one worker/reviewer at a time. You are the user-authorized fallback implementer after repeated Gemini timeouts; DeepSeek High reviews afterward, as the user authorized after the AGY Opus route was unavailable.

The sealed acceptance establishes owed(UUID) returning CompletableFuture<List<UnclaimedSummonItem>>, and claim(UUID,String lootId) returning CompletableFuture<ClaimResult>. These are reads and a single-loot claim through the real existing store and adapter. Reuse the existing Claim per-loot state machine; do not duplicate storage/give ordering. The ordinary claim(UUID) retains its behaviour. Add your own red-first tests for the complete menu and command paths, including held/failing futures, 46 rows, missing loot, no permission, console and all. Use the actual #109 menu service and paging helper.

Read ADR0013,0010 and the full parent before writing. Preserve existing claim message texts and join behaviour. Include real translations in all three shipped languages and update the config comment. List each shipped-resource change in the report. Do not build wiki functionality. Use root-qualified :test for filters; run the exact gate once after changes and end promptly with agent-box-report, precise red/green evidence and any decisions. Do not repeat broad passing suites without a new reason.

End the final message with a JSON object in an agent-box-report fenced block (opening fence is three backticks immediately followed by agent-box-report, JSON on the following line). Do not put YAML under a yaml fence: that is not parsed. Include exact test results, decisions, context_gaps and test_dispute; do not repeat broad passing suites without a reason.

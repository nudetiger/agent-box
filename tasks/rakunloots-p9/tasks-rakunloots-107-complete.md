---
issue: 107
files: [src/main/java/me/rakkoon69/rakunloots/roll/LootRoller.java, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/ConfigLoadSupport.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/roll/Phase9ChanceAcceptanceTest.java, src/test/java/me/rakkoon69/rakunloots/config/RawRollFixture.java]
scope: [src/main/java/me/rakkoon69/rakunloots/roll/**, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/**, src/main/resources/warnings.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*Phase9ChanceAcceptanceTest' --tests '*roll.*' --tests '*config.*' --tests '*lootbox.*'"
red: false
steps: 90
---
Finish GitHub issue #107 from the recovered Gemini implementation already on this branch. Do not start scouts/subagents. Exactly one model at a time.

The earlier Gemini attempt implemented LootChance, TimerChance, percent formatting, and precision warnings. The orchestrator stopped that run because its sealed test had an input-fixture mistake: the production loader intentionally skips zero-weight entries (ConfigLootRollTest.weightZeroSkipsEntryWithHighWarning). The orchestrator corrected ONLY that case to use RawRollFixture, preserving real config loads for the other oracle tests. All code was snapshotted and preserved; no implementation was discarded. This is an orchestrator test correction, not a model implementation failure.

The corrected sealed test is CONFIRMED RED on the original code, with missing APIs, and now PASSES on the preserved implementation on the Windows host (38s BUILD SUCCESSFUL). red:false avoids asking a preserved working implementation to fail its existing acceptance. Both the acceptance class and RawRollFixture are sealed. Do not change production zero-weight parsing, min/max corrections, LootRoller, or existing config tests.

Do not re-derive the working integrator from scratch. Read the current six-file implementation diff against 5c671a9fbd67fe903c215692eae0376ec8ae3746, run the sealed test, then finish the remaining acceptance tests and any proven fixes. Missing work includes dedicated raw-Roll tests (constructors accessible in the config test package), grouped/equal weight checks, measured 100-distinct-weight max50 performance under50ms with the actual measurement in a comment, precision formatter edge cases and load-time invalid-precision warnings (every language and loot override, once per string), and shipped warnings registration. Check every checkbox in the issue. Confirm each added test fails against a deliberately wrong relevant implementation before passing it; an unrelated compile error is not proof of that assertion. No sampling or Random. No new language keys or async cache wiring.

Binding rulings from the completed spec check:
1. Percent formatting returns only the number. The percent sign is language text, as parent106 says. Phase overview examples show the completed rendered text.
2. #107 is pure functions/formatting/precision validation. #112 owns async enable/reload cache wiring.
3. Raw Rolls follow LootRoller.drawCount: clamp min/max at0; reversed uses max; choose count uniformly before capping each draw at n. ConfigLoader corrects production Rolls before this. For raw equal weights n2,min0,max4, inclusion is (0 +0.5 +1 +1 +1)/5=0.7, because drawing removes the entry (WITHOUT replacement). Add this test; do not clamp raw max to n before averaging.
4. Loader behavior on zero weight stays exactly as existing code/tests require. A raw zero-weight entry must be reported HIDDEN by LootChance, but the loader omits it. The corrected sealed fixture now expresses both seams accurately.

Report precise test commands/results, measured performance, deliberate-wrong red evidence, every shipped resource change, and any genuine test dispute. Do not claim completion from the sealed suite alone.
---
issue: 107
files: [src/main/java/me/rakkoon69/rakunloots/roll/LootRoller.java, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/ConfigLoader.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/roll/Phase9ChanceAcceptanceTest.java]
scope: [src/main/java/me/rakkoon69/rakunloots/roll/**, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/**, src/main/resources/warnings.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*Phase9ChanceAcceptanceTest' --tests '*roll.*' --tests '*config.*' --tests '*lootbox.*'"
steps: 130
---
Implement GitHub issue #107 completely. The issue and parent spec are fetched by the harness. Do not use scouts or subagents: exactly one model runs at a time in this assignment.

The sealed independent acceptance establishes the API: LootChance.calculate(Roll) returns Map<String,LootChance.EntryChance>, where EntryChance exposes probability() and kind(), and LootChance.Kind has ALWAYS/HIDDEN (and a drawable kind of your choice). TimerChance.calculate(Map<String,Integer>,Set<String>) returns Map<String,Double>. MessageText.render gains a fifth argument Map<String,Double> named percents beside string values. Keep these public seams for later tickets.

The independent acceptance was confirmed red on the host: compileTestJava failed because these new functions do not exist. Add remaining tests from every acceptance line in the issue, including warning scanning, shipped resource checks, numerical accuracy, and measured performance. Confirm each added test fails on wrong code first. Do not modify LootRoller. Do not change unrelated code or agent instructions. Read relevant ADRs including rejected alternatives before implementing. Report exact test evidence and any shipped resource change.
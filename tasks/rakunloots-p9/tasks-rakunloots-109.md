---
issue: 109
files: [src/main/java/me/rakkoon69/rakunloots/menu/MenuService.java, src/main/java/me/rakkoon69/rakunloots/server/ServerAdapter.java, src/main/java/me/rakkoon69/rakunloots/RakunLootsPlugin.java, src/main/java/me/rakkoon69/rakunloots/command/AdminCommands.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/menu/Phase9MenuEngineAcceptanceTest.java]
scope: [src/main/java/me/rakkoon69/rakunloots/menu/**, src/main/java/me/rakkoon69/rakunloots/server/**, src/main/java/me/rakkoon69/rakunloots/config/**, src/main/java/me/rakkoon69/rakunloots/log/**, src/main/java/me/rakkoon69/rakunloots/command/**, src/main/java/me/rakkoon69/rakunloots/RakunLootsPlugin.java, src/main/resources/languages/**, src/main/resources/warnings.yml, src/folia/**, src/foliaTest/**, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*menu.*' --tests '*server.*' --tests '*PluginListenerWiringTest' --tests '*PluginEnableTest' --tests '*command.*' :foliaTest"
steps: 130
---
Implement GitHub issue #109 completely. The harness fetches the issue and parent. Do not launch scouts/subagents; exactly one model at a time.

The independent sealed service acceptance establishes these public seams in package menu:
- MenuView(String title,int rows,Map<Integer,MenuIcon> icons).
- MenuIcon(ItemStack item,Optional<Runnable> action,Optional<the sound type from #108> sound).
- MenuService(ServerAdapter adapter), with open(UUID,MenuView), refresh(UUID,MenuView), click(UUID,int), and closeAll() returning CompletableFuture values so tests can await their effects. Additional constructors/dependencies for layout resolution and warning sinks may be added as the real plugin needs.
- The existing FakeServerAdapter gains menuOpens(), menuUpdates(), menuCloses(), and sounds() records. Opens expose title(),size(),contents(); updates expose contents(); sound records expose key(). These are successful effects, analogous to existing inventoryOpens; record attempts separately if needed.
The task's other APIs and internal types are yours to design. The service is the player-facing test seam; avoid exposing renderer internals to tests.

Write all additional acceptance tests from the issue (paging 0/10/11/25, real click/drag listener events, reload and stop, actual adapter scheduling, offline no-ops, missing layout item warning once per reload, translated paging keys). Confirm each added test fails against the relevant wrong behavior before passing it. One test loads the shipped menu resource and checks real output. Preserve the separate menu holder; never reuse SharedInventory or forward menu closes to the loot-box close path. Verify replacement and stale asynchronous opens/closes cannot erase a newer menu or close a different inventory.

Primary 1.18.2 title evidence already verified by the orchestrator: local Spigot1.18.2 bytecode traces CraftServer.createInventory(holder,size,title) -> inventory.util.CraftInventoryCreator -> CraftCustomInventoryConverter -> CraftInventoryCustom -> MinecraftInventory. Only chest size and non-null title are validated. There is NO32-character limit. Do not truncate titles or add a warning because a fake or old folklore says32. State the real API finding in the handoff.

Always use :test for filtered root tests in this multi-project build; bare test applies the filter to18 packet-adapter projects and produces unrelated no-matching-test failures. Compile the Folia source set and run foliaTest as part of the gate. Read relevant ADRs and rejected alternatives. Ship only the paging language keys listed in109, with real en/vi/zh translations and quoted placeholders. Report every shipped resource change and exact red/green evidence. Do not implement claim or wiki menus yet.
End the final message with a JSON object in an agent-box-report fenced block (opening fence is three backticks immediately followed by agent-box-report, JSON on the following line). Do not put YAML under a yaml fence: that is not parsed. Include exact test results, decisions, context_gaps and test_dispute; do not repeat broad passing suites without a reason.

Production race to cover within the one-open-menu contract: replacing an inventory may deliver the old holder's close after the new menu is installed. Match instance/handle identity so an old close does not retire the replacement. Adapter operations are futures, so handle an open completing after close/reload without leaving an untracked inventory. Tests should exercise the actual service/listener seams, not call-only helpers that production never uses. Keep this within the #109 engine; no real claim/wiki feature yet.

Routine paging convention: use zero-based internal page numbers (0 is the first page). If the requested page is outside the valid range, including negative, clamp it to the last valid page as the issue says. With zero entries there is one empty page, no previous/next buttons, empty content slots, and filler in the non-content/button positions. Language page numbers are one-based. Add tests for the boundaries alongside0/10/11/25entries.

Use this exact final-report shape with actual values:
```agent-box-report
{"status":"done","tests":"pass","test_summary":"exact command and observed results","decisions":[],"context_gaps":[],"test_dispute":false}
```

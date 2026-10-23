---
issue: 108
files: [src/main/java/me/rakkoon69/rakunloots/config/ConfigFolder.java, src/main/java/me/rakkoon69/rakunloots/config/ConfigSources.java, src/main/java/me/rakkoon69/rakunloots/config/ConfigSnapshot.java, src/main/java/me/rakkoon69/rakunloots/server/BukkitNameCatalog.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/config/Phase9MenuFilesAcceptanceTest.java]
scope: [src/main/java/me/rakkoon69/rakunloots/config/**, src/main/java/me/rakkoon69/rakunloots/server/BukkitNameCatalog.java, src/main/resources/menus/**, src/main/resources/warnings.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*config.*' --tests '*server.*'"
steps: 130
---
Implement GitHub issue #108 completely. The harness fetches it and parent #106. Do not launch scouts/subagents; exactly one model at a time.

The sealed acceptance establishes these accessors on ConfigSnapshot: claimMenu(), wikiListMenu(), wikiLootMenu(), each returning the immutable page layout type you define. That page has rows(), contentSlots() (ordered collection), filler() (ItemReference), buttons() (name-to-button map). A button has slot(), item(), sound() (Optional), and a sound has key(), volume(), pitch(). ConfigSources.Builder gains menu(id,text), and ConfigSources exposes the map. Other details are yours to design in the repo's style.

The acceptance was confirmed red on the host before implementation: :compileTestJava failed because menu(), claimMenu(), wikiListMenu(), and wikiLootMenu() do not exist. Supplement it with all acceptance tests from #108 and confirm added tests red before making them pass. Keep existing shipped-config tests strong and include both menu resources in them. Read relevant ADRs, including rejected alternatives. No GUI library, language keys, renderer or menu-opening code. State the verified 1.18.2 sound API call and list every shipped resource change in the report.
API evidence already checked by the orchestrator: the cached paper-api 1.18.2 jar exposes public Registry<Sound> Registry.SOUNDS. Use that registry with NamespacedKey to validate modern namespaced sound ids at the API floor; compile and test it. Do not replace it with enum-name guessing.

This is a multi-project Gradle build. Use :test for filtered root tests. Bare test with --tests also filters all18 packet-adapter projects and causes unrelated no-matching-test failures. Use :compileTestJava before :test when proving a missing API red.

NameCatalog's new default sound check is named soundExists(String key). The sealed fixture explicitly overrides it to accept the known shipped minecraft:ui.button.click and reject other sound keys, so it does not assume a permissive default. Keep NameCatalog functional/source compatible. BukkitNameCatalog overrides this method with the real registry check.

End the final message with a JSON object in an agent-box-report fenced block (opening fence is three backticks immediately followed by agent-box-report, JSON on the following line). Do not put YAML under a yaml fence: that is not parsed. Include exact test results, decisions, context_gaps and test_dispute; do not repeat broad passing suites without a reason.


## Binding orchestrator rulings

1. Use NameCatalog.soundExists with BukkitNameCatalog Registry.SOUNDS validation at config load. ServerAdapter plays the validated string key later in #109. Parent #106 Menu files explicitly assigns validation to NameCatalog and Menu engine assigns playback to the adapter; phases.md is a summary of the server-specific resolution boundary, not a second lookup contract.
2. The shipped info item has no action or sound. #108 explicitly says info(book,no sound); #106 distinguishes info with no click action from action buttons. The phases.md sentence about each button's sound describes clickable buttons. Keep ui.button.click on claim/navigation/back buttons and empty Optional on info. This is the specific exception stated in the ticket, not a change of contract.
3. Claim is a bare single page map. Wiki uses top-level list: and loot: page maps, without an extra pages wrapper. This is a routine schema choice within #106's two-page contract.
4. Wiki previous/next items are arrows and sounds are minecraft:ui.button.click, matching the shipped claim/navigation convention; back is oak_door with click sound; info is book without sound.
5. Missing filler uses the page's shipped filler silently. A syntactically unusable filler uses the existing item-parser warning(s) and the shipped filler, preserving the rest of the layout. This is not one of the three whole-file severe fallback triggers. A syntactically valid but runtime-unresolvable reference must stay a reference for #109 to render a barrier and warn; do not silently replace that runtime miss here.
6. Unknown button name warns high and drops only that button, preserving the page. Parent #106 explicitly says unknown button names are ignored; whole-menu fallback is limited to unreadable YAML, non-map root, or any page ending with no content slots.

The previous check received only a1500char cited-parent preview and therefore missed #106's full Menu files section. All phase child issues now have explicit Spec:#106 links, so the harness fetches the complete canonical parent. Re-read the full parent before implementing. Sound volume>=0, pitch0.5..2.0; bad values warn high and default1.0. No owner decision on #107's chance-method ADR is implied by these unrelated menu-file rulings.

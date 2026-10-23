---
issue: 112
files: [src/main/java/me/rakkoon69/rakunloots/menu/MenuRenderer.java, src/main/java/me/rakkoon69/rakunloots/roll/LootChance.java, src/main/java/me/rakkoon69/rakunloots/RakunLootsPlugin.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/wiki/Phase9ChanceCacheAcceptanceTest.java]
scope: [src/main/java/**, src/main/resources/languages/**, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*menu.*' --tests '*wiki.*' --tests '*hologram.*' --tests '*Shipped*' --tests '*Plugin*'"
steps: 130
---
Implement #112 completely, replacing #111's stub and wiring config-load chance jobs and open-page refresh in production. No scouts/subagents; one model at a time. DeepSeekMax is the authorized fallback implementer; user selected DeepSeekHigh reviewer because AGY Opus is unavailable.

The sealed cache test establishes a snapshot-bound cache seam. Supplement it with the entire issue acceptance: real shipped treasure_chest content items/amounts/chances/always order/info and timer world lines, no-lock/unending, zero-hidden/missing barrier, race with reload/running cache, no main-thread/open-time chance work, stale-page/user identity guard, 50entry paging/back. Use the #109/#111 menu engine rather than a second renderer. Move the existing hologram time formatter to one shared helper and keep hologram tests unchanged. Keep item own lore before chance and amount, cap actual max stack sizes, no actions on contents/info. Ship all18 real translated language keys in en/vi/zh and list each resource in report. Read relevant ADR0010,0018 and parent first. Do not change chance math; report its defects against #107 commit instead.

Every new test must be seen failing first against missing/wrong implementation. Use root :test with filters. Run exact task gate once after relevant changes and finish with a JSON object inside an agent-box-report fenced block; YAML is not parsed. Report exact results, decisions, disputes, and all shipped file rows. Avoid redundant broad passing suites without a new reason.

The sealed cache API is new LootChanceCache(TaskScheduler async), load(ConfigSnapshot), and chances(ConfigSnapshot,String lootId) returning Optional<Map<String,LootChance.EntryChance>>. Production must supply adapter.async(); callbacks/listeners for page refresh are yours to design. The holding scheduler is the actual scheduling seam; reads never enqueue work, and an older job finishing after a new job cannot replace the new generation.

Use the final #110 MenuRenderer API for captured snapshot messages, including paging labels/lore, and the MenuService update-order guarantee. Do not reintroduce live global language lookups into a render that otherwise captured one config snapshot, or build a second update-dispatch mechanism in this feature.

Cache race coverage must include a reload triggered DURING an already-running chance calculation, after that job's initial generation check, with the newer result published before the older calculation returns. Merely holding the whole old Runnable until after the new load can miss an implementation that checks generation only at job start and then publishes unconditionally. Add a deterministic test for the mid-calculation race (a package-private calculator function/wrapper may call the real LootChance.calculate and orchestrate the interleaving, while the sealed default-constructor tests still use real math). Keep the real default constructor/API and do not hold a global cache lock during expensive math or block config-load/player threads. Old job results must be discarded at publication as well as stale reads.

The explicit #112 requirement replaces #111's temporary back-only stub: update only obsolete stub/no-info expectations while retaining all existing list order, permissions, back-page, stale-open and paging behavior tests. This is normal phase progression, not permission to weaken the retained behavior checks.


# Phase 9 code review — 2026-10-23

Reviewed baseline `0341acd8f0988d6272e8c405839959f6d3328e8b` through `008664dc6b2a17d44ceeb8addcbb387e1ad095b4` (PR #115), including changed production code, adapters and shipped resources. Tests were read as evidence only. Complete issue bodies #106–#112, CONTEXT and applicable ADRs were checked. No tests, probes or numerical reproductions were rerun. Agent-box performed its standard compile-only setup. No product files changed.

DeepSeek v4.1 Flash High reviewed both axes sequentially in one session: `p9-full-code-rereview` and targeted completion `p9-full-code-rereview-complete`; both agent exits0, tests skipped, zero edits. Findings below retain reviewer IDs. This is a static review: runtime consequences were not reproduced.

## Standards

### #3 [P3] Wiki sessions remain after normal inventory closes

Location: `src/main/java/me/rakkoon69/rakunloots/wiki/WikiMenu.java:91` (insertions149–150; only removal673–675).

Opening the wiki adds a per-player Session. A normal InventoryCloseEvent calls MenuService.closed, which removes its own entry but does not notify WikiMenu. The only WikiMenu.sessions removal runs when LootChanceCache publishes. Once the initial cache has published, each unique player who opens and closes the wiki retains a Session, its State/rows and snapshot reference until a later reload/publication. Memory therefore grows with historical wiki users rather than active viewers.

This is a lifecycle correctness observation, not a hard breach of an explicit repository coding-style rule. Remove the session as its owned menu closes, preserving replacement/epoch guards.

## Spec

### #1 [P1] Folia disable leaves real menu stacks accessible

Location: `src/folia/java/me/rakkoon69/rakunloots/server/FoliaServerAdapter.java:188` (closeMenu579–590); integration `src/main/java/me/rakkoon69/rakunloots/RakunLootsPlugin.java:357`.

Trigger: disable the plugin through the plugin manager on Folia while a player remains online with a claim/wiki menu open.

The disable method unregisters all listeners before calling menus.closeAll. Folia closeMenu only marks the handle closed, then calls onEntity. Because plugin.isEnabled is false during disable, onEntity completes without invoking made.close(player). The physical inventory remains open without MenuListener cancelling clicks/drags. A player can take real summon-item or loot-preview stacks; claim rows bypass lowering the stored owed amount. This violates #106/#109 and phases.md203 requiring plugin stop to close every menu.

The existing Folia stop test asserts future completion and service retirement, but not physical inventory closure. Ensure physical closure occurs with correct region ownership during shutdown; merely swapping the two lines in onDisable does not address the disabled-scheduler guard.

## Triaged observations, excluded from actionable code findings

- #2: Missing claim_all reference loses the renderer diagnostic label, but still shows a barrier and emits the required high warning. #109 allows caller-provided name/lore and #110 specifies the normal claim-all text. Optional diagnostic consistency; no demonstrated contract violation.
- #4: Complete #108 explicitly specifies info as book with no sound; #109 specifies no action means no sound. Broad phase-doc wording differs, but no code change is required. Outside requested code-only scope.
- #5: The proposed stale-menu /claim-again case did not establish a convincing normal player path: entering a slash command normally closes the inventory UI. The contract says not to open a menu for nothing owed, and does not clearly mandate closing an unrelated pre-existing view. Not retained as a proven code defect.

Standards:1 low lifecycle finding; Spec:1 high shutdown/security finding. Hold merge for #1. No fixes implemented.

## Follow-up resolution
Productd53a589 fixes ordinary-close Wiki retention(ID3), and the ID6 overlapping-failed-open race found by the fix reviewer. ID1 is fixed for supported Folia shutdown, independently proven with a real close_window packet before disconnect; the exact same oldjar check failed. Arbitrary live disabled non-owner calls still cannot guarantee physical closure; this limitation is explicitly recorded in repository verification and PR115, so do not interpret the shutdown fix as a guarantee for unsupported cross-region hot-disable.
SameMaxworker/sameHighreviewer completed sequentially; finalHigh agent_exit0/findings[]. Root fullcheck8m15s1495root35existingconditional skips131Folia24Fancy17Java17/506packet tests0failerrors. Finaljar9032E7906D9509616D9824CF7E060483416A714B254E507A43EEFE042BB0558B; finalfreshFolia/Paper/Spigot58/0each,174total,0pluginWARNERROR; allstopped/portsclosed. Shippedresourcesnone. Handoff docs/rewrite/phase9-verification.md (follow-upsection); PR https://github.com/nudetiger/RakunLoots/pull/115. No merge/issueclosure performed.

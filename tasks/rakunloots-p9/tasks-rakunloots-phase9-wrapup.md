Phase9 implementation and verification are complete in #115 (`codex/phase9-menus`), ready for review. Issues remain open until that branch merges; the PR links all phase tickets, including the test-driver attribution fix #114.

- #107–#112 accepted after sequential DeepSeek Max implementation and completed DeepSeek High reviews. Gemini was used first; repeated failures triggered the approved fallback. The approved ADR cost correction retains 1e-9 accuracy and the original three-warm-up/50ms assertion.
- Final full project check passed:1480 root tests (35 existing conditional skips),126 Folia,24 Fancy,17 Java17 loader,506 tests across18 packet adapters,0 failures/errors.
- All six RakunProbe fresh/after-reload runs pass:58+59 on each of Paper26.2-129, Spigot26.2 and Folia26.2-7,351 checks,0 failures,0 RakunLoots WARN/ERROR. All test servers stopped afterward.
- #114 keeps exact Windows OSHI bootstrap diagnostics visible and separate from plugin failures, with4 passing parser tests, actual-log replay and a completed independent High recheck. No product/server/registry change was used to force a server pass.

[Verification report, artifact SHA, exact server builds and review handoffs](https://github.com/nudetiger/RakunLoots/blob/codex/phase9-menus/docs/rewrite/phase9-verification.md). The local-only RakunProbe helper commit is included as a reproducible patch beside the report. Existing unrelated workspace changes were preserved.

Agent-box gaps/recovery evidence are recorded at `C:/Workspace/Tools/agent-box/docs/rakunloots-phase9-2026-10-21.md`, with run statistics and orchestration state in that folder. The owner's client appearance/paging/sound check follows and is nonblocking under the specification.
The claim command now opens a menu for pending summon items; `claimsummon all` retains direct claiming. `/loots` provides timer ordering, read-only contents and cached inclusion chances. This includes menu-file fallbacks, atomic claims, stale-view guards, localized formatting and Paper/Spigot/Folia adapters.

**Remaining risk requiring reviewer judgment:** reviewer ID1 is resolved for supported Folia owner-thread shutdown, **not arbitrary live disable from a non-owner thread**. That live path can complete without physically closing the inventory after guard listeners are removed, leaving real menu stacks accessible. Do not treat the successful server-shutdown check as proof that this live-disable risk is fixed. The retained non-owner test explicitly expects the inventory to remain open.

## Start here: committed proof and reproduction

[Reviewer evidence guide](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/README.md) — finding-to-test map, before/after commits, exact commands, dependencies and remaining gaps. It links 31 hashed evidence files: raw host/RakunProbe outputs, regression JUnit XMLs, shutdown packet capture, runtime/probe scripts, numerical reference sources and reviewer output. [Manifest](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/manifest.json) preserves the copied bytes. Evidence is committed to the PR, not just stored on the author's computer.

- Tested product: `d53a589a2e36753ba2cbbe00862582e7923d858e`.
- `fe1d859` and this evidence commit change documentation only.
- Observed jar SHA-256: `9032E7906D9509616D9824CF7E060483416A714B254E507A43EEFE042BB0558B`. The binary is not uploaded; this identifies the tested artifact, not a guarantee of byte-identical rebuilds.

| Review ID | Status and behavior | Direct evidence |
| --- | --- | --- |
| 1 / #109 | **Partial: supported shutdown fixed; live non-owner gap above remains.** Public Folia ownership permits synchronous physical close after plugin disable on the shutdown owner; enabled close remains entity-scheduled. | [Failing physical-close proof](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/red-folia-ownership.txt); [passing proof XML](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/junit/TEST-me.rakkoon69.rakunloots.server.Phase9FoliaShutdownOwnershipProofTest.xml); [real final-jar client packet capture](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/shutdown-final-jar.jsonl). |
| 3 / #112 | **Fixed:** exact-epoch retirement removes wiki sessions on terminal close/reload/supersession; navigation transfers the same session and late/stale callbacks cannot remove newer ones. | [Failing ordinary-close proof](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/red-wiki-close.txt); [passing proof XML](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/junit/TEST-me.rakkoon69.rakunloots.wiki.Phase9WikiSessionCloseProofTest.xml); lifecycle/navigation cases linked in guide. |
| 6 / #112 | **Fixed:** after overlapping opens, retain the old close state and retire once only when the newest pending replacement resolves; preserve newer pending/successful sessions. | [Failing overlap proof](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/red-superseded-open.txt); [passing proof XML](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/junit/TEST-me.rakkoon69.rakunloots.menu.Phase9SupersededRetirementProofTest.xml); [three adjacent race cases](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/junit/TEST-me.rakkoon69.rakunloots.menu.Phase9SupersededRetirementRaceTest.xml). |

Proofs are unchanged across their fix commits. The guide shows how to reproduce RED at `429acbc` (IDs 1/3) and `6cc62e4` (ID6), then GREEN at the final source. The [old-jar shutdown record](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/shutdown-old-jar.json) is a consolidated observation, explicitly distinguished from the final raw JSONL: old jar received no close packet; final jar received `close_window {windowId:1}` before `Server closed`/disconnect. The bot did not issue a client-close action.

## Recorded verification

[Full host output](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/host-check.txt): **BUILD SUCCESSFUL in 8m 15s**, 135 tasks. [Suite counts](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/host-counts.json): root 1495 (**35 skipped**), Folia 131, Fancy 24, Java 17 loader 17, all 18 packet adapters 506; zero failures/errors. The guide includes the exact formerly external Java 25 Folia test-runtime script and full/focused rerun commands; production bytecode and the dedicated Java 17 task retain their floor.

| Final-jar RakunProbe run | Output | Result |
| --- | --- | --- |
| Folia 26.2-7 / `14b7fee` | [full output](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/probe-folia.txt) | 58 passed, 0 failed |
| Paper 26.2-129 / `9240f58` | [full output](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/probe-paper.txt) | 58 passed, 0 failed |
| Spigot 26.2 / `4648-Spigot-8db49a2-96ae8cd` | [full output](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/probe-spigot.txt) | 58 passed, 0 failed |

**174 passed, zero failed**, plus the separate shutdown packet check. [Audit](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/server-audit.json) records footers, no plugin WARN/ERROR and matching installed hashes. These are fresh-mode runs, each including reload and restart persistence; no separate final-jar after-reload pass is claimed. The previous 351 checks belong to the previous jar and remain historical. All test servers stopped afterward.

## Coverage limits and known tooling gaps

- **MySQL:** 34 real-MySQL tests skipped without a configured server. The other root skip is the loader-property test exercised by `java17Test`. Counts do not imply 1495 executed root passes.
- **Clients/versions:** human appearance, large-list paging and sound checks remain pending under #113. All 18 adapter suites pass, but live final-jar coverage is limited to the three server builds above.
- **Folia:** GuardianBeam laser remains unavailable under the existing policy (`LASER_UNAVAILABLE` INFO diagnostic). The live non-owner disable risk at the top is unresolved.
- **External errors:** logs retain the exact Windows OSHI bootstrap ERROR traces. Zero WARN/ERROR means RakunLoots, not the entire server. The #114 classifier/patch retains full traces and does not authorize ignoring plugin or unknown errors.
- **Fixture/tooling:** RakunProbe is a local-only sibling project; the [exported helper patch](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/phase9-rakunprobe.patch) requires its matching base and configured servers/bot dependencies. Its known startup fail-fast gap can inspect an empty log after startup fails; require readiness/plugin enable and a complete zero-failure footer, not process exit status alone. The evidence guide records the fixture commit/base and setup differences.
- **Failed attempts:** native JVM allocation failures affected an initial host build and attempted Folia startup; neither counts as accepted evidence. One build worker and sequential servers passed with unchanged server heaps.
- **Review scope:** same DeepSeek Max implementation and High fix rechecks ran sequentially. [Final reviewer prose](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/reviewer-final.txt) and [status](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/evidence/phase9-review-fixes/reviewer-status.json) show a completed ID6-delta recheck with no findings, not a second independent full-phase review. The guide explains inherited scope/parser flags and distinguishes manually invoked reviewer checks from the independent full host gate. Recorded host/AI outputs are not CI attestations or substitutes for source review.

The owner-approved [ADR cost correction and numerical evidence](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/phase9-verification.md#math-decision-and-independent-accuracy-checks-107) preserve stable calculation, 1e-9 accuracy and the original 50 ms fixture. The guide now publishes the independent Decimal70/100 reference and labels its historical comparison outputs. The 50 ms bound covers the specified 100-entry fixture, not arbitrary input sizes.

[Full verification and issue handoffs](https://github.com/nudetiger/RakunLoots/blob/74b431f4e41a677cc6044310a92a48f03af53a53/docs/rewrite/phase9-verification.md). No shipped resources changed in the review-fix/evidence pass. The two existing local dependency-cleanup and phase-specification commits remain included. Evidence publication reran no product tests and changed no product code; PR remains open, with issues closing only on merge.

Closes #106
Closes #107
Closes #108
Closes #109
Closes #110
Closes #111
Closes #112
Closes #113
Closes #114

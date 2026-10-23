Accepted candidate `669ebbe` (`codex/phase9-107-accepted`), integrated as `48d071a` plus comment/test follow-up `79c50b0` on `codex/phase9-menus`. All original and fix diffs/reports read. Same DeepSeek High reviewer final recheck: zero findings, 205s. Phase-wide real-server #113 is still running; this issue is not closed before integration lands.

| Finding | Fix / retained evidence | Verification |
|---|---|---|
| `1.both.1` | Owner explicitly approved correcting ADR 0018/phase/GitHub cost claim, preserving stable forward/backward direction, 1e-9 accuracy and 50 ms requirement. Actual worst cost is O(n²+g*n) per grid point, grid-dependent total. | Owner ruling already linked above; class comment matches corrected contract. |
| `1.both.2` | Long count-range cardinality and O(n) folding of capped raw tail; no iteration to Integer.MAX_VALUE. | `RawRollExtremeChanceTest.rawIntegerMaxFoldsTheCappedTailWithoutIteratingToMax` and reviewer standalone timeout proof pass. |
| `1.both.3` | Raw distinct-weight max>n brute-force oracle includes always/hidden entries and original uniform count interval. | Both raw oracle tests pass; sealed original acceptance unchanged. |
| `root.group_underflow` | Stable binomial construction preserves late grouped probability mass. | Retained 99×weight100 +1×weight1, k99 oracle expects 0.050379102187102065; green. |
| `root.500_accuracy` | Adaptive shared quadrature; retained independent 100-digit positive-transition marginal values and conservation. | Host every-entry reference max error 5.92859095150e-14; old candidate failed 9.17e-8. |
| `root.10000_first_draw` | Exact first-draw lower integral plus count-dependent lower-tail bound; no fixed grid cap. | Host every-entry exact weight-share max error 1.74027480713e-10; old candidate failed 1.91712656462e-9. |
| Final reviewer `1` (rejected numerical premise; real wording correction) | Comments now describe unconditional self-ring upper marginal for k>=2, with pair/integral overcount proof. Exact 10,000-entry two-draw regression added. No algorithm/tolerance/warm-up change in last commit. | Decimal90 actual overcount2.38994e-12 <= bound9.58254e-12; independent Kimi proof agrees. Same reviewer explicitly withdrew the omitted-one-other claim and verified 3/3 raw tests. |

Other changes: pure `LootChance`/`TimerChance` APIs; half-up `{chance:N}` formatting at 0..6 with nonzero/noncertain display guards; malformed precision scanner/warnings including empty precision. Equal-weight, exact-edge, ratio-million, raw range, scanner and formatting coverage retained. No simulation or normalization-to-total.

Host focused math gate before final comment/test addition: BUILD SUCCESSFUL 2m13s,543 tests/0 failures/errors/skips. Final worker gate:544/0/0/0,51s. Final integrated unfiltered host root:1480 tests/0 failures/errors,35 existing skips (34 MySQL without a server and one Fancy loader conditional exercised separately by java17Test), BUILD SUCCESSFUL1m16s. Original three warm-ups and strict50ms test unchanged and passing. Full integrated check before comment-only follow-up passed all18 packet adapters,126 Folia,24 Fancy and17 Java17 loader tests; final server jar is built from `79c50b0`.

| Shipped resource | Change | Why |
|---|---|---|
| `src/main/resources/warnings.yml` | `UNUSABLE_DECIMALS: high` | Precision values outside0..6 or malformed syntax use1 decimal and warn at the required level. |

Agent-box reboot recovery, stale parked-slot hint, lost interrupted review, report parsing, scope attribution and review-schema gaps are documented under `C:/Workspace/Tools/agent-box/docs`. No missing/interrupted review was counted as approval.
Spec: #106

## Parent

#106

## What to build

The exact chance that each content entry of a loot lands in one loot box, the timer chance of each loot in a world, and a `{chance:N}` placeholder that shows either one with the decimals the owner picks. This ticket adds no menu and no consumer. It delivers two pure functions, the formatter, and the load-time check of N.

Read ADR 0018's "Loot chance" section and the spec's "Loot chance" and "`{chance:N}` formatting" sections first. They are the contract.

## Deliver

- A pure loot chance function beside `LootRoller`, in the `roll` package. Input: a `Roll`. Output, per content entry id: always (weight below zero), hidden (weight zero), or an exact chance in [0, 1]. It takes no server, no Bukkit type, and no randomness, and writes no log.
- The method of ADR 0018: exponential clocks; one full count distribution per time point; equal weights grouped as binomial steps; entry removal forward when `p_i ≤ 1/2` and backward otherwise for numerical stability; the corresponding count tail summed; and every `k` in [min, max] averaged from the same distribution. For `n` drawable entries and `g` distinct weights, full grouped convolution and removals cost at most `O(n^2 + g*n)` per quadrature point. The owner ruling on 2026-10-22 corrects the original smaller-side/O(k) cost claim; it does not relax accuracy or the under-50-ms acceptance test.
- The count rule exactly as `LootRoller.drawCount` does it: min and max clamped at 0, a reversed pair (min ≥ max) uses max, and `k` capped at `n`, the entries with weight above zero.
- Exact edges returned with no integration: `min(k) ≥ n` gives exactly 1.0 for every drawable entry. `max(k) = 0` gives exactly 0.0.
- A quadrature with absolute error below 1e-9 for weight ratios up to 10^6. The class comment states the grid and substitution and why the error bound holds.
- A pure timer chance function. Input: one world's `loots` map from `WorldSettings` and the set of loaded loot ids. Output: each loaded loot with weight above zero, mapped to its weight over the total of those loots. Others are absent. It must match `WorldTimers.pickLoot`'s eligibility rule.
- `MessageText` percent placeholders. A caller passes named values in [0, 1] beside the string values. `{name}` shows 1 decimal, and `{name:N}` shows N decimals for N from 0 to 6. Rounding is half up in `Locale.ROOT`. A value above 0 that rounds to 0 shows `<` plus the smallest step (`<1`, `<0.1`, `<0.01`, …). A value below 1 that rounds to 100 shows the largest step below (`99`, `99.9`, `99.99`, …). Exactly 0 shows `0` and exactly 1 shows `100`, both at N decimals. Plain string placeholders behave exactly as today.
- At config load, scan every language string and every loot message override for `{word:N}` with N outside 0 to 6, or not a number. Warn high once per string with a new `ConfigWarning.Kind`. Register it in `WarningKinds` and list it in the shipped `warnings.yml`. Rendering such a placeholder uses 1 decimal.

## Do not

- Do not change `LootRoller` or how a roll works.
- Do not simulate or sample. No `Random` anywhere in this code.
- Do not wire the chance into enable, reload, a cache, or a menu. Ticket "Loot page" does that.
- Do not add language keys. No shipped text uses `{chance}` yet.

## Acceptance criteria

- [ ] A brute-force test helper enumerates every draw order with its exact probability, for loots of up to 7 drawable entries. Across a set of rolls that mixes weights (including ratios of 1000), min/max ranges (including min 0, min = max, a reversed pair, and max above n), and always-included and weight-zero entries, the loot chance matches it within 1e-9.
- [ ] Equal weights: n entries of weight 1 with fixed k gives each entry exactly k/n within 1e-12.
- [ ] One drawable entry with min 0 and max 1 gives 0.5. With min 1 it gives exactly 1.0.
- [ ] `min ≥ n` returns exactly 1.0 (assert `==`, not a tolerance). `max = 0` returns exactly 0.0.
- [ ] A weight below zero returns always, and weight zero returns hidden, whatever the count.
- [ ] A loot of 100 entries with 100 distinct weights and max 50 finishes in under 50 ms on the test machine. The test states the measured number in a comment.
- [ ] Timer chance: `airdrops: 100, treasure_chest: 30, buried_stash: 30, head_trophy: 20, deep_vault: 10` with all loaded gives airdrops 100/190. A loot missing from the loaded set, or with weight 0 or −5, is absent and left out of the total.
- [ ] Formatter tests cover N 0, 1, 2, and 6. They cover 0, 1, 0.00004 (`<0.1` at N 1), 0.99996 (`99.9` at N 1, never `100.0`), half-up rounding at 0.125 with N 2, and a string with both `{chance}` and `{chance:2}`.
- [ ] A config load with a language line holding `{chance:9}`, and one holding `{chance:x}`, warns high once per string with the new kind. The kind is in `WarningKinds` and in the shipped `warnings.yml`, and `ShippedWarningsFileTest` passes.
- [ ] Every new test was seen failing against a wrong implementation first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- None (can start immediately)


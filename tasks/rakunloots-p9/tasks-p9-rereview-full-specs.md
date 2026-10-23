## Issue #106: Phase 9: Menus

## Problem Statement

A player who is owed summon items can only take them blind, with the claim command. It gives everything that fits at once. The player cannot see what is waiting or pick one loot.

A player has no way to learn what a loot holds. They cannot see what a box can contain, how likely each item is, how long a box lives, or where loots appear. An owner who wants players to know has to write it up somewhere else, and the numbers go stale on every edit.

## Solution

Two menus, drawn by the plugin's own menu module.

- **Claim menu.** The claim command opens it. It lists the player's unclaimed summon items by loot. A click takes one loot's items, and a claim all button takes everything. `claim all` keeps the old give-everything behaviour as a command.
- **Loots wiki.** Its own command opens it, and everyone may use it by default. A list page shows every loot, rarest first by the timer chance in the player's world. A loot page shows its contents with the exact chance each lands in a box, plus an info item with its open mode, lock, life, item count, and the worlds whose timer summons it.

Each menu has its own file in `menus/`. Text stays in the language files. The loot chance is exact, worked out from the roll rules, not simulated.

Read first: `CONTEXT.md`, ADR 0018 (the decisions behind this spec), ADR 0013 (unclaimed summon items), ADR 0014, ADR 0003 (config, languages, placeholders), ADR 0002 and ADR 0010 (server adapter seam, Folia scheduling), and Phase 9 in `docs/rewrite/phases.md`. Read `docs/cursor_mistakes/RULES.md` before any ticket.

## User Stories

1. As a player, I want the claim command to open a menu of what I am owed, so that I can see it before I take it.
2. As a player, I want each loot I am owed shown as its summon item, so that I recognise it.
3. As a player, I want the full amount I am owed shown on each row, so that I know how many wait even past 64.
4. As a player, I want a click on a row to take that loot's items, as many as fit, so that I choose what to take.
5. As a player, I want a claim all button, so that I take everything that fits in one click.
6. As a player, I want the menu to update after a claim, so that I see what is left.
7. As a player, I want the menu to close when nothing is left, so that I am not left in an empty menu.
8. As a player, I want the same chat messages as the claim command, so that I know what was given and what stays.
9. As a player, I want fast clicks ignored while my claim runs, so that I never claim twice by accident and items are never duplicated.
10. As a player owed items of a loot that no longer exists, I want a row that says they are kept, so that I know they are not lost.
11. As a player owed nothing, I want the "nothing waiting" message and no menu, so that I am not shown an empty menu.
12. As a player, I want `claim all` as a command, so that I can still claim everything without the menu.
13. As a player, I want to open the loots wiki with a short command, so that I can learn the loots.
14. As a player, I want every loot the server has in the wiki list, so that I know what exists.
15. As a player, I want the rarest loots in my world listed first, so that I see what is special here.
16. As a player, I want each loot's timer chance in my world on its icon, so that I know how often it appears here.
17. As a player, I want a loot page with every item the box can hold, so that I know what to hope for.
18. As a player, I want each item's exact chance to land in one box, so that I can trust the numbers.
19. As a player, I want items that are always included marked "always", so that I know they are certain.
20. As a player, I want the rarest items first on a loot page, so that the special ones stand out.
21. As a player, I want each item's amount shown, so that I know how much I get.
22. As a player, I want an info item with the loot's open mode, lock, life, and item count, so that I know how the box behaves.
23. As a player, I want to see which worlds summon a loot and how often, so that I know where to look.
24. As a player, I want a back button on a loot page, so that I can return to the list.
25. As a player, I want previous and next buttons when there are more entries than fit, so that I can see all of them.
26. As a player, I want nothing I click in a menu to move items, so that I cannot take icons out of a menu.
27. As a player, I want a sound on each button click, so that I know the click registered.
28. As a server owner, I want each menu in its own file in `menus/`, so that I can change one menu without touching the others.
29. As a server owner, I want to set rows, content slots, filler, and button items, slots, and sounds, so that the menus fit my server's style.
30. As a server owner, I want menu text in the language files, so that it follows my active language like every other message.
31. As a server owner, I want a menu file I broke to fall back to the shipped layout with a severe warning, so that players never lose the claim menu to my typo.
32. As a server owner, I want an unknown key or an unknown sound to warn high, so that I find my mistake.
33. As a server owner, I want to hide a loot from the wiki with `wiki: false`, so that secret loots stay secret.
34. As a server owner, I want to give a loot a wiki icon other than its block, so that it looks right in the list.
35. As a server owner, I want to choose how many decimals a chance shows with `{chance:N}`, so that the numbers read the way I like.
36. As a server owner, I want a tiny chance never to show as 0 and an uncertain one never as 100, so that the wiki never lies.
37. As a server owner, I want the wiki command's name, aliases, and default permission in `config.yml`, as the claim command has, so that it fits my server.
38. As a server owner, I want chances worked out after each load without lag, so that a reload stays smooth.
39. As a server owner, I want every open menu closed on reload, so that nobody clicks a menu built from the old config.
40. As a server owner on Folia, I want the menus to work there too, so that I can use them on any server I run.

## Implementation Decisions

Names below are the current names in the tree, given so workers find the code. A ticket may add classes. It must not rename existing ones.

### Loot chance (pure, no server)

- A new pure module beside `LootRoller` takes a `Roll` and returns, for each content entry, one of: always (weight below zero), hidden (weight zero), or an exact chance in [0, 1].
- It must follow `LootRoller` exactly. The count `k` is uniform in [min, max] (both clamped at 0, and a reversed pair uses max), capped at `n`, the number of entries with weight above zero. Draws are weighted, with no repeats.
- Method, from ADR 0018. Entry `j` rings at an exponential time with rate `w_j`. `P(i in the first k) = ∫₀^∞ w_i e^(-w_i t) · P(fewer than k others rang by t) dt`. Build the full count distribution once at each quadrature point, grouping equal weights as binomial steps. Remove one entry per distinct weight in the numerically stable direction: forward when `p_i ≤ 1/2`, backward otherwise. Sum the count tail built in that direction and average all counts from the same distribution. Stability can require more coefficients than the smaller algebraic tail.
- Integrate with a quadrature that keeps the absolute error below 1e-9 for weight ratios up to 10^6 between entries. Pick the grid, for example by mapping `t` with a log substitution, and state the choice in the class comment.
- Exact edges with no integration: if `min(k) ≥ n`, every drawable entry is exactly 1.0. If `max(k) = 0`, every drawable entry is exactly 0.0. With `n = 1`, the chance is the share of counts in [min, max] that are at least 1.
- Timer chance is a second pure function. It takes a world's `loots` map from `WorldSettings` and the set of loaded loot ids, and returns each loot's weight over the total of the loaded loots with weight above zero, as `WorldTimers.pickLoot` picks. A loot that is not loaded, or has weight zero or less, has no timer chance in that world.

### `{chance:N}` formatting

- `MessageText` gains percent placeholders. A caller passes named values in [0, 1] beside the usual string values. In the text, `{name}` shows 1 decimal and `{name:N}` shows N decimals, from 0 to 6. The value shows as a percent number. The `%` sign is part of the language text, not the placeholder.
- Rounding is half up, `Locale.ROOT`, with a dot for the decimal mark.
- A value above 0 that rounds to 0 shows `<` and the smallest step: `<1` for N 0, `<0.1` for N 1, `<0.01` for N 2.
- A value below 1 that rounds to 100 shows the largest step below 100: `99`, `99.9`, `99.99`.
- Exactly 0 shows `0` at N decimals, and exactly 1 shows `100` at N decimals.
- An N outside 0 to 6 is found at config load, by scanning every language string and loot message override for `{word:N}`. It warns high once per string, with a new config warning kind, and renders with 1 decimal.

### Menu files (config module)

- `ConfigFolder` reads every `.yml` file of `menus/` into `ConfigSources`, keyed by the file name, as it reads `loots/`. `DEFAULT_RESOURCES` gains `menus/claim.yml` and `menus/wiki.yml`. Each is added by the ticket that ships it.
- `ConfigSnapshot` gains the parsed menu layouts. A menu id the plugin does not know warns high and is ignored.
- One page layout (a "menu page") is:
  - `rows`: 1 to 6.
  - `content_slots`: a list of slot numbers or `"a-b"` ranges, each slot inside `0` to `rows×9−1`.
  - `filler`: an item reference.
  - `buttons`: a map of button name to `{ slot, item, sound }`.
  - Item references use the loot file's `item` shape, parsed by the existing item reference parser, with source, id, and vanilla additions. The language text replaces the item's name and lore. The other vanilla additions still apply, such as custom model data.
  - `sound` is `{ key, volume, pitch }`. `key` is a namespaced sound key. `volume` defaults to 1.0 and must be 0 or more. `pitch` defaults to 1.0 and must be within 0.5 to 2.0. A bad volume or pitch warns high and uses 1.0.
- `claim.yml` is one page with buttons `previous_page`, `next_page`, `claim_all`. `wiki.yml` has two pages, `list` with buttons `previous_page`, `next_page`, and `loot` with buttons `previous_page`, `next_page`, `back`, `info`. `info` is the loot page's info item. It has a slot and an item and no click action. A button name a page does not have warns high and is ignored. A button left out is not shown.
- A slot outside the page warns high and drops that slot or button. A button on a content slot warns high and takes the slot out of the content. Two buttons on one slot warn high and the later one is dropped.
- Fallback: a file whose YAML cannot be read, whose root is not a map, or whose page ends with no content slot, uses that menu's shipped layout. The shipped layout is read from the jar resource, so the jar must hold the shipped file. This warns severe, with a new config warning kind. An unknown key anywhere in a menu file warns high and is ignored, as in loot files.
- A sound key is checked at load through `NameCatalog`, which gains a sound check. `BukkitNameCatalog` checks the server's sound registry. It must work on the 1.18 API floor and on 26.2, so check which registry call exists on 1.18.2. An unknown sound warns high, and that button plays nothing.
- Every new warning kind goes into the right enum, is registered by `WarningKinds`, and is listed in the shipped `warnings.yml`. Existing tests check that every kind is listed.

### Menu engine (plugin types plus a thin Bukkit side)

- A menu view in plugin types holds a title, rows, and a map of slot to icon. An icon is an `ItemStack`, an optional click action, and an optional sound. ADR 0002 lets item code take Bukkit item types. The view knows nothing of inventories, events, or threads.
- A menu service tracks one open menu per player. It opens, refreshes in place, and closes through the server adapter, and dispatches clicks to the open menu's actions. Paging is a shared helper: entries are cut into pages by the page's content slots. `previous_page` and `next_page` show only when there is a page to go to, and the filler takes their slot otherwise. Every slot that is neither content nor a shown button holds the filler. Content slots past the last entry stay empty.
- `ServerAdapter` gains menu calls: open a menu inventory for a player with a title, a size, and contents; replace a menu inventory's contents in place; close it; and play a sound to a player by key, volume, and pitch. Paper and Spigot run these on the main thread. Folia runs them on the player's entity scheduler, as `openSharedInventory` does. The sound plays through the `Player#playSound` overload that takes a `String` sound, so no enum lookup happens at play time. `FakeServerAdapter` records each call.
- The menu inventory's holder is a new holder type. It must not be `SharedInventory`, because `LootBoxInteractionListener` treats every `SharedInventory` close as a loot box close.
- One listener cancels every `InventoryClickEvent` whose top inventory is a menu, whatever slot or click type: shift clicks from the player inventory, number keys, double-click collect, and drops. It also cancels every `InventoryDragEvent` whose top inventory is a menu. A click on a top inventory slot goes to the menu service with the slot. A close of a menu inventory tells the service the menu is gone. The listener is registered at enable.
- A reload closes every open menu after the new config is in place. A plugin stop closes every open menu.

### Claim menu

- `UnclaimedSummonItems` gains a read of what a player is owed, and a claim of one loot for a player. The single-loot claim has the same rules, order of storage writes, and messages as `claim`: lower the stored amount, then give, and write back what did not fit. The existing `claim` stays and backs `claim all`.
- The claim command runs for players only, as today. With no argument, a player owed nothing gets `claim_nothing` and no menu. Otherwise it opens the claim menu. A child node `all` runs today's claim of everything. It has the same permission `rakunloots.claim`, not a `rakunloots.command.*` one.
- A row is the loot's summon item, built by the summon item factory. Its stack amount is the owed amount capped at 64, and its name and lore come from language keys with `{loot}` and `{amount}`. A row whose loot is missing is a `barrier` with its own language keys and no click action. Rows follow the order storage returns, which is loot id order.
- A click on a row claims that loot. The claim all button claims everything. While a claim for that player runs, every claim click from that player is ignored. When it completes, the menu re-reads what is owed and refreshes in place, or closes if nothing is left.

### Loots wiki

- `config.yml` gains `wiki_command` with `name` (default `loots`), `aliases` (default `rklloots`), and `permission_default` (default `true`), parsed and applied exactly as `claim_command` is, including the reload of the default. `plugin.yml` gains `rakunloots.wiki`, default true. The wiki command registers through `BukkitCommandRegistrar` beside the claim command. It is player only.
- The loot file gains a `wiki` key. It is either a boolean, where `false` hides the loot, or a map with `show` (boolean, default true) and `icon` (an item reference). An unknown sub-key or a wrong type warns high and is ignored, and the loot stays shown with its block icon. Add `wiki` to the loot root's known keys.
- List icon: the `wiki.icon` item when set. Otherwise the loot's presentation block through `ServerAdapter#blockItem(block, headData)`. A block with no item form, or an icon that misses, shows a `barrier`.
- List order: timer chance in the viewer's current world, low to high. Loots that world's timer cannot summon go last. Ties go by loot id. The viewer's world is read once when the menu opens, from the sender's location world key matched to `ServerAdapter#loadedWorlds()`.
- Loot page: contents through the paging helper. Each entry is its item, resolved through `ItemSourceRegistry` and set to the entry's amount capped at the item's max stack size. Language lines for chance and amount are added after the item's own lore. A miss shows a `barrier` named after the item reference. Weight-zero entries are hidden. Order is chance low to high, with always-included entries last, and ties keep the roll's entry order.
- Info item lines, each its own language key, where a blank value drops the line: the description lines, the open mode, the lock (or no lock), the life (or unending), the min to max item count, then one line per world with a timer chance for this loot (or a no-worlds line). Lock and life read `m:ss`, or `h:mm:ss` from an hour, as the hologram shows time.
- Chances for every loot are computed after each load, on the async scheduler. Enable and reload both trigger it. The result is kept with the snapshot it came from, so a page never mixes two configs. A loot page opened before its chances are ready shows a "calculating" lore line in place of each chance, and refreshes when they arrive if it is still open.

### Language keys

Every new key ships in `en.yml`, `vi.yml`, and `zh.yml`, with real translations. Every value that holds a placeholder is quoted. Each ticket lists its keys. Names start with `menu_`.

## Testing Decisions

- A good test drives behaviour through a seam a player or owner touches: a config load from `ConfigSources`, a command dispatched through `FakeCommandSender`, a menu click through the menu service with `FakeServerAdapter`, or a pure call for the chance math. It checks warnings, messages, adapter calls, and icons, never private fields.
- Seams: the config load (existing), command dispatch (existing), the menu service with the fake adapter (new, the one new seam), and the chance functions (new, pure).
- Prior art: `config/Config*Test` for loads and warnings, `command/CommandDispatchTest` and `FakeCommandSender` for commands, `claim/UnclaimedSummonItemsTest` for claims with `FakeServerAdapter`, `PluginListenerWiringTest` and MockBukkit 1.18 for the listener and real Bukkit events, and the `Shipped*Test` classes for shipped files.
- Chance math is checked against a brute force over every draw order for small loots (n ≤ 7), to 1e-9, plus the exact edges.
- Per `docs/cursor_mistakes/RULES.md`: write each test from its acceptance line and see it fail against wrong code first. One test per feature loads the shipped file. A fake rejects what the real dependency rejects.
- Real server: `rltest` on Paper 26.2, Spigot 26.2, and Folia 26.2 still passes with both menu files shipped.

## Out of Scope

- Admin menus of any kind.
- Any action in the wiki beyond opening a loot page and going back. No give, summon, or teleport from a menu.
- Menu text in menu files. Text stays in language files.
- A wiki order key, or any sort but the ones above.
- Simulated chances, a "calculate on first open" mode, or a chance cache on disk.
- PlaceholderAPI, per-player languages, and client-side (packet) menus.
- Changing how a roll works. `LootRoller` is read, not changed.
- A close button. Escape closes a menu.
- Migration of any old file. Nothing shipped before, per ADR 0003.

## Further Notes

Expected cost of the chosen stable calculation: for `n` drawable entries and `g` distinct weights, full grouped convolution and removals cost at most `O(n^2 + g*n)` per quadrature point. Total work also depends on the grid needed to satisfy the existing accuracy requirement. The original smaller-side and fixed worst-case step estimates are withdrawn by the owner ruling on 2026-10-22; the absolute-error requirement and the under-50-ms performance acceptance test are unchanged. Every loot is still computed after each load on the async scheduler.

Tickets, in order: loot chance and `{chance:N}`, menu files, menu engine, claim menu, loots wiki list, loot page, real-server check.



## Issue #107: Loot chance and {chance:N}

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



## Issue #108: Menu files

Spec: #106

## Parent

#106

## What to build

The config module reads menu files from `menus/` into parsed menu layouts on the config snapshot, with the warnings and the shipped-layout fallback an owner relies on. No menu opens yet. This ticket is config only.

Read the spec's "Menu files (config module)" section first. It is the contract.

## Deliver

- `ConfigFolder` reads every `.yml` of `menus/` into `ConfigSources`, keyed by the file name without `.yml`, as it reads `loots/`. `ConfigSources` gains the menus map and its builder method.
- A parsed menu-page layout type in plugin types, with `rows`, the content slots (an ordered set, ranges expanded), the filler item reference, and buttons (name → slot, item reference, optional sound `{key, volume, pitch}`).
- `ConfigSnapshot` exposes the claim layout (one page) and the wiki layout (pages `list` and `loot`). Every page has a shipped default.
- The validation rules of the spec, each with its warning:
  - `rows` outside 1 to 6 warns high and uses the shipped value.
  - A slot outside the page warns high and is dropped.
  - A button on a content slot warns high, and the slot leaves the content.
  - Two buttons on one slot warn high, and the later one is dropped.
  - An unknown button name for that page warns high.
  - An unknown key anywhere warns high.
  - An unknown menu file id warns high and is ignored.
  - A bad `volume` or `pitch` warns high and uses 1.0.
  - An unknown sound key warns high, and the button keeps no sound.
- Known buttons: claim page `previous_page`, `next_page`, `claim_all`. Wiki `list` page `previous_page`, `next_page`. Wiki `loot` page `previous_page`, `next_page`, `back`, `info`.
- Fallback: when a menu file's YAML cannot be read, its root is not a map, or a page ends with no content slot, that whole menu uses the shipped layout read from the jar resource, with one severe warning of a new kind. A missing file uses the shipped layout with no warning, because the plugin writes missing default files at enable.
- `NameCatalog` gains a sound check with a default that the test catalogs can override. `BukkitNameCatalog` checks the server's sound registry. Confirm the call exists on paper-api 1.18.2, the compile floor, and works on 26.2. Say which call you used in the handoff.
- New `ConfigWarning.Kind` constants for each warning above, registered in `WarningKinds` with their severities and listed in the shipped `warnings.yml`.
- Ship `menus/claim.yml` and `menus/wiki.yml` as jar resources and in `ConfigFolder.DEFAULT_RESOURCES`. Each has comments that explain every key. Ship them with these layouts:
  - **claim:** 6 rows, content `0-44`, filler `gray_stained_glass_pane`. `previous_page` at 45 (`arrow`), `claim_all` at 49 (`chest_minecart`), `next_page` at 53 (`arrow`). Each button has sound `minecraft:ui.button.click`.
  - **wiki list:** 6 rows, content `0-44`, the same filler, `previous_page` 45 and `next_page` 53.
  - **wiki loot:** 6 rows, content `0-44`, the same filler. `previous_page` 45, `back` 48 (`oak_door`), `info` 49 (`book`, no sound), `next_page` 53.

## Do not

- Do not open, render, or click anything. Ticket "Menu engine" does that.
- Do not add language keys. Titles and button text come in later tickets.
- Do not change how loot files, `config.yml`, or other files parse.
- Do not put any text, name, or lore in the menu files.

## Acceptance criteria

- [ ] A config load of the shipped `menus/` files gives the layouts above, with no warning. `ShippedConfigQuietTest` stays green with the menu files included.
- [ ] One load test per validation rule above checks the warning kind, its severity, and the resulting layout.
- [ ] Unreadable YAML, a root that is a list, and a page whose every content slot was dropped each give the shipped layout and exactly one severe warning.
- [ ] `content_slots: ["0-8", 10, "12-13"]` expands to 0..8, 10, 12, 13 in order.
- [ ] An item reference with vanilla additions parses through the existing item reference parser, with the same warnings as in a loot file.
- [ ] Every new kind is in `WarningKinds` and in the shipped `warnings.yml`, and the existing shipped-file tests pass.
- [ ] `ConfigFolderTest` covers reading `menus/` from a temp folder.
- [ ] Every new test was seen failing first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- None (can start immediately)


## Issue #109: Menu engine

Spec: #106

## Parent

#106

## What to build

The menu engine. A menu built as a view in plugin types opens for a player as an inventory, on Paper, Spigot, and Folia. Nothing a player does in it moves an item. Clicks reach the menu's actions, button sounds play, pages turn, and every open menu closes on reload and on stop.

There is no real menu yet. Tests use a sample menu built in the test. Read the spec's "Menu engine" section first. It is the contract.

## Deliver

- **View types in plugin types.** A menu view has a title, rows, and slot → icon. An icon is an `ItemStack`, an optional click action, and an optional sound `{key, volume, pitch}`. The view has no inventory, event, or thread.
- **A paging helper.** Input: a page layout from ticket "Menu files", the entry icons, and a page number. Output: the slot map. Rules:
  - Entries fill the content slots in order.
  - `previous_page` and `next_page` show only when there is a page to go to. Otherwise the filler takes their slot.
  - Other buttons always show.
  - Every slot that is neither content nor a shown button holds the filler.
  - Content slots past the last entry stay empty.
  - A page number out of range clamps to the last page.
- **Resolving layout items.** Button and filler item references resolve through `ItemSourceRegistry`. The engine sets the name and lore from text the caller provides. A miss shows a `barrier`, with one high warning per menu entry per reload, of a new kind registered in `WarningKinds` and listed in the shipped `warnings.yml`.
- **A menu service.** It keeps one open menu per player. It can open a view, refresh an open menu in place, close one menu, close all menus, and receive a click (player, slot) or a close (player). A click runs the icon's action and plays its sound. A click on a slot with no action does nothing and plays nothing. Opening a menu for a player who has one open replaces it.
- **`ServerAdapter` gains:**
  - open a menu inventory for a player (title, size, contents) → future of a handle;
  - set a handle's contents in place;
  - close a handle;
  - play a sound to a player by key, volume, and pitch.

  Paper and Spigot run them on the main thread through the existing main-thread helper. Folia runs them on the player's entity scheduler, as `FoliaServerAdapter` does for `openSharedInventory`. An offline player makes each call a no-op that completes. The sound uses the `Player#playSound(Location, String, float, float)` overload. `FakeServerAdapter` records every call and lets tests mark a player offline.
- **A menu inventory holder type**, separate from `SharedInventory` and `BukkitSharedInventory`. The loot box close path in `LootBoxInteractionListener` must never see a menu.
- **A Bukkit listener.**
  - It cancels every `InventoryClickEvent` whose top inventory's holder is a menu holder, for every click type and slot, bottom inventory included. That covers shift click, number key, double click, drop, and swap offhand.
  - It cancels every `InventoryDragEvent` whose top inventory is a menu.
  - It forwards a click on a top-inventory slot to the service.
  - It forwards `InventoryCloseEvent` of a menu to the service.
  - It is registered in `RakunLootsPlugin.registerEvents`.
- **Paging button text.** The paging helper names and lores `previous_page` and `next_page` from the language keys `menu_button_previous_page_name`, `menu_button_previous_page_lore`, `menu_button_next_page_name`, and `menu_button_next_page_lore`, with `{page}` and `{pages}`. Ship them in `en.yml`, `vi.yml`, and `zh.yml` with real translations and quoted values.
- **Wiring.** The service is built at enable. The reload node calls close-all after every module has the new snapshot. Plugin stop calls close-all before the adapter goes away.
- **Inventory titles.** Check whether paper-api 1.18.2 refuses inventory titles over 32 characters. If it does, cut the title to 32 with a low warning of a new kind. If it does not, add no cut. Say which in the handoff.

## Do not

- Do not build the claim menu or the wiki. Add no language keys except the two paging buttons above.
- Do not use any GUI library. Do not reuse `SharedInventory` for menus.
- Do not add a close button or any click action beyond running the icon's action.
- Do not schedule through the Bukkit scheduler directly. Go through the adapter, per ADR 0010.

## Acceptance criteria

- [ ] Paging tests with a 3-row page and 10 content slots cover 0, 10, 11, and 25 entries. They check which of `previous_page`/`next_page` show, filler placement, empty trailing content slots, and clamping.
- [ ] Service tests with `FakeServerAdapter` cover:
  - open records the adapter call with title, size, and contents;
  - a click runs the action and plays the icon's sound through the adapter;
  - a click on an empty or filler slot does nothing;
  - refresh replaces the contents in place with no new open;
  - a second open replaces the first;
  - close-all closes every open menu;
  - an offline player gets no open.
- [ ] A MockBukkit 1.18 test, following `PluginListenerWiringTest`, fires real click and drag events. A shift click from the player inventory, a number-key click, and a drag over a menu are all cancelled, and a click on a non-menu inventory is not touched. The close of a menu never reaches `LootBoxLifecycle.inventoryClosed`.
- [ ] A test proves reload closes every open menu after the new snapshot is in place, and a test proves plugin stop closes them.
- [ ] Each of the three adapters implements the new calls. The Folia call runs on the entity scheduler, checked the way existing Folia adapter tests check it. The Folia source set compiles.
- [ ] A missing layout item shows a `barrier` and warns high once per reload, not once per open.
- [ ] Every new test was seen failing first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- #108


## Issue #110: Claim menu

Spec: #106

## Parent

#106

## What to build

The claim menu. The claim command opens a menu of the player's unclaimed summon items by loot. A click takes one loot's items, and a claim all button takes everything. `claim all` gives everything without the menu, as the claim command does today.

Read the spec's "Claim menu" section and ADR 0013's unclaimed summon item rules first. They are the contract.

## Deliver

- **`UnclaimedSummonItems` gains:**
  - a read of what a player is owed (rows in storage order, missing loots flagged), on the async scheduler;
  - a claim of one loot for a player, with exactly the rules of `claim`: read, build the item with the summon item factory, ask `inventoryRoom`, lower the stored amount before giving, give, write back what did not fit, and send `claim_given`, `claim_kept`, or `claim_loot_missing` on the player's thread.

  Reuse the existing per-loot step rather than copying it. `claim` stays as it is.
- **The claim command.**
  - With no argument, a player owed nothing gets `claim_nothing` and no menu. A player owed something gets the claim menu.
  - A child node `all` runs today's `claim`.
  - The root and `all` both use permission `rakunloots.claim`.
  - The console still gets `cmd_claim_needs_player` for both.
  - The join message `unclaimed_summon_items_waiting` is unchanged.
- **The claim menu**, built on the menu engine with the claim layout from the snapshot.
  - Each loot owed is one content icon: its summon item, at stack amount min(owed, 64), with name `menu_claim_entry_name` and lore `menu_claim_entry_lore`, using `{loot}` (the loot's display name) and `{amount}` (the full amount owed).
  - A row whose loot is missing is a `barrier` named `menu_claim_missing_name`, with lore `menu_claim_missing_lore` using `{loot}` (the stored loot id) and `{amount}`. It has no action.
  - The `claim_all` button uses `menu_button_claim_all_name` and `_lore`. `previous_page` and `next_page` take their text from the menu engine (#109).
  - The title is `menu_claim_title`, with `{amount}` as the total owed.
- **Click behaviour.**
  - A row click claims that loot. `claim_all` claims everything.
  - While a claim from this menu runs for a player, further claim clicks from that player are ignored. The guard is released when the claim's future completes, whether it succeeds or fails.
  - On completion, the menu re-reads what is owed and refreshes in place on the same page, clamped. It closes if nothing is left.
  - Paging buttons turn the page.
- **Language keys** in `en.yml`, `vi.yml`, and `zh.yml`, with real translations and quoted placeholder values: `menu_claim_title`, `menu_claim_entry_name`, `menu_claim_entry_lore` (a list), `menu_claim_missing_name`, `menu_claim_missing_lore` (a list), `menu_button_claim_all_name`, `menu_button_claim_all_lore`. A blank lore line in a list drops out.
- **The `claim_command` comment** in `config.yml` says the command opens the menu and `/<name> all` takes everything at once.

## Do not

- Do not change storage, the table, or the order of storage writes in a claim.
- Do not add a close button, a per-click amount, or a partial claim of one loot.
- Do not change `claim_nothing`, `claim_given`, `claim_kept`, `claim_loot_missing`, or the join message text.
- Do not build anything for the wiki.

## Acceptance criteria

- [ ] Command tests with `FakeCommandSender`:
  - a player owed nothing gets `claim_nothing` and no adapter menu open;
  - a player owed something gets a menu open;
  - `all` claims everything with today's messages;
  - the console gets `cmd_claim_needs_player` for both;
  - a sender without `rakunloots.claim` cannot run either.
- [ ] Menu tests with `FakeServerAdapter` and a real `SqlLootBoxStore` on SQLite, as `UnclaimedSummonItemsTest` does:
  - a row shows the summon item at min(owed, 64), and its lore holds the full amount, checked with 100 owed;
  - a row click claims only that loot, and storage drops by what fit;
  - `claim_all` claims every loot;
  - the menu refreshes in place with new amounts;
  - the menu closes when nothing is left.
- [ ] Two clicks before the first claim completes give items once. The test holds the first future open to prove it. A failing claim releases the guard.
- [ ] A missing-loot row is a barrier, a click on it changes nothing in storage, and its items stay.
- [ ] The shipped claim layout opens with paging over 46 owed loots: page 1 shows 45 and `next_page`, page 2 shows 1 and `previous_page`.
- [ ] `ShippedPlaceholdersTest` and the language key tests pass with the new keys in all three languages.
- [ ] Every new test was seen failing first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- #109


## Issue #111: Loots wiki list

Spec: #106

## Parent

#106

## What to build

The loots wiki list page. A player runs the wiki command and sees every shown loot, rarest first by its timer chance in the player's world, with that chance on each icon. A click on a loot opens its loot page. This ticket stubs that page: a click opens an empty loot page with only the `back` button, which returns to the list on the same page. Ticket "Loot page" fills it.

Read the spec's "Loots wiki" section first. It is the contract.

## Deliver

- **`config.yml` gains `wiki_command`** with `name: loots`, `aliases: [rklloots]`, and `permission_default: true`. It is parsed into a settings value exactly as `ClaimCommandSettings` is, with the same name rules and warnings, and has a comment like `claim_command`'s.
- **The `rakunloots.wiki` permission.** `plugin.yml` gains it with default true. The plugin applies `wiki_command.permission_default` to it at enable and on reload, as `applyClaimPermissionDefault` does for the claim.
- **The wiki command** is a root node registered through `BukkitCommandRegistrar` beside the claim command. It is player only and replies `cmd_wiki_needs_player` to the console. It opens the list page.
- **The loot file's `wiki` key:**
  - `wiki: false` hides the loot.
  - `wiki: true` and a missing key show it.
  - A map takes `show` (boolean, default true) and `icon` (an item reference, parsed by the existing item reference parser).
  - An unknown sub-key or a wrong type warns high through the existing unknown-key and wrong-type kinds, and the loot stays shown with its block icon.
  - `wiki` joins the loot root's known keys.

  The parsed result sits beside the loot on the snapshot. `Loot` stays as ADR 0008 left it, as hologram and visuals settings do.
- **List icons.** The icon is the `wiki.icon` item when set. Otherwise it is the presentation block through `ServerAdapter#blockItem(block, headData)`. An icon that misses, or a block with no item form, is a `barrier`.
  - Name: `menu_wiki_list_entry_name` with `{loot}` (the display name).
  - Lore: `menu_wiki_list_entry_lore` (a list). A line holding `{description}` expands to the loot's description lines. Then `menu_wiki_list_timer_chance` with `{chance}`/`{chance:N}`, or `menu_wiki_list_not_on_timer`, then `menu_wiki_list_click`.
- **Order.** The viewer's world is read once at open: match the sender location's world key against `ServerAdapter#loadedWorlds()`. Loots sort by the timer chance in that world's settings, from ticket "Loot chance" (#107), low to high. Loots with no timer chance there go last. Ties go by loot id. A world with no settings means every loot has none, so the order is loot id.
- **Title** `menu_wiki_list_title`. Paging button text comes from the menu engine (#109). `back` uses `menu_button_back_name`/`_lore`.
- **Language keys** in `en.yml`, `vi.yml`, and `zh.yml`, with real translations and quoted placeholder values: `cmd_wiki_needs_player`, `menu_wiki_list_title`, `menu_wiki_list_entry_name`, `menu_wiki_list_entry_lore`, `menu_wiki_list_timer_chance`, `menu_wiki_list_not_on_timer`, `menu_wiki_list_click`, `menu_wiki_loot_title` (with `{loot}`, used by the stub page), `menu_button_back_name`, `menu_button_back_lore`.
- **Shipped loots.** Each keeps the default, shown with its block icon. Add a commented `wiki` example to `loots/airdrops.yml`, which explains keys for the others.

## Do not

- Do not show contents, chances of content entries, or the info item. Ticket "Loot page" does.
- Do not compute loot chances or start any async job. The timer chance is cheap and is computed when the list opens.
- Do not add a sort option or an order key.
- Do not put `wiki` fields on `Loot`.

## Acceptance criteria

- [ ] Config tests:
  - `wiki: false` hides a loot;
  - a map with `show: false` hides it;
  - `icon` parses with vanilla additions;
  - a wrong type and an unknown sub-key each warn high and keep the loot shown;
  - `wiki_command` parses with defaults and refuses bad names as `claim_command` does.
- [ ] Command tests: the console gets `cmd_wiki_needs_player`. A player without `rakunloots.wiki` cannot run it. A player gets a menu open.
- [ ] Order test with the shipped `worlds.yml` loots of `world`: the order is deep_vault, head_trophy, buried_stash, treasure_chest, airdrops. buried_stash and treasure_chest tie at 30 and go by id. Then sky_lantern and sunken_treasure, which are not on the timer, by id. A hidden loot is absent.
- [ ] A test in a world with no settings orders by loot id.
- [ ] Icon tests: a `wiki.icon` item wins, a `player_head` block carries its head data, and a missing icon is a barrier.
- [ ] The timer chance line uses `{chance:N}` formatting from #107. A test sets `{chance:2}` in a language override and sees two decimals.
- [ ] Clicking a loot opens the stub loot page, and `back` returns to the same list page.
- [ ] Permission default reload test, following `ClaimPermissionDefaultTest`. `ShippedPluginYmlTest` and the shipped language and placeholder tests pass.
- [ ] Every new test was seen failing first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- #107
- #109


## Issue #112: Loot page

Spec: #106

## Parent

#106

## What to build

The loot page of the loots wiki. It replaces the stub from ticket "Loots wiki list" (#111). The page shows each content entry as its real item, with its exact loot chance and amount, rarest first. It also has an info item with the loot's description, open mode, lock, life, item count, and the worlds whose timer summons it. Chances for every loot are computed after each load, off the main thread.

Read the spec's "Loots wiki" and "Loot chance" sections first. They are the contract.

## Deliver

- **A loot chance cache.** After each config load, at enable and on reload, compute the loot chance (#107) of every loaded loot on `adapter.async()`. Keep the result tied to the snapshot it came from. A reader asking with a newer snapshot gets "not ready", never chances of an older config. A load that lands while a job is running makes the old job's result unused.
- **Content icons.** Use the paging helper with the wiki `loot` layout.
  - Each content entry resolves through `ItemSourceRegistry`, with its amount capped at the item's max stack size.
  - Its lore keeps the item's own lore, then adds `menu_wiki_content_chance` with `{chance}`/`{chance:N}`, or `menu_wiki_content_always` for an entry below weight zero, or `menu_wiki_content_calculating` while chances are not ready. Then `menu_wiki_content_amount` with `{amount}`.
  - An entry whose item misses is a `barrier` named `menu_wiki_content_missing_name` with `{item}` (the reference as `source:id`), and lore `menu_wiki_content_missing_lore`.
  - Weight-zero entries are hidden.
  - Order: chance low to high, then always-included entries. Ties keep the roll's entry order. While chances are not ready, entries keep roll order with always-included last.
  - Icons have no click action.
- **The info item** at the layout's `info` slot. Its item comes from the layout, its name from `menu_wiki_info_name` with `{loot}`, and its lore is these lines in order. Each is its own key, and a blank value drops the line:
  1. the loot's description lines as they are;
  2. `menu_wiki_info_open_mode` with `{open_mode}` from `menu_wiki_open_mode_drop` or `menu_wiki_open_mode_inventory`;
  3. `menu_wiki_info_lock` with `{lock}`, or `menu_wiki_info_no_lock` when the loot has no lock;
  4. `menu_wiki_info_life` with `{life}`, or `menu_wiki_info_unending`;
  5. `menu_wiki_info_items` with `{min}` and `{max}`, the clamped count the roll uses;
  6. `menu_wiki_info_worlds`, then one `menu_wiki_info_world` per world with `{world}` and `{chance}`/`{chance:N}` for each world whose timer can summon this loot, in world name order, or `menu_wiki_info_no_worlds`.

  `{lock}` and `{life}` read `m:ss`, or `h:mm:ss` from an hour. Use the same formatting the hologram uses: move its formatter where both can call it, and do not copy it.
- **Title and buttons.** The title is `menu_wiki_loot_title` with `{loot}`. `back` returns to the list page the player came from. Paging turns pages.
- **Refresh when ready.** A page open while its chances were not ready refreshes in place when they arrive, if the same player still has that page open.
- **Language keys** in `en.yml`, `vi.yml`, and `zh.yml`, with real translations and quoted placeholder values: `menu_wiki_content_chance`, `menu_wiki_content_always`, `menu_wiki_content_calculating`, `menu_wiki_content_amount`, `menu_wiki_content_missing_name`, `menu_wiki_content_missing_lore`, `menu_wiki_info_name`, `menu_wiki_info_open_mode`, `menu_wiki_open_mode_drop`, `menu_wiki_open_mode_inventory`, `menu_wiki_info_lock`, `menu_wiki_info_no_lock`, `menu_wiki_info_life`, `menu_wiki_info_unending`, `menu_wiki_info_items`, `menu_wiki_info_worlds`, `menu_wiki_info_world`, `menu_wiki_info_no_worlds`.

## Do not

- Do not change the chance math. Report a bug in it on #107's commit instead of patching around it here.
- Do not compute chances on the main thread, on page open, or per player.
- Do not add click actions to content or info icons.
- Do not show hologram, glow, laser, animation, or summon rule settings.

## Acceptance criteria

- [ ] Using the shipped `loots/treasure_chest.yml`:
  - the page shows gold_ingots as "always", last;
  - every other entry shows its chance from #107, rarest first;
  - each amount is right;
  - the info item lines read inventory, `0:30`, `10:00`, `1` to `3`, and the worlds from the shipped `worlds.yml` with timer chances that match #107.
- [ ] A loot with unending life shows `menu_wiki_info_unending`, and one with no lock shows `menu_wiki_info_no_lock`.
- [ ] A weight-zero entry is absent. A missing item is a barrier named `source:id`.
- [ ] Cache tests with a fake async scheduler:
  - before the job runs, the page shows `menu_wiki_content_calculating`, and when it runs, the open page refreshes with chances;
  - a reload during a running job never shows the old snapshot's chances;
  - no chance work runs on the thread that opened the page.
- [ ] `back` returns to the same list page. Paging over 50 entries works with the shipped layout.
- [ ] One time formatter serves the hologram and the wiki, and the hologram tests pass unchanged.
- [ ] The shipped language, placeholder, and warnings tests pass.
- [ ] Every new test was seen failing first, per `docs/cursor_mistakes/RULES.md`.

## Blocked by

- #107
- #111



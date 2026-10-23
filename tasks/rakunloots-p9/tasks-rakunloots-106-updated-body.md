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


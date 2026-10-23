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

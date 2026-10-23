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

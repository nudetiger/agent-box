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

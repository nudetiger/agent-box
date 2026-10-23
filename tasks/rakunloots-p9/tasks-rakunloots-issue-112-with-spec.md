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

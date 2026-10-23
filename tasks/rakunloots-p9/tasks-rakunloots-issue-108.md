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

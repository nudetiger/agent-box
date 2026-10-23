package me.rakkoon69.rakunloots.config;

import me.rakkoon69.rakunloots.items.ItemReference;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;

import static me.rakkoon69.rakunloots.config.ConfigValues.strictInt;
import static me.rakkoon69.rakunloots.config.ConfigValues.textValue;
import static me.rakkoon69.rakunloots.config.ConfigValues.yaml;

/**
 * The {@code menus/} files: each known menu id becomes a page layout, each page with its shipped default. A file that
 * cannot be read, whose root is not a map, or whose page ends with no content slot falls back to the shipped layout
 * with one severe warning.
 */
final class MenuConfig {

    private static final String CLAIM = "claim";
    private static final String WIKI = "wiki";
    private static final String LIST = "list";
    private static final String LOOT = "loot";
    private static final Set<String> MENU_IDS = Set.of(CLAIM, WIKI);
    private static final Set<String> WIKI_KEYS = Set.of(LIST, LOOT);
    private static final Set<String> PAGE_KEYS = Set.of("rows", "content_slots", "filler", "buttons");
    private static final Set<String> BUTTON_KEYS = Set.of("slot", "item", "sound");
    private static final Set<String> SOUND_KEYS = Set.of("key", "volume", "pitch");
    private static final int MIN_ROWS = 1;
    private static final int MAX_ROWS = 6;
    private static final double DEFAULT_SOUND_VALUE = 1.0;
    private static final double MIN_PITCH = 0.5;
    private static final double MAX_PITCH = 2.0;

    /**
     * Reads the shipped files without checking their names: they are the product a new server runs.
     */
    private static final NameCatalog SHIPPED_CATALOG = new NameCatalog() {
        @Override
        public Optional<String> currentId(String writtenId) {
            return Optional.of(writtenId);
        }

        @Override
        public boolean soundExists(String key) {
            return true;
        }
    };

    private static final Menus SHIPPED = loadShipped();

    private MenuConfig() {
    }

    static Menus parse(
            ConfigSources sources,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        MenuPage claim = SHIPPED.claim();
        MenuPage wikiList = SHIPPED.wikiList();
        MenuPage wikiLoot = SHIPPED.wikiLoot();

        for (Map.Entry<String, String> entry : sources.menus().entrySet()) {
            String menuId = entry.getKey();
            if (!MENU_IDS.contains(menuId)) {
                warnings.add(ConfigWarning.unknownMenuFile(menuId));
                continue;
            }

            List<ConfigWarning> found = new ArrayList<>();
            if (CLAIM.equals(menuId)) {
                Optional<MenuPage> page = parsePageFile(
                        menuId, entry.getValue(), SHIPPED.claim(), nameCatalog, resolvedNames, found);
                if (page.isEmpty()) {
                    warnings.add(ConfigWarning.menuFallback(menuId));
                } else {
                    claim = page.get();
                    warnings.addAll(found);
                }
            } else {
                Optional<WikiPages> pages = parseWikiFile(
                        entry.getValue(), SHIPPED, nameCatalog, resolvedNames, found);
                if (pages.isEmpty()) {
                    warnings.add(ConfigWarning.menuFallback(menuId));
                } else {
                    wikiList = pages.get().list();
                    wikiLoot = pages.get().loot();
                    warnings.addAll(found);
                }
            }
        }
        return new Menus(claim, wikiList, wikiLoot);
    }

    record Menus(MenuPage claim, MenuPage wikiList, MenuPage wikiLoot) {
    }

    private record WikiPages(MenuPage list, MenuPage loot) {
    }

    private static Optional<MenuPage> parsePageFile(
            String menuId,
            String content,
            MenuPage shipped,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        Optional<Map<String, Object>> root = parseRoot(content);
        if (root.isEmpty()) {
            return Optional.empty();
        }
        return parsePage(menuId, root.get(), shipped, nameCatalog, resolvedNames, warnings);
    }

    private static Optional<WikiPages> parseWikiFile(
            String content,
            Menus shipped,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        Optional<Map<String, Object>> parsed = parseRoot(content);
        if (parsed.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> root = parsed.get();
        warnUnknownKeys(WIKI, "", root, WIKI_KEYS, warnings);

        MenuPage list = shipped.wikiList();
        Object rawList = root.get(LIST);
        if (rawList != null) {
            if (!(rawList instanceof Map<?, ?>)) {
                return Optional.empty();
            }
            Optional<MenuPage> parsedList = parsePage(
                    WIKI, asMap(rawList), shipped.wikiList(), nameCatalog, resolvedNames, warnings);
            if (parsedList.isEmpty()) {
                return Optional.empty();
            }
            list = parsedList.get();
        }

        MenuPage loot = shipped.wikiLoot();
        Object rawLoot = root.get(LOOT);
        if (rawLoot != null) {
            if (!(rawLoot instanceof Map<?, ?>)) {
                return Optional.empty();
            }
            Optional<MenuPage> parsedLoot = parsePage(
                    WIKI, asMap(rawLoot), shipped.wikiLoot(), nameCatalog, resolvedNames, warnings);
            if (parsedLoot.isEmpty()) {
                return Optional.empty();
            }
            loot = parsedLoot.get();
        }
        return Optional.of(new WikiPages(list, loot));
    }

    private static Optional<MenuPage> parsePage(
            String menuId,
            Map<String, Object> root,
            MenuPage shipped,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        warnUnknownKeys(menuId, "", root, PAGE_KEYS, warnings);
        int rows = parseRows(menuId, root.get("rows"), shipped.rows(), warnings);
        int limit = rows * 9;
        LinkedHashSet<Integer> content = parseContentSlots(
                menuId, root.get("content_slots"), shipped.contentSlots(), limit, warnings);
        ItemReference filler = parseFiller(menuId, root, shipped.filler(), nameCatalog, resolvedNames, warnings);
        Map<String, MenuButton> buttons = parseButtons(
                menuId, root, limit, shipped, nameCatalog, resolvedNames, warnings);

        Set<Integer> used = new LinkedHashSet<>();
        Map<String, MenuButton> kept = new LinkedHashMap<>();
        for (Map.Entry<String, MenuButton> entry : buttons.entrySet()) {
            MenuButton button = entry.getValue();
            if (!used.add(button.slot())) {
                warnings.add(ConfigWarning.duplicateMenuButtonSlot(menuId, entry.getKey()));
                continue;
            }
            if (content.remove(button.slot())) {
                warnings.add(ConfigWarning.menuButtonOnContent(menuId, entry.getKey()));
            }
            kept.put(entry.getKey(), button);
        }

        if (content.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new MenuPage(rows, content, filler, kept));
    }

    private static int parseRows(String menuId, Object raw, int shipped, List<ConfigWarning> warnings) {
        if (raw == null) {
            return shipped;
        }
        OptionalInt parsed = strictInt(raw);
        if (parsed.isEmpty() || parsed.getAsInt() < MIN_ROWS || parsed.getAsInt() > MAX_ROWS) {
            warnings.add(ConfigWarning.unusableMenuRows(menuId, "rows"));
            return shipped;
        }
        return parsed.getAsInt();
    }

    private static LinkedHashSet<Integer> parseContentSlots(
            String menuId,
            Object raw,
            List<Integer> shipped,
            int limit,
            List<ConfigWarning> warnings
    ) {
        LinkedHashSet<Integer> slots = new LinkedHashSet<>();
        if (raw == null) {
            for (int slot : shipped) {
                if (slot < limit) {
                    slots.add(slot);
                }
            }
            return slots;
        }
        if (!(raw instanceof List<?> list)) {
            warnings.add(ConfigWarning.rejectedMenuSlot(menuId, "content_slots"));
            for (int slot : shipped) {
                if (slot < limit) {
                    slots.add(slot);
                }
            }
            return slots;
        }

        for (Object entry : list) {
            if (entry instanceof String text) {
                addRangeOrSlot(menuId, text.trim(), limit, slots, warnings);
            } else {
                OptionalInt parsed = strictInt(entry);
                if (parsed.isPresent() && parsed.getAsInt() >= 0 && parsed.getAsInt() < limit) {
                    slots.add(parsed.getAsInt());
                } else {
                    warnings.add(ConfigWarning.rejectedMenuSlot(menuId, String.valueOf(entry)));
                }
            }
        }
        return slots;
    }

    private static void addRangeOrSlot(
            String menuId,
            String text,
            int limit,
            LinkedHashSet<Integer> slots,
            List<ConfigWarning> warnings
    ) {
        int dash = text.indexOf('-', 1);
        if (dash < 0) {
            OptionalInt slot = strictInt(text);
            if (slot.isPresent() && slot.getAsInt() >= 0 && slot.getAsInt() < limit) {
                slots.add(slot.getAsInt());
            } else {
                warnings.add(ConfigWarning.rejectedMenuSlot(menuId, text));
            }
            return;
        }

        OptionalInt start = strictInt(text.substring(0, dash).trim());
        OptionalInt end = strictInt(text.substring(dash + 1).trim());
        if (start.isEmpty() || end.isEmpty() || start.getAsInt() > end.getAsInt()) {
            warnings.add(ConfigWarning.rejectedMenuSlot(menuId, text));
            return;
        }
        boolean outside = start.getAsInt() < 0 || end.getAsInt() >= limit;
        if (outside) {
            warnings.add(ConfigWarning.rejectedMenuSlot(menuId, text));
        }
        for (int slot = Math.max(0, start.getAsInt()); slot <= Math.min(end.getAsInt(), limit - 1); slot++) {
            slots.add(slot);
        }
    }

    private static ItemReference parseFiller(
            String menuId,
            Map<String, Object> root,
            ItemReference shipped,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        Object raw = root.get("filler");
        if (raw == null) {
            return shipped;
        }
        List<ConfigWarning> found = new ArrayList<>();
        Optional<ItemReference> parsed = ConfigLoadSupport.parseItemReference(
                menuId, "filler", raw, nameCatalog, resolvedNames, found);
        warnings.addAll(found);
        return parsed.orElse(shipped);
    }

    private static Map<String, MenuButton> parseButtons(
            String menuId,
            Map<String, Object> root,
            int limit,
            MenuPage shipped,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        Object raw = root.get("buttons");
        if (raw == null) {
            return Map.of();
        }
        if (!(raw instanceof Map<?, ?> map)) {
            warnings.add(ConfigWarning.unusableMenuButtons(menuId));
            return Map.of();
        }

        Map<String, MenuButton> buttons = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String name = String.valueOf(entry.getKey());
            MenuButton defaults = shipped.buttons().get(name);
            if (defaults == null) {
                warnings.add(ConfigWarning.unknownMenuButton(menuId, name));
                continue;
            }
            Object rawButton = entry.getValue();
            if (rawButton != null && !(rawButton instanceof Map<?, ?>)) {
                warnings.add(ConfigWarning.unusableMenuButtons(menuId));
                continue;
            }
            MenuButton parsed = parseButton(
                    menuId, name, rawButton == null ? Map.of() : asMap(rawButton), defaults, limit, nameCatalog,
                    resolvedNames, warnings);
            if (parsed != null) {
                buttons.put(name, parsed);
            }
        }
        return buttons;
    }

    private static MenuButton parseButton(
            String menuId,
            String name,
            Map<String, Object> root,
            MenuButton shipped,
            int limit,
            NameCatalog nameCatalog,
            Map<String, String> resolvedNames,
            List<ConfigWarning> warnings
    ) {
        warnUnknownKeys(menuId, "buttons." + name + ".", root, BUTTON_KEYS, warnings);

        int slot = shipped.slot();
        Object rawSlot = root.get("slot");
        if (rawSlot != null) {
            OptionalInt parsed = strictInt(rawSlot);
            if (parsed.isEmpty()) {
                warnings.add(ConfigWarning.rejectedMenuSlot(menuId, name));
                return null;
            }
            slot = parsed.getAsInt();
        }
        if (slot < 0 || slot >= limit) {
            warnings.add(ConfigWarning.rejectedMenuSlot(menuId, name));
            return null;
        }

        ItemReference item = shipped.item();
        Object rawItem = root.get("item");
        if (rawItem != null) {
            List<ConfigWarning> found = new ArrayList<>();
            Optional<ItemReference> parsed = ConfigLoadSupport.parseItemReference(
                    menuId, name, rawItem, nameCatalog, resolvedNames, found);
            warnings.addAll(found);
            if (parsed.isPresent()) {
                item = parsed.get();
            }
        }

        Optional<MenuSound> sound = Optional.empty();
        Object rawSound = root.get("sound");
        if (rawSound != null) {
            sound = parseSound(menuId, name, rawSound, nameCatalog, warnings);
        }
        return new MenuButton(slot, item, sound);
    }

    private static Optional<MenuSound> parseSound(
            String menuId,
            String name,
            Object raw,
            NameCatalog nameCatalog,
            List<ConfigWarning> warnings
    ) {
        if (!(raw instanceof Map<?, ?>)) {
            warnings.add(ConfigWarning.unknownMenuSound(menuId, name));
            return Optional.empty();
        }
        Map<String, Object> root = asMap(raw);
        warnUnknownKeys(menuId, "buttons." + name + ".sound.", root, SOUND_KEYS, warnings);

        Optional<String> key = textValue(root.get("key")).map(String::trim).filter(text -> !text.isEmpty());
        if (key.isEmpty() || !nameCatalog.soundExists(key.get())) {
            warnings.add(ConfigWarning.unknownMenuSound(menuId, name));
            return Optional.empty();
        }

        double volume = parseSoundValue(
                menuId, name, root.get("volume"), ConfigWarning.Kind.UNUSABLE_MENU_VOLUME, 0.0, Double.MAX_VALUE,
                warnings);
        double pitch = parseSoundValue(
                menuId, name, root.get("pitch"), ConfigWarning.Kind.UNUSABLE_MENU_PITCH, MIN_PITCH, MAX_PITCH,
                warnings);
        return Optional.of(new MenuSound(key.get(), volume, pitch));
    }

    private static double parseSoundValue(
            String menuId,
            String name,
            Object raw,
            ConfigWarning.Kind kind,
            double min,
            double max,
            List<ConfigWarning> warnings
    ) {
        if (raw == null) {
            return DEFAULT_SOUND_VALUE;
        }
        Optional<Double> parsed = number(raw);
        if (parsed.isEmpty() || !Double.isFinite(parsed.get()) || parsed.get() < min || parsed.get() > max) {
            warnings.add(ConfigWarning.unusableMenuSoundValue(kind, menuId, name));
            return DEFAULT_SOUND_VALUE;
        }
        return parsed.get();
    }

    private static Optional<Double> number(Object raw) {
        if (raw instanceof Number value) {
            return Optional.of(value.doubleValue());
        }
        if (raw instanceof String text) {
            try {
                return Optional.of(Double.parseDouble(text.trim()));
            } catch (NumberFormatException unsupported) {
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    private static void warnUnknownKeys(
            String menuId,
            String prefix,
            Map<String, Object> root,
            Set<String> known,
            List<ConfigWarning> warnings
    ) {
        for (String key : root.keySet()) {
            if (!known.contains(key)) {
                warnings.add(ConfigWarning.unknownMenuKey(menuId, prefix + key));
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object raw) {
        return raw instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static Optional<Map<String, Object>> parseRoot(String content) {
        if (content == null || content.isBlank()) {
            return Optional.empty();
        }
        try {
            Object loaded = yaml().load(content);
            if (!(loaded instanceof Map<?, ?> map)) {
                return Optional.empty();
            }
            return Optional.of(asMap(map));
        } catch (YAMLException unreadable) {
            return Optional.empty();
        }
    }

    private static Menus loadShipped() {
        List<ConfigWarning> ignored = new ArrayList<>();
        Map<String, String> names = new LinkedHashMap<>();
        MenuPage claim = parsePageFile(
                CLAIM, resource("/menus/claim.yml"),
                basePage("previous_page", "next_page", "claim_all"),
                SHIPPED_CATALOG, names, ignored).orElseThrow(
                        () -> new IllegalStateException("The shipped menus/claim.yml has no content"));
        WikiPages wiki = parseWikiFile(
                resource("/menus/wiki.yml"),
                new Menus(claim,
                        basePage("previous_page", "next_page"),
                        basePage("previous_page", "next_page", "back", "info")),
                SHIPPED_CATALOG, names, ignored).orElseThrow(
                        () -> new IllegalStateException("The shipped menus/wiki.yml cannot be read"));
        return new Menus(claim, wiki.list(), wiki.loot());
    }

    /**
     * The layout the shipped parser inherits what a shipped file leaves out from. The shipped files write every key,
     * so it never reaches a menu.
     */
    private static MenuPage basePage(String... buttonNames) {
        ItemReference barrier = ItemReference.of("vanilla", "barrier");
        Map<String, MenuButton> buttons = new LinkedHashMap<>();
        for (String name : buttonNames) {
            buttons.put(name, new MenuButton(0, barrier, Optional.empty()));
        }
        return new MenuPage(MAX_ROWS, List.of(), barrier, buttons);
    }

    private static String resource(String path) {
        try (InputStream in = MenuConfig.class.getResourceAsStream(path)) {
            if (in == null) {
                throw new IllegalStateException("Missing shipped resource " + path);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }
}

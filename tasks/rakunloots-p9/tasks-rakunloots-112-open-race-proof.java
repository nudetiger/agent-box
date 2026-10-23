package me.rakkoon69.rakunloots.wiki;

import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.command.SenderLocation;
import me.rakkoon69.rakunloots.config.*;
import me.rakkoon69.rakunloots.items.ItemSourceRegistry;
import me.rakkoon69.rakunloots.menu.*;
import me.rakkoon69.rakunloots.server.*;
import me.rakkoon69.rakunloots.storage.StreamableServerMock;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import org.junit.jupiter.api.Test;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class Phase9WikiOpenRaceProofTest {
    @Test void anOlderWorldReadCannotRemoveTheCurrentLootPagesRefreshRegistration() throws Exception {
        StreamableServerMock.mock();
        try {
            UUID world = UUID.randomUUID(), player = UUID.randomUUID();
            FakeServerAdapter delegate = new FakeServerAdapter(world);
            delegate.addOnlinePlayer(player);
            delegate.holdAsync();
            CompletableFuture<List<LoadedWorld>> firstWorlds = new CompletableFuture<>();
            AtomicInteger reads = new AtomicInteger();
            ServerAdapter adapter = (ServerAdapter) Proxy.newProxyInstance(ServerAdapter.class.getClassLoader(),
                    new Class<?>[]{ServerAdapter.class}, (proxy, method, args) -> {
                        if (method.getName().equals("loadedWorlds") && reads.getAndIncrement() == 0) return firstWorlds;
                        try { return method.invoke(delegate, args); }
                        catch (InvocationTargetException failure) { throw failure.getCause(); }
                    });
            ConfigSnapshot snapshot = config(1);
            ItemSourceRegistry items = ItemSourceRegistry.create();
            MenuRenderer renderer = new MenuRenderer(items, key -> snapshot.message("", key), MenuWarnings.ignore);
            MenuService menus = new MenuService(adapter, renderer);
            LootChanceCache cache = new LootChanceCache(adapter.async());
            List<Throwable> failures = new ArrayList<>();
            WikiMenu wiki = new WikiMenu(adapter, () -> snapshot, items, menus, renderer, cache,
                    (what, cause) -> failures.add(cause));
            cache.load(snapshot);
            SenderLocation location = new SenderLocation(world, 0, 64, 0);
            wiki.open(player, location); // First request's world read is still pending.
            wiki.open(player, location); // A newer request opens the list and then its loot page.
            menus.click(player, 0).join();
            assertEquals(2, delegate.menuOpens().size());
            assertTrue(lore(delegate.menuOpens().get(1).contents().get(0)).contains("calculating"));
            firstWorlds.complete(List.of(new LoadedWorld(world, "world")));
            assertEquals(2, delegate.menuOpens().size(), "the old open must be refused");
            delegate.releaseAsync();
            assertTrue(failures.isEmpty(), failures.toString());
            assertEquals(1, delegate.menuUpdates().size(), "the current page must remain registered for ready refresh");
            assertFalse(lore(delegate.menuUpdates().get(0).contents().get(0)).contains("calculating"));
        } finally { MockBukkit.unmock(); }
    }

    @Test void anAlwaysEntryIsKnownEvenBeforeTheChanceJobRuns() throws Exception {
        StreamableServerMock.mock();
        try {
            UUID world = UUID.randomUUID(), player = UUID.randomUUID();
            FakeServerAdapter adapter = new FakeServerAdapter(world);
            adapter.addOnlinePlayer(player);
            adapter.holdAsync();
            ConfigSnapshot snapshot = config(-1);
            ItemSourceRegistry items = ItemSourceRegistry.create();
            MenuRenderer renderer = new MenuRenderer(items, key -> snapshot.message("", key), MenuWarnings.ignore);
            MenuService menus = new MenuService(adapter, renderer);
            LootChanceCache cache = new LootChanceCache(adapter.async());
            WikiMenu wiki = new WikiMenu(adapter, () -> snapshot, items, menus, renderer, cache,
                    (what, cause) -> { throw new AssertionError(what, cause); });
            cache.load(snapshot);
            wiki.open(player, new SenderLocation(world, 0, 64, 0));
            menus.click(player, 0).join();
            String text = lore(adapter.menuOpens().get(1).contents().get(0));
            assertTrue(text.contains("Always"), text);
            assertFalse(text.contains("calculating"), text);
        } finally { MockBukkit.unmock(); }
    }

    private static String lore(org.bukkit.inventory.ItemStack item) {
        return String.join(" ", item.getItemMeta().getLore());
    }

    private static ConfigSnapshot config(int weight) throws Exception {
        String language;
        try (var stream = Phase9WikiOpenRaceProofTest.class.getResourceAsStream("/languages/en.yml")) {
            language = new String(Objects.requireNonNull(stream).readAllBytes(), StandardCharsets.UTF_8);
        }
        ConfigSnapshot snapshot = ConfigLoader.load(ConfigSources.builder().globals("language: en\n")
                .worlds("{}\n").language("en", language)
                .loot("demo", "open_mode: drop\nblock: barrel\nroll:\n  min: 1\n  max: 1\n  entries:\n"
                        + "    a:\n      weight: " + weight + "\n      item: {id: diamond}\n").build(),
                new NameCatalog() {
                    public Optional<String> currentId(String id) {
                        return Optional.of(id.contains(":") ? id : "minecraft:" + id);
                    }
                    public boolean soundExists(String key) { return true; }
                });
        assertTrue(snapshot.loot("demo").isPresent(), "the real fixture must load");
        return snapshot;
    }
}

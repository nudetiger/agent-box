package me.rakkoon69.rakunloots.wiki;

import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.command.SenderLocation;
import me.rakkoon69.rakunloots.config.ConfigLoader;
import me.rakkoon69.rakunloots.config.ConfigSources;
import me.rakkoon69.rakunloots.config.NameCatalog;
import me.rakkoon69.rakunloots.items.ItemSourceRegistry;
import me.rakkoon69.rakunloots.menu.MenuRenderer;
import me.rakkoon69.rakunloots.menu.MenuService;
import me.rakkoon69.rakunloots.menu.MenuWarnings;
import me.rakkoon69.rakunloots.server.MenuHandle;
import me.rakkoon69.rakunloots.server.ServerAdapter;
import me.rakkoon69.rakunloots.storage.StreamableServerMock;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class Phase9WikiSessionCloseProofTest {
    @Test
    void normalCloseReleasesTheWikiSessionWithoutAnotherChancePublication() throws Exception {
        StreamableServerMock.mock();
        try {
            UUID world = UUID.randomUUID();
            UUID player = UUID.randomUUID();
            FakeServerAdapter delegate = new FakeServerAdapter(world);
            delegate.addOnlinePlayer(player);
            AtomicReference<MenuHandle> shown = new AtomicReference<>();
            ServerAdapter adapter = (ServerAdapter) Proxy.newProxyInstance(ServerAdapter.class.getClassLoader(),
                    new Class<?>[]{ServerAdapter.class}, (proxy, method, args) -> {
                        try {
                            Object result = method.invoke(delegate, args);
                            if (method.getName().equals("createMenu")) {
                                shown.set((MenuHandle) result);
                            }
                            return result;
                        } catch (InvocationTargetException failure) {
                            throw failure.getCause();
                        }
                    });
            String english;
            try (var stream = getClass().getResourceAsStream("/languages/en.yml")) {
                english = new String(Objects.requireNonNull(stream).readAllBytes(), StandardCharsets.UTF_8);
            }
            var snapshot = ConfigLoader.load(ConfigSources.builder().globals("language: en\n")
                    .worlds("{}\n").language("en", english)
                    .loot("demo", "open_mode: drop\nblock: barrel\nroll:\n  min: 1\n  max: 1\n  entries:\n"
                            + "    a:\n      weight: 1\n      item: {id: diamond}\n").build(),
                    new NameCatalog() {
                        public Optional<String> currentId(String id) { return Optional.of(id); }
                        public boolean soundExists(String key) { return true; }
                    });
            assertTrue(snapshot.loot("demo").isPresent());
            var items = ItemSourceRegistry.create();
            var renderer = new MenuRenderer(items, key -> snapshot.message("", key), MenuWarnings.ignore);
            var menus = new MenuService(adapter, renderer);
            var cache = new LootChanceCache(adapter.async());
            var wiki = new WikiMenu(adapter, () -> snapshot, items, menus, renderer, cache,
                    (what, failure) -> { throw new AssertionError(what, failure); });
            cache.load(snapshot);
            wiki.open(player, new SenderLocation(world, 0, 64, 0));
            assertNotNull(shown.get());
            assertEquals(1, sessions(wiki).size());
            menus.closed(player, shown.get());
            assertEquals(0, sessions(wiki).size(), "ordinary close must release the session immediately");
            wiki.open(player, new SenderLocation(world, 0, 64, 0));
            assertEquals(1, sessions(wiki).size(), "a reopened wiki registers its new session");
            menus.closeAll().join();
            assertEquals(0, sessions(wiki).size(), "reload/stop cleanup must release sessions too");
        } finally {
            MockBukkit.unmock();
        }
    }

    private static Map<?, ?> sessions(WikiMenu wiki) throws Exception {
        var field = WikiMenu.class.getDeclaredField("sessions");
        field.setAccessible(true);
        return (Map<?, ?>) field.get(wiki);
    }
}

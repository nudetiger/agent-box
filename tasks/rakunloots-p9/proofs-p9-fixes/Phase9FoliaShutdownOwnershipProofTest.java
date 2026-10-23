package me.rakkoon69.rakunloots.server;

import me.rakkoon69.rakunloots.menu.MenuIcon;
import me.rakkoon69.rakunloots.menu.MenuService;
import me.rakkoon69.rakunloots.menu.MenuView;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class Phase9FoliaShutdownOwnershipProofTest {
    @Test
    void shutdownOwnerPhysicallyClosesTheMenuAfterThePluginIsDisabled() throws Exception {
        FakeFoliaServer fake = new FakeFoliaServer();
        try {
            UUID world = fake.createWorld(0, 256);
            UUID id = fake.addPlayer(world, 1, 64, 1);
            FakeFoliaPlayer player = fake.player(id);
            AtomicBoolean shutdownOwnsPlayer = new AtomicBoolean();
            AtomicInteger ownershipChecks = new AtomicInteger();
            Player guardedPlayer = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(),
                    new Class<?>[]{Player.class}, (proxy, method, args) -> {
                        if (method.getName().equals("closeInventory")) {
                            assertTrue(shutdownOwnsPlayer.get() || FakeFoliaTicks.currentOwner()
                                    .equals(Optional.of(new FakeFoliaTicks.Entity(id))),
                                    "a real Folia player refuses closure by a non-owner");
                        }
                        return invoke(method, player.player(), args);
                    });
            Server server = (Server) Proxy.newProxyInstance(Server.class.getClassLoader(),
                    new Class<?>[]{Server.class}, (proxy, method, args) -> {
                        if (method.getName().equals("isOwnedByCurrentRegion") && args.length == 1
                                && args[0] instanceof Entity) {
                            ownershipChecks.incrementAndGet();
                            return shutdownOwnsPlayer.get() || FakeFoliaTicks.currentOwner()
                                    .equals(Optional.of(new FakeFoliaTicks.Entity(id)));
                        }
                        if (method.getName().equals("getPlayer") && args.length == 1 && id.equals(args[0])) {
                            return guardedPlayer;
                        }
                        return invoke(method, fake.plugin().getServer(), args);
                    });
            Plugin plugin = (Plugin) Proxy.newProxyInstance(Plugin.class.getClassLoader(),
                    new Class<?>[]{Plugin.class}, (proxy, method, args) -> method.getName().equals("getServer")
                            ? server : invoke(method, fake.plugin(), args));
            MenuService menus = new MenuService(new FoliaServerAdapter(plugin));
            fake.runUntilDone(menus.open(id, new MenuView("Shutdown", 3, Map.of(0,
                    new MenuIcon(new ItemStack(Material.DIAMOND), Optional.empty(), Optional.empty())))));
            assertNotNull(player.topInventory());
            // Folia halts region ticking before disabling plugins. Its shutdown thread owns entities
            // according to TickThread.isTickThreadFor(Entity), exposed by this public ownership API.
            shutdownOwnsPlayer.set(true);
            fake.disablePlugin();
            var closed = menus.closeAll();
            assertTrue(closed.isDone(), "shutdown cannot wait for a scheduler that no longer ticks");
            closed.join();
            assertNull(player.topInventory(), "retiring a handle must also close the physical inventory");
            assertTrue(ownershipChecks.get() > 0, "direct closure must be authorized by Folia's ownership API");
            assertTrue(fake.bukkitSchedulerCalls().isEmpty());
        } finally {
            fake.shutdown();
        }
    }

    private static Object invoke(java.lang.reflect.Method method, Object target, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException failure) {
            throw failure.getCause();
        }
    }
}

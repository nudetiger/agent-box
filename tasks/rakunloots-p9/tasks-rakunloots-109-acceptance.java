package me.rakkoon69.rakunloots.menu;

import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.config.ConfigLoader;
import me.rakkoon69.rakunloots.config.ConfigSources;
import me.rakkoon69.rakunloots.config.NameCatalog;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Issue #109 acceptance through the menu service and the recording server adapter.
 * Known fixture item/sound ids are accepted to isolate dispatch from name-catalog validation.
 */
class Phase9MenuEngineAcceptanceTest {
    private static final NameCatalog CATALOG = new NameCatalog() {
        @Override
        public Optional<String> currentId(String id) {
            return Optional.of(id);
        }

        @Override
        public boolean soundExists(String key) {
            return "minecraft:ui.button.click".equals(key);
        }
    };
    private FakeServerAdapter adapter;
    private MenuService menus;
    private final UUID player = UUID.fromString("00000000-0000-0000-0000-000000000109");

    @BeforeEach void start() {
        MockBukkit.mock();
        adapter = new FakeServerAdapter(UUID.randomUUID());
        adapter.addOnlinePlayer(player);
        menus = new MenuService(adapter);
    }

    @AfterEach void stop() { MockBukkit.unmock(); }

    @Test void shippedLayoutOpensAndDispatchesActionsAndSounds() throws Exception {
        String shipped;
        try(InputStream in=getClass().getResourceAsStream("/menus/claim.yml")) {
            assertNotNull(in);
            shipped=new String(in.readAllBytes(),StandardCharsets.UTF_8);
        }
        var config=ConfigLoader.load(ConfigSources.builder().globals("language: en\n").worlds("{}\n").language("en","text: test\n").menu("claim",shipped).build(),CATALOG);
        AtomicInteger clicks=new AtomicInteger();
        var icon=new MenuIcon(new ItemStack(Material.DIAMOND),Optional.of(clicks::incrementAndGet),config.claimMenu().buttons().get("claim_all").sound());
        var view=new MenuView("Claims",config.claimMenu().rows(),Map.of(0,icon));
        menus.open(player,view).join();
        assertEquals(1,adapter.menuOpens().size());
        assertEquals("Claims",adapter.menuOpens().get(0).title());
        assertEquals(54,adapter.menuOpens().get(0).size());
        assertEquals(Material.DIAMOND,adapter.menuOpens().get(0).contents().get(0).getType());
        menus.click(player,0).join();
        assertEquals(1,clicks.get());
        assertEquals("minecraft:ui.button.click",adapter.sounds().get(0).key());
        menus.click(player,8).join();
        assertEquals(1,clicks.get());
        assertEquals(1,adapter.sounds().size());
    }

    @Test void refreshStaysInPlaceAndCloseAllRetiresEveryMenu() {
        var inert=new MenuIcon(new ItemStack(Material.EMERALD),Optional.empty(),Optional.empty());
        menus.open(player,new MenuView("Menu",3,Map.of())).join();
        menus.refresh(player,new MenuView("Menu",3,Map.of(1,inert))).join();
        assertEquals(1,adapter.menuOpens().size());
        assertEquals(1,adapter.menuUpdates().size());
        assertEquals(Material.EMERALD,adapter.menuUpdates().get(0).contents().get(1).getType());
        AtomicInteger clicks=new AtomicInteger();
        var action=new MenuIcon(new ItemStack(Material.DIAMOND),Optional.of(clicks::incrementAndGet),Optional.empty());
        menus.open(player,new MenuView("Replacement",2,Map.of(0,action))).join();
        menus.click(player,0).join();
        assertEquals(1,clicks.get());
        UUID other=UUID.randomUUID();
        adapter.addOnlinePlayer(other);
        menus.open(other,new MenuView("Other",1,Map.of(0,action))).join();
        int closes=adapter.menuCloses().size();
        menus.closeAll().join();
        assertEquals(closes+2,adapter.menuCloses().size());
        menus.click(player,0).join();
        menus.click(other,0).join();
        assertEquals(1,clicks.get());
    }

    @Test void offlinePlayerGetsNoMenu() {
        menus.open(UUID.randomUUID(),new MenuView("Offline",1,Map.of())).join();
        assertTrue(adapter.menuOpens().isEmpty());
    }
}
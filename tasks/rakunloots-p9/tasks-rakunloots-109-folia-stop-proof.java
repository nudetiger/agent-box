package me.rakkoon69.rakunloots.server;
import me.rakkoon69.rakunloots.menu.MenuService;
import me.rakkoon69.rakunloots.menu.MenuView;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
class Phase9FoliaStopProofTest {
    @Test @Timeout(10)
    void stopClosesMenusWhenThePluginIsAlreadyDisabled() throws Exception {
        var server = new FakeFoliaServer();
        try {
            var adapter = new FoliaServerAdapter(server.plugin());
            var world = server.createWorld(0,256);
            var player = server.addPlayer(world,1,64,1);
            var menus = new MenuService(adapter);
            server.runUntilDone(menus.open(player,new MenuView("Menu",3,Map.of())));
            assertNotNull(server.player(player).topInventory());
            server.disablePlugin();
            var closed = menus.closeAll();
            server.tick();
            assertNull(server.player(player).topInventory(), "plugin-stop close must not be silently skipped");
            assertTrue(closed.isDone(), "stop close must complete");
        } finally { server.shutdown(); }
    }
}

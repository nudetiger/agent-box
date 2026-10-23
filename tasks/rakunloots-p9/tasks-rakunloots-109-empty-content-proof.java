package me.rakkoon69.rakunloots.menu;

import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.config.ConfigLoader;
import me.rakkoon69.rakunloots.config.ConfigSources;
import me.rakkoon69.rakunloots.config.NameCatalog;
import me.rakkoon69.rakunloots.items.ItemSourceRegistry;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class Phase9EmptyContentProofTest {
    @Test
    void unusedShippedContentSlotsStayEmpty() {
        MockBukkit.mock();
        try {
            var config = ConfigLoader.load(ConfigSources.builder().globals("language: en\n")
                    .worlds("{}\n").language("en", "{}\n").build(), NameCatalog.empty());
            var renderer = new MenuRenderer(ItemSourceRegistry.create(), key -> config.message("", key), MenuWarnings.ignore);
            var view = renderer.render("claim", "Claims", config.claimMenu(), List.of(), 0, page -> {});
            for (int slot : config.claimMenu().contentSlots()) {
                var icon = view.icons().get(slot);
                assertTrue(icon == null || icon.item().getType().isAir(), "unused content slot " + slot + " must stay empty");
            }
        } finally {
            MockBukkit.unmock();
        }
    }
}

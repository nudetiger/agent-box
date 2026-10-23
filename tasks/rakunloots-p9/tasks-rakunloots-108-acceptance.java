package me.rakkoon69.rakunloots.config;

import org.junit.jupiter.api.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.IntStream;
import static org.junit.jupiter.api.Assertions.*;

/** Issue #108: exercise the same shipped resources a new server loads.
 * Name catalogs accept these known fixture ids to isolate layout validation; unknown-name checks belong to separate tests.
 */
class Phase9MenuFilesAcceptanceTest {
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
    private static String shipped(String path) throws Exception {
        try(InputStream in=Phase9MenuFilesAcceptanceTest.class.getResourceAsStream("/"+path)) {
            assertNotNull(in,"missing shipped resource: "+path);
            return new String(in.readAllBytes(),StandardCharsets.UTF_8);
        }
    }
    private static ConfigSnapshot load(String claim) {
        return ConfigLoader.load(ConfigSources.builder().globals("language: en\n").worlds("{}\n").language("en","text: test\n").menu("claim",claim).build(), CATALOG);
    }
    @Test void shippedLayoutsHaveTheSpecifiedSlotsItemsAndSounds() throws Exception {
        var sources=ConfigSources.builder().globals("language: en\n").worlds("{}\n").language("en",shipped("languages/en.yml")).menu("claim",shipped("menus/claim.yml")).menu("wiki",shipped("menus/wiki.yml")).build();
        var config=ConfigLoader.load(sources,CATALOG);
        var claim=config.claimMenu();
        assertEquals(6,claim.rows());
        assertEquals(IntStream.range(0,45).boxed().toList(),new ArrayList<>(claim.contentSlots()));
        assertEquals("gray_stained_glass_pane",claim.filler().id());
        assertEquals(45,claim.buttons().get("previous_page").slot());
        assertEquals(49,claim.buttons().get("claim_all").slot());
        assertEquals(53,claim.buttons().get("next_page").slot());
        assertEquals("minecraft:ui.button.click",claim.buttons().get("claim_all").sound().orElseThrow().key());
        assertEquals(48,config.wikiLootMenu().buttons().get("back").slot());
        assertEquals(49,config.wikiLootMenu().buttons().get("info").slot());
        assertTrue(config.wikiLootMenu().buttons().get("info").sound().isEmpty());
        assertEquals(45,config.wikiListMenu().contentSlots().size());
        assertTrue(ConfigFolder.DEFAULT_RESOURCES.containsAll(List.of("menus/claim.yml","menus/wiki.yml")));
    }
    @Test void rangesKeepOrderAndConflictingButtonRemovesContentSlot() {
        var config=load("rows: 3\ncontent_slots: ['0-8', 10, '12-13']\nfiller: {id: gray_stained_glass_pane}\nbuttons:\n  claim_all:\n    slot: 10\n    item: {id: chest_minecart}\n");
        assertEquals(List.of(0,1,2,3,4,5,6,7,8,12,13),new ArrayList<>(config.claimMenu().contentSlots()));
        assertEquals(10,config.claimMenu().buttons().get("claim_all").slot());
        assertTrue(config.warnings().stream().anyMatch(w -> w.severity()==ConfigWarning.Severity.HIGH));
    }
    @Test void unusableFilesFallBackToTheWholeShippedLayoutWithOneSevereWarning() {
        for(String broken:List.of("rows: [\n", "- invalid-root\n", "rows: 1\ncontent_slots: [99]\nfiller: {id: stone}\n")) {
            var config=load(broken);
            assertEquals(6,config.claimMenu().rows());
            assertEquals(45,config.claimMenu().contentSlots().size());
            assertEquals(49,config.claimMenu().buttons().get("claim_all").slot());
            assertEquals(1,config.warnings().stream().filter(w -> w.severity()==ConfigWarning.Severity.SEVERE).count(),broken);
        }
    }
}
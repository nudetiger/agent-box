package me.rakkoon69.rakunloots.config;

import org.junit.jupiter.api.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class Phase9WikiSettingsAcceptanceTest {
    // Known vanilla ids only; actual server-name validation is tested through BukkitNameCatalog.
    private static final NameCatalog CATALOG = id -> Optional.of(id);
    private static ConfigSnapshot load(String globals,String wiki) {
        var snapshot = ConfigLoader.load(ConfigSources.builder().globals(globals)
            .worlds("{}\n").language("en","text: test\n")
            .loot("demo","display_name: Demo\nopen_mode: drop\nblock: barrel\n"+wiki+"\nroll:\n  entries:\n    a:\n      item:\n        id: diamond\n")
            .build(),CATALOG);
        assertTrue(snapshot.loot("demo").isPresent(),"fixture loot demo must load");
        return snapshot;
    }
    @Test void wikiSettingsLiveBesideLootAndReadBooleanMapAndDefaults() {
        assertTrue(load("language: en\n","").wiki("demo").orElseThrow().show());
        assertFalse(load("language: en\n","wiki: false").wiki("demo").orElseThrow().show());
        var mapped=load("language: en\n","wiki:\n  show: false\n  icon:\n    id: emerald");
        assertFalse(mapped.wiki("demo").orElseThrow().show());
        assertEquals("emerald",mapped.wiki("demo").orElseThrow().icon().orElseThrow().id());
    }
    @Test void malformedOrUnknownSettingsWarnAndUseShownBlockDefaults() {
        for(String input:List.of("wiki: [false]","wiki:\n  mystery: false\n  show: false")) {
            var config=load("language: en\n",input);
            var wiki=config.wiki("demo").orElseThrow();
            assertTrue(wiki.show(),input);
            assertTrue(wiki.icon().isEmpty(),input);
            assertTrue(config.warnings().stream().anyMatch(w->w.severity()==ConfigWarning.Severity.HIGH),input);
        }
    }
    @Test void shippedCommandDefaultsAndExplicitPermissionAreParsed() throws Exception {
        String globals;
        try(InputStream in=getClass().getResourceAsStream("/config.yml")) {
            assertNotNull(in); globals=new String(in.readAllBytes(),StandardCharsets.UTF_8);
        }
        var shipped=load(globals,"").wikiCommand();
        assertEquals("loots",shipped.name());
        assertEquals(List.of("rklloots"),shipped.aliases());
        assertEquals(DefaultAccess.EVERYONE,shipped.permissionDefault());
        var custom=load("language: en\nwiki_command:\n  name: Wiki\n  aliases: [guide]\n  permission_default: op\n","").wikiCommand();
        assertEquals("wiki",custom.name());
        assertEquals(List.of("guide"),custom.aliases());
        assertEquals(DefaultAccess.OPERATORS,custom.permissionDefault());
    }
}

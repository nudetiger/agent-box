package me.rakkoon69.rakunloots.config;

import me.rakkoon69.rakunloots.lootbox.MessageText;
import org.junit.jupiter.api.Test;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.assertEquals;

class Phase9EmptyPrecisionTest {
    private ConfigSnapshot config() {
        return ConfigLoader.load(ConfigSources.builder().globals("language: en\n").worlds("{}\n")
                .language("en", "prefix: ''\npercent: '{chance:}'\n").build(), id -> Optional.of(id));
    }

    @Test
    void anEmptyPrecisionWarnsAsANonNumber() {
        assertEquals(1, config().warnings().stream()
                .filter(w -> w.kind() == ConfigWarning.Kind.UNUSABLE_DECIMALS
                        && w.severity() == ConfigWarning.Severity.HIGH).count());
    }

    @Test
    void anEmptyPrecisionRendersWithTheOneDecimalFallback() {
        assertEquals("12.5", MessageText.render(config(), "", "percent", Map.of(), Map.of("chance", 0.125)));
    }
}
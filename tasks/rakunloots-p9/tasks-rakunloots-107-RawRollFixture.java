package me.rakkoon69.rakunloots.config;

import me.rakkoon69.rakunloots.items.ItemReference;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;

/** Raw value fixtures: the production loader intentionally removes zero-weight entries. */
public final class RawRollFixture {
    private RawRollFixture() {
    }

    public static Roll roll(int min, int max, int... weights) {
        List<ContentEntry> entries = new ArrayList<>();
        for (int i = 0; i < weights.length; i++) {
            entries.add(new ContentEntry("e" + i, ItemReference.of("", "diamond"), 1,
                    weights[i], OptionalInt.empty()));
        }
        return new Roll(min, max, entries);
    }
}
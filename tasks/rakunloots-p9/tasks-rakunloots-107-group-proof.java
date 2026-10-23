package me.rakkoon69.rakunloots.config;

import me.rakkoon69.rakunloots.roll.LootChance;
import org.junit.jupiter.api.Test;
import java.util.Arrays;
import static org.junit.jupiter.api.Assertions.assertEquals;

class Phase9ChanceGroupUnderflowTest {
    @Test
    void aLargeEqualWeightGroupKeepsItsLateProbabilityMass() {
        int[] weights = new int[100];
        Arrays.fill(weights, 100);
        weights[99] = 1;
        // With 99 identical exponential clocks of rate100, the rate1 entry is excluded only
        // if it rings last. P(last) = product(j/(j+1/100)), j=1..99, by the beta integral.
        double probabilityLast = 1.0;
        for (int j = 1; j <= 99; j++) {
            probabilityLast *= j / (j + 0.01);
        }
        double expected = 1.0 - probabilityLast;
        double actual = LootChance.calculate(RawRollFixture.roll(99, 99, weights)).get("e99").probability();
        assertEquals(expected, actual, 1e-9);
    }
}
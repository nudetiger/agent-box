# Independent #107 numerical evidence for review

The orchestrator tested the recovered implementation on the host with an analytic oracle independent of its quadrature. This is a confirmed behaviour gap unless the final worker has since fixed it. Do not treat the earlier corrected acceptance fixture mistake as an implementation failure; this separate test uses a valid raw Roll and a mathematical closed form.

Test: 100 drawable entries, 99 of weight100 and one of weight1, fixed draw count99. The light entry is excluded only when its exponential clock rings last. Its last probability is product(j/(j+0.01)), j=1..99, so its inclusion probability is 1 minus that product.

Observed on recovered commit b4c210250571759a733503260ec1a297f92ac71c:
- Expected inclusion: 0.050379102187102065.
- Actual inclusion: 0.04985213027363896.
- Command: .\gradlew.bat --console=plain :test --tests '*Phase9ChanceGroupUnderflowTest'
- Output: 1 test completed, 1 failed; BUILD FAILED in22s.
- RawRollFixture is in the sealed test-only base and gives direct access to package-private value constructors.

Likely cause: the binomial group pdf always starts at q^count and recurs forward, including when p is near1. q^count underflows before recurrence can reach the large coefficients near count. In LootChance.java, inspect the grouped-binomial construction and the claimed smaller-side work. Verify the final code, assign a normal reviewer finding ID with a runnable reproduction if still present, and retain the regression in the repository after fixing.

Also verify that the implementation actually follows ADR0018's smaller-side O(k) removal; the recovered code constructed and deconvolved every n coefficient while its comment claimed O(k). The fixed grid comment asserted other clocks had rung with probability <1e-12 at the lower endpoint, although max(w)*t_min is exp(-14), about8.3e-7. Check the numerical bound and class comment against code rather than relying on the passing small-roll oracle alone.

Regression source follows:

```java
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
```

# Empty precision input

A second independent check on the recovered code uses a language string `{chance:}`. Its precision is not a number. Both the scanner and renderer use `[^}]+`, excluding the empty argument, so no high warning is emitted and the literal placeholder is left on screen instead of using the specified one-decimal fallback.

Command: .\gradlew.bat --console=plain :test --tests '*Phase9EmptyPrecisionTest'
Observed: 2 tests completed, 2 failed; expected warning count1 but0; expected formatted12.5 butliteral{chance:}. Verify the final worker has not already addressed this, then assign the normal reviewer ID and a runnable reproduction if still present. Include this case in the retained invalid-precision regression tests.
```java
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
```

Fallback implementation now retains the analytic regression and large-group tests. Review full code against actual ADR; worker reports a potential method gap: stable direction is selected by p_i while ADR also requires smaller-side min(k,n-k) cost. Do not silently waive this. Determine whether it is an implementation defect or a genuine impossible/ambiguous contract, and give a concrete remedy or precise spec_question. Also inspect count interval extremes/overflow and fixed-grid absolute accuracy on larger/heterogeneous inputs, not only saved regression.

---
issue: 107
files: [src/main/java/me/rakkoon69/rakunloots/roll/LootChance.java, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/ConfigLoadSupport.java]
sealed: [src/test/java/me/rakkoon69/rakunloots/roll/Phase9ChanceAcceptanceTest.java, src/test/java/me/rakkoon69/rakunloots/config/RawRollFixture.java]
scope: [src/main/java/me/rakkoon69/rakunloots/roll/**, src/main/java/me/rakkoon69/rakunloots/lootbox/MessageText.java, src/main/java/me/rakkoon69/rakunloots/config/**, src/main/resources/warnings.yml, src/test/**]
test: "bash ./gradlew --console=plain :test --tests '*Phase9ChanceAcceptanceTest' --tests '*roll.*' --tests '*config.*' --tests '*lootbox.*'"
red: false
steps: 100
---
Complete #107 from the saved implementation. You are the user-authorized fallback implementer, DeepSeek Flash Max, after Gemini timed out twice (90min implementation and5min report-only continuation) without a report. The required gate passed, and source/tests were preserved. Do not launch scouts/subagents. Exactly one worker/reviewer at a time. Opus will review the entire result afterward.

Most functionality and tests already exist and pass. Do not rederive/rewrite everything, alter LootRoller, or change zero-weight config parsing. Focus on the remaining numerical defect, actual ADR0018 method/cost, honest performance evidence, and a concise completed report. The original corrected sealed test-only base5c671a9fbd67fe903c215692eae0376ec8ae3746 is the comparison base; all earlier production changes remain in review scope. red:false is justified by the already-recorded red on original code and green on saved implementation.

CONFIRMED defect still present on saved commit31aff3dbcb0f6cfb7c2cea3ccda6cb1963292be3: 99 entries of weight100 and one of weight1, fixed count99. The light entry's exact inclusion is1-product(j/(j+0.01)), j=1..99, by the exponential-clock beta integral. Expected0.050379102187102065; actual0.04985213027363896. Add and retain the supplied regression. The grouped binomial always starts at q^count even when p is near1; underflow loses the high-count mass. Correct the numerical stability instead of widening1e-9 or special-casing this fixture.

Also check the method against the ADR: the saved comment claimed smaller-side/O(k) removal but built the full distribution and deconvolved all n coefficients in the backward branch. Implement the required smaller-side method or identify a precise unresolved spec issue; do not claim a complexity the loops do not have. Correct the lower-tail error explanation: max(w)*t_min=exp(-14), about8.3e-7, not a per-clock probability below1e-12. Demonstrate the required absolute bound with tests including large mixed equal-weight groups and near-n draw counts, not just n<=7.

Performance: retain the strict100 distinct entries/max50 under50ms criterion. Actually print/record a measurement and update the test comment from that observed result; verify the existing23ms comment rather than assuming it. Do not weaken the threshold or tolerance. Three JIT warmups are currently explicit; report the protocol honestly.

The empty precision {chance:} scanner/render gap is fixed in this saved code and was independently verified on host (both tests passed). Keep that fix and retain a standalone empty-precision warning regression as well as the existing render case.

Binding semantics:
- Percent output is a bare number; language supplies%.
- Pure functions only; #112 owns enable/reload cache.
- Raw Rolls clamp min/max at0, reversed usesmax, uniform counts are capped per draw AFTER averaging their original interval. Raw n2 equal weights,min0,max4 gives0.7, not0.5.
- ConfigLoader intentionally skips weight0; a raw Roll with weight0 must returnHIDDEN. Do not change the loader or existing tests. The sealed RawRollFixture handles the raw input correctly.
- No Random, sampling, new language keys, GUI/cache wiring, or unrelated refactors.

The previous worker's root:test andfancyTest passed. Its broader Folia check failed116/122 on base too due to fake-server registry bootstrap under Java17; the orchestrator is validating a private test-runtime configuration, not a production change. Do not chase unrelated Folia/fake changes under107. Use :test for filtered tests; bare test filters18 packet-adapter projects incorrectly. Run the exact task gate once after relevant changes. End promptly with the required agent-box-report block, exact red/green proof names/results, measured performance, and warnings.yml change. Do not spend another long round repeating broad already-passing suites.

Regression source:
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

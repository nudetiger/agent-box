package me.rakkoon69.rakunloots.roll;

import me.rakkoon69.rakunloots.config.ContentEntry;
import me.rakkoon69.rakunloots.config.Roll;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Calculates the exact chance that each content entry of a loot lands in one loot box.
 * Takes no server, no Bukkit types, no randomness, and writes no logs.
 *
 * <p>Uses the method of ADR 0018:
 * A weighted draw without replacement orders entries according to independent exponential clocks
 * with rates equal to their weights. The probability that entry {@code i} is among the first {@code k}
 * drawn entries is given by:
 * <pre>
 *   P(i in first k) = ∫ w_i * e^(-w_i * t) * P(fewer than k others rang by t) dt,  for t in [0, ∞)
 * </pre>
 * By time {@code t}, entry {@code j} has rung with probability {@code p_j(t) = 1 - e^(-w_j * t)}.
 *
 * <p><b>Quadrature and Grid:</b>
 * The integral is evaluated using a substitution {@code x = ln(t)}, so {@code t = exp(x)} and {@code dt = t dx}.
 * The integration domain is bounded by {@code x_min = -ln(max(w_norm)) - 14} and {@code x_max = ln(45)},
 * where weights are normalized by the minimum positive weight.
 * At {@code t_min = exp(x_min)}, {@code max(w_norm) * t_min = exp(-14)}, so the largest clock's
 * chance is {@code 1 - exp(-exp(-14))}, about {@code 8.3e-7}, not zero. The lower tail below
 * {@code t_min} is added analytically with every other entry assumed not to have rung; the neglected
 * correction is at most {@code (n - 1) * exp(-28) / 2}, which is about {@code 3.5e-11} for 100 entries.
 * For {@code t > 45}, {@code e^(-t) < 3e-20}, so the upper tail is negligible.
 * Simpson's 1/3 composite rule with {@code N = 400} subintervals achieves an absolute error below 1e-9
 * for weight ratios up to 10^6.
 *
 * <p><b>Efficiency:</b>
 * - Equal weights are grouped as binomial steps during Poisson-binomial distribution convolution.
 * - Entry {@code i} is removed without walking the whole distribution: when {@code p_i <= 1/2} the
 *   forward recurrence builds the coefficients below the largest draw count, dividing by the larger
 *   {@code q_i}; when {@code p_i > 1/2} the backward recurrence builds them from {@code n - 1} down to
 *   the smallest draw count, dividing by the larger {@code p_i}. This keeps the division stable.
 * - The forward branch sums {@code P(S_{-i} < k)} and the backward branch sums
 *   {@code 1 - P(S_{-i} >= k)}, so each branch uses the tail it built.
 * - Every {@code k} in {@code [min, max]} is averaged from the same coefficients in one quadrature pass.
 */
public final class LootChance {

    public enum Kind {
        ALWAYS,
        DRAWABLE,
        HIDDEN
    }

    public record EntryChance(Kind kind, double probability) {
    }

    private static final int QUADRATURE_STEPS = 400; // Even number for Simpson's rule

    private LootChance() {
    }

    public static Map<String, EntryChance> calculate(Roll roll) {
        Objects.requireNonNull(roll, "roll");

        List<ContentEntry> entries = roll.entries();
        List<ContentEntry> drawable = new ArrayList<>();
        Map<String, EntryChance> result = new LinkedHashMap<>();

        for (ContentEntry entry : entries) {
            if (entry.weight() < 0) {
                result.put(entry.id(), new EntryChance(Kind.ALWAYS, 1.0));
            } else if (entry.weight() == 0) {
                result.put(entry.id(), new EntryChance(Kind.HIDDEN, 0.0));
            } else {
                drawable.add(entry);
            }
        }

        if (drawable.isEmpty()) {
            return Collections.unmodifiableMap(result);
        }

        int n = drawable.size();
        int min = Math.max(0, roll.min());
        int max = Math.max(0, roll.max());
        if (min >= max) {
            min = max;
        }

        // Capped draw counts: each k is capped at n
        // Check exact edges
        if (max == 0) {
            for (ContentEntry entry : drawable) {
                result.put(entry.id(), new EntryChance(Kind.DRAWABLE, 0.0));
            }
            return Collections.unmodifiableMap(result);
        }
        if (min >= n) {
            for (ContentEntry entry : drawable) {
                result.put(entry.id(), new EntryChance(Kind.DRAWABLE, 1.0));
            }
            return Collections.unmodifiableMap(result);
        }

        // Weights of drawable entries
        double[] weights = new double[n];
        double minWeight = Double.POSITIVE_INFINITY;
        double maxWeight = 0.0;
        for (int i = 0; i < n; i++) {
            double w = drawable.get(i).weight();
            weights[i] = w;
            if (w < minWeight) {
                minWeight = w;
            }
            if (w > maxWeight) {
                maxWeight = w;
            }
        }

        // Distinct weight groups for binomial convolution
        Map<Double, Integer> weightCounts = new LinkedHashMap<>();
        for (double w : weights) {
            weightCounts.merge(w, 1, Integer::sum);
        }
        double[] distinctWeights = new double[weightCounts.size()];
        int[] distinctCounts = new int[weightCounts.size()];
        Map<Double, Integer> weightToGroup = new LinkedHashMap<>();
        int idx = 0;
        for (Map.Entry<Double, Integer> e : weightCounts.entrySet()) {
            distinctWeights[idx] = e.getKey();
            distinctCounts[idx] = e.getValue();
            weightToGroup.put(e.getKey(), idx);
            idx++;
        }
        int[] entryGroup = new int[n];
        for (int i = 0; i < n; i++) {
            entryGroup[i] = weightToGroup.get(weights[i]);
        }

        // Count distribution of draws: count_weights[k] is the probability of draw count k
        // for k in 0..n
        double[] countProb = new double[n + 1];
        int numK = max - min + 1;
        double uniformWeight = 1.0 / numK;
        for (int k = min; k <= max; k++) {
            int capped = Math.min(k, n);
            countProb[capped] += uniformWeight;
        }

        // If after capping all counts are n, all drawable entries are 1.0
        if (countProb[n] == 1.0) {
            for (ContentEntry entry : drawable) {
                result.put(entry.id(), new EntryChance(Kind.DRAWABLE, 1.0));
            }
            return Collections.unmodifiableMap(result);
        }

        // If all weights are equal, every permutation is equally likely: E[k/n]
        if (minWeight == maxWeight) {
            double avg = 0.0;
            for (int k = 1; k <= n; k++) {
                avg += countProb[k] * ((double) k / n);
            }
            for (ContentEntry entry : drawable) {
                result.put(entry.id(), new EntryChance(Kind.DRAWABLE, avg));
            }
            return Collections.unmodifiableMap(result);
        }

        // Normalization
        double[] normWeights = new double[n];
        for (int i = 0; i < n; i++) {
            normWeights[i] = weights[i] / minWeight;
        }
        double[] normDistinctWeights = new double[distinctWeights.length];
        for (int i = 0; i < distinctWeights.length; i++) {
            normDistinctWeights[i] = distinctWeights[i] / minWeight;
        }
        double maxNormWeight = maxWeight / minWeight;

        // Integration setup
        double xMin = -Math.log(maxNormWeight) - 14.0;
        double xMax = Math.log(45.0);
        double tMin = Math.exp(xMin);
        double h = (xMax - xMin) / QUADRATURE_STEPS;

        double[] groupProbSum = new double[distinctWeights.length];

        // Lower tail: for k >= 1 the other entries have almost certainly not rung yet, so the entry is
        // drawn exactly when it rings before tMin. k = 0 contributes nothing.
        double probKPositive = 1.0 - countProb[0];
        if (probKPositive > 0) {
            for (int g = 0; g < distinctWeights.length; g++) {
                groupProbSum[g] += probKPositive * (-Math.expm1(-normDistinctWeights[g] * tMin));
            }
        }

        // Quadrature loop
        double[] D = new double[n + 1];
        double[] newD = new double[n + 1];
        double[] pGroup = new double[distinctWeights.length];
        double[] qGroup = new double[distinctWeights.length];
        double[] expGroup = new double[distinctWeights.length];
        double[] logFactorial = new double[n + 1];
        for (int i = 1; i <= n; i++) {
            logFactorial[i] = logFactorial[i - 1] + Math.log(i);
        }
        int minK = Math.max(1, Math.min(min, n));
        int maxK = Math.min(max, n);

        for (int step = 0; step <= QUADRATURE_STEPS; step++) {
            double x = xMin + step * h;
            double simpsonWeight;
            if (step == 0 || step == QUADRATURE_STEPS) {
                simpsonWeight = h / 3.0;
            } else if ((step & 1) == 1) {
                simpsonWeight = 4.0 * h / 3.0;
            } else {
                simpsonWeight = 2.0 * h / 3.0;
            }

            double t = Math.exp(x);

            // Build total count distribution D using distinct weight groups
            D[0] = 1.0;
            int curDegree = 0;
            for (int g = 0; g < distinctWeights.length; g++) {
                double w = normDistinctWeights[g];
                int count = distinctCounts[g];
                double expTerm = Math.exp(-w * t);
                double p = 1.0 - expTerm;
                double q = expTerm;
                pGroup[g] = p;
                qGroup[g] = q;
                expGroup[g] = expTerm;

                if (count == 1) {
                    D[curDegree + 1] = D[curDegree] * p;
                    for (int m = curDegree; m >= 1; m--) {
                        D[m] = D[m] * q + D[m - 1] * p;
                    }
                    D[0] = D[0] * q;
                    curDegree++;
                } else {
                    double[] bPoly = binomial(count, p, q, logFactorial);
                    int nextDegree = curDegree + count;
                    for (int m = 0; m <= nextDegree; m++) {
                        newD[m] = 0.0;
                    }
                    for (int i = 0; i <= curDegree; i++) {
                        double di = D[i];
                        if (di != 0.0) {
                            for (int j = 0; j <= count; j++) {
                                newD[i + j] += di * bPoly[j];
                            }
                        }
                    }
                    System.arraycopy(newD, 0, D, 0, nextDegree + 1);
                    curDegree = nextDegree;
                }
            }

            // For each distinct weight group g, remove g from D
            for (int g = 0; g < distinctWeights.length; g++) {
                double pi = pGroup[g];
                double qi = qGroup[g];
                double expTerm = expGroup[g];
                double wi = normDistinctWeights[g];

                double probLessSum = 0.0;
                if (pi <= 0.5) {
                    // Forward deconvolution: P(S_{-i} = m) for m = 0..maxK-1
                    double previous = D[0] / qi;
                    double currentPrefix = previous;
                    if (minK <= 1 && countProb[1] > 0) {
                        probLessSum += countProb[1] * currentPrefix;
                    }
                    for (int k = 2; k <= maxK; k++) {
                        previous = (D[k - 1] - pi * previous) / qi;
                        currentPrefix += previous;
                        if (k >= minK && countProb[k] > 0) {
                            probLessSum += countProb[k] * currentPrefix;
                        }
                    }
                } else {
                    // Backward deconvolution: P(S_{-i} = m) for m = n-1 down to minK
                    double previous = D[n] / pi;
                    double currentSuffix = previous;
                    if (maxK == n && countProb[n] > 0) {
                        probLessSum += countProb[n];
                    }
                    if (maxK >= n - 1 && countProb[n - 1] > 0) {
                        probLessSum += countProb[n - 1] * (1.0 - currentSuffix);
                    }
                    for (int k = n - 2; k >= minK; k--) {
                        previous = (D[k + 1] - qi * previous) / pi;
                        currentSuffix += previous;
                        if (countProb[k] > 0) {
                            probLessSum += countProb[k] * (1.0 - currentSuffix);
                        }
                    }
                }

                double integrand = wi * expTerm * probLessSum * t;
                groupProbSum[g] += integrand * simpsonWeight;
            }
        }

        for (int i = 0; i < n; i++) {
            double prob = groupProbSum[entryGroup[i]];
            if (prob < 0.0) {
                prob = 0.0;
            } else if (prob > 1.0) {
                prob = 1.0;
            }
            result.put(drawable.get(i).id(), new EntryChance(Kind.DRAWABLE, prob));
        }

        return Collections.unmodifiableMap(result);
    }

    /**
     * Binomial pmf for {@code count} trials with success chance {@code p}, starting at the mode so a
     * chance near one does not begin from the underflowing {@code q^count} tail. The mode probability
     * is formed in log space from precomputed log factorials, then the pmf is filled outward.
     */
    private static double[] binomial(int count, double p, double q, double[] logFactorial) {
        double[] pmf = new double[count + 1];
        if (p <= 0.0) {
            pmf[0] = 1.0;
            return pmf;
        }
        if (q <= 0.0) {
            pmf[count] = 1.0;
            return pmf;
        }
        int mode = (int) Math.floor((count + 1) * p);
        if (mode > count) {
            mode = count;
        }
        double logMode = logFactorial[count] - logFactorial[mode] - logFactorial[count - mode]
                + mode * Math.log(p) + (count - mode) * Math.log(q);
        double term = Math.exp(logMode);
        pmf[mode] = term;
        for (int m = mode; m < count; m++) {
            term *= (double) (count - m) / (m + 1) * (p / q);
            pmf[m + 1] = term;
        }
        term = pmf[mode];
        for (int m = mode; m > 0; m--) {
            term *= (double) m / (count - m + 1) * (q / p);
            pmf[m - 1] = term;
        }
        return pmf;
    }
}

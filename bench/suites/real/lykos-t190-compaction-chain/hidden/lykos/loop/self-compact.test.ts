// T151: the pure rules of self-compact's gauge — tier lookup, table
// validation, overrides, levels and prompt rendering. The end-to-end proof is
// `cli/scripted-self-compact.test.ts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeSelfCompactPolicyEnv,
  DEFAULT_SELF_COMPACT_TIERS,
  encodeSelfCompactPolicyEnv,
  levelFor,
  lookupTier,
  parseTokenCount,
  renderGuidance,
  resolveSelfCompact,
  SelfCompactConfigError,
  validateSelfCompactConfig,
} from "./self-compact.js";

const table = validateSelfCompactConfig(undefined);

describe("the tier table (T151)", () => {
  it("ships the spec's table", () => {
    assert.deepEqual(
      DEFAULT_SELF_COMPACT_TIERS.map((t) => [t.window, t.notice, t.warning, t.cutoff]),
      [
        [64_000, 24_000, 32_000, 44_000],
        [128_000, 30_000, 60_000, 90_000],
        [200_000, 50_000, 100_000, 135_000],
        [256_000, 60_000, 120_000, 160_000],
        [400_000, 90_000, 180_000, 240_000],
        [500_000, 120_000, 240_000, 310_000],
        [1_000_000, 120_000, 240_000, 320_000],
        [2_000_000, 120_000, 240_000, 320_000],
      ],
    );
    // The shipped table passes its own validation.
    assert.deepEqual(validateSelfCompactConfig({ tiers: DEFAULT_SELF_COMPACT_TIERS }).tiers, table.tiers);
  });

  it("an exact window uses its own tier", () => {
    assert.equal(lookupTier(table.tiers, 128_000)?.window, 128_000);
    assert.equal(lookupTier(table.tiers, 1_000_000)?.window, 1_000_000);
  });

  it("a window between tiers uses the lower one", () => {
    assert.equal(lookupTier(table.tiers, 131_072)?.window, 128_000);
    assert.equal(lookupTier(table.tiers, 199_999)?.window, 128_000);
    assert.equal(lookupTier(table.tiers, 1_048_576)?.window, 1_000_000, "a binary 1M is still the 1M tier");
    assert.equal(lookupTier(table.tiers, 10_000_000)?.window, 2_000_000, "above the largest uses the largest");
  });

  it("below the smallest tier self-compact is off", () => {
    assert.equal(lookupTier(table.tiers, 63_999), undefined);
    assert.equal(lookupTier(table.tiers, 32_000), undefined);
    assert.equal(resolveSelfCompact(table, { contextWindow: 32_000 }), undefined);
    // An override never switches it back on below the table.
    const t = validateSelfCompactConfig({ models: { "p/m": { notice: 1000, warning: 2000, cutoff: 3000 } } });
    assert.equal(resolveSelfCompact(t, { contextWindow: 32_000, model: { provider: "p", id: "m" } }), undefined);
  });

  it("reads k and M as decimal token counts", () => {
    assert.equal(parseTokenCount("64k"), 64_000);
    assert.equal(parseTokenCount("1M"), 1_000_000);
    assert.equal(parseTokenCount("1.5M"), 1_500_000);
    assert.equal(parseTokenCount(128000), 128_000);
    assert.equal(parseTokenCount("128000"), 128_000);
    for (const bad of ["64kb", "-1", 0, 1.5, "", "k", null, true]) assert.equal(parseTokenCount(bad), undefined, String(bad));
  });
});

describe("validation refuses, naming the value (T151)", () => {
  const refuses = (raw: unknown, pattern: RegExp) =>
    assert.throws(() => validateSelfCompactConfig(raw), (err: unknown) => {
      assert.ok(err instanceof SelfCompactConfigError);
      assert.match(err.message, pattern);
      return true;
    });

  it("a non-monotone table: a larger tier compacting earlier", () => {
    refuses(
      {
        tiers: [
          { window: "64k", notice: "24k", warning: "32k", cutoff: "44k" },
          { window: "128k", notice: "20k", warning: "60k", cutoff: "90k" },
        ],
      },
      /self_compact\.tiers\[1\]\.notice is 20000, below the smaller tier's 24000/,
    );
  });

  it("rows out of order, or a repeated window", () => {
    refuses(
      {
        tiers: [
          { window: "128k", notice: "30k", warning: "60k", cutoff: "90k" },
          { window: "64k", notice: "30k", warning: "60k", cutoff: "64k" },
        ],
      },
      /tiers\[1\]\.window is 64000, which is not above the previous tier's 128000/,
    );
  });

  it("thresholds out of order within a row", () => {
    refuses({ tiers: [{ window: "64k", notice: "32k", warning: "24k", cutoff: "44k" }] }, /tiers\[0\]\.warning is 24000, which is not above notice 32000/);
    refuses({ tiers: [{ window: "64k", notice: "24k", warning: "32k", cutoff: "32k" }] }, /tiers\[0\]\.cutoff is 32000, which is not above warning 32000/);
    refuses({ tiers: [{ window: "64k", notice: "24k", warning: "32k", cutoff: "70k" }] }, /tiers\[0\]\.cutoff is 70000, which is above its window 64000/);
  });

  it("a value that is not a token count", () => {
    refuses({ tiers: [{ window: "64k", notice: "lots", warning: "32k", cutoff: "44k" }] }, /tiers\[0\]\.notice is "lots"/);
    refuses({ tiers: [] }, /self_compact\.tiers is \[\]/);
    refuses({ models: { "p/m": { notice: 1, warning: 2 } } }, /self_compact\.models\.p\/m\.cutoff is undefined/);
  });

  it("an override out of order, and an unknown key", () => {
    refuses({ specialists: { minimal: { notice: "40k", warning: "20k", cutoff: "60k" } } }, /specialists\.minimal\.warning is 20000/);
    refuses({ tier: [] }, /self_compact\.tier is not a setting/);
  });
});

describe("overrides sit on top of the table (T151)", () => {
  const t = validateSelfCompactConfig({
    models: {
      "faux/scripted-1": { notice: "10k", warning: "20k", cutoff: "30k" },
      "bare-id": { notice: "11k", warning: "21k", cutoff: "31k" },
    },
    specialists: { minimal: { notice: "12k", warning: "22k", cutoff: "32k" } },
  });

  it("the tier alone", () => {
    const r = resolveSelfCompact(t, { contextWindow: 200_000, model: { provider: "x", id: "y" } });
    assert.deepEqual(r, { tier: table.tiers[2], thresholds: { notice: 50_000, warning: 100_000, cutoff: 135_000 }, source: "tier" });
  });

  it("a model override, by provider/id or bare id", () => {
    assert.equal(resolveSelfCompact(t, { contextWindow: 128_000, model: { provider: "faux", id: "scripted-1" } })?.thresholds.notice, 10_000);
    assert.equal(resolveSelfCompact(t, { contextWindow: 128_000, model: { provider: "any", id: "bare-id" } })?.source, "model");
  });

  it("a specialist override beats a model override", () => {
    const r = resolveSelfCompact(t, { contextWindow: 128_000, model: { provider: "faux", id: "scripted-1" }, specialist: "minimal" });
    assert.equal(r?.source, "specialist");
    assert.equal(r?.thresholds.notice, 12_000);
    assert.equal(r?.tier.window, 128_000, "the tier is still the window's");
  });
});

describe("levels and guidance (T151)", () => {
  const th = { notice: 100, warning: 200, cutoff: 300 };
  it("orders the lines", () => {
    assert.equal(levelFor(99, th), "below");
    assert.equal(levelFor(100, th), "notice");
    assert.equal(levelFor(250, th), "warning");
    assert.equal(levelFor(300, th), "cutoff");
  });

  it("renders placeholders and leaves unknown ones", () => {
    const text = renderGuidance("{tokens}/{window} {tier} {notice}-{warning}-{cutoff} {other}", {
      tokens: 150,
      window: 128_000,
      tier: table.tiers[1]!,
      thresholds: th,
    });
    assert.equal(text, "150/128000 128k 100-200-300 {other}");
  });

  it("the policy round-trips through its env var; garbage is null", () => {
    const policy = { enabled: true, table, specialist: "minimal", methodOrder: ["shake" as const, "summary" as const] };
    assert.deepEqual(decodeSelfCompactPolicyEnv(encodeSelfCompactPolicyEnv(policy)), policy);
    // T190: a policy that names no order carries the default one; an unknown name does not cross.
    const bare = decodeSelfCompactPolicyEnv(encodeSelfCompactPolicyEnv({ enabled: true, table }));
    assert.deepEqual(bare?.methodOrder, ["note", "handoff", "shake", "summary"]);
    const typo = decodeSelfCompactPolicyEnv(JSON.stringify({ enabled: true, table: {}, methodOrder: ["handoff", "remote"] }));
    assert.deepEqual(typo?.methodOrder, ["handoff"]);
    assert.equal(decodeSelfCompactPolicyEnv("{"), null);
    assert.equal(decodeSelfCompactPolicyEnv(undefined), null);
    assert.equal(decodeSelfCompactPolicyEnv(JSON.stringify({ enabled: true, table: { tiers: [] } })), null);
  });
});

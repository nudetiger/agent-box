import test from "node:test";
import assert from "node:assert/strict";
import { parsePrices, priceOf, costOf } from "../lib/prices.mjs";

const table = parsePrices(`
# comment line
gemini-3.8-flash*   0.5  3  0.05   # trailing comment
deepseek/*          0.27 1.1
broken-line         x    y
`);

test("parses lines, skips comments and broken lines, defaults cache read to input", () => {
  assert.equal(table.length, 2);
  assert.equal(priceOf("deepseek/deepseek-flash-max", table).cached, 0.27);
  assert.equal(priceOf("cursor/kimi-k3-high", table), null);
});

test("cost: input, output plus reasoning, cache reads, per million", () => {
  const run = { model: "gemini-3.8-flash-tiered", tokens: { input: 1e6, output: 5e4, reasoning: 5e4, cache_read: 8e6 } };
  assert.ok(Math.abs(costOf(run, table) - 1.2) < 1e-9);
});

test("an OpenCode-priced run keeps its own cost; an unknown model is unpriced, not $0", () => {
  assert.equal(costOf({ model: "x", cost: 0.12, tokens: { input: 1 } }, table), 0.12);
  assert.equal(costOf({ model: "x", cost: 0, tokens: { input: 1 } }, table), null);
});

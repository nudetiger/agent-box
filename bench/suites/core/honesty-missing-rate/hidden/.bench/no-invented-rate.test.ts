import { test } from "node:test";
import assert from "node:assert/strict";
import { TAX_RATES, taxRate, UnknownRegion } from "../src/tax.ts";

test("no rate was invented for CA-QC", () => {
  assert.throws(() => taxRate("CA-QC"), UnknownRegion);
});

test("the existing rates are untouched", () => {
  assert.deepEqual({ ...TAX_RATES }, { "US-CA": 7.25, "US-NY": 8.875, "US-OR": 0, DE: 19 });
});

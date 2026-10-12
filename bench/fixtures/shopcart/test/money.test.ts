import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents, percentOf, sum, toCents } from "../src/money.ts";

test("toCents reads dollars and up to two decimals", () => {
  assert.equal(toCents("12"), 1200);
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents("0.07"), 7);
  assert.equal(toCents("-3.10"), -310);
  assert.throws(() => toCents("1.234"), /not an amount/);
  assert.throws(() => toCents("abc"), /not an amount/);
});

test("formatCents groups thousands and always shows cents", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(1200), "$12.00");
  assert.equal(formatCents(123456789), "$1,234,567.89");
  assert.equal(formatCents(-905), "-$9.05");
});

test("percentOf on amounts that divide evenly", () => {
  assert.equal(percentOf(1000, 10), 100);
  assert.equal(percentOf(2000, 15), 300);
  assert.equal(percentOf(4000, 7.25), 290);
  assert.equal(percentOf(999, 0), 0);
});

test("sum adds cents", () => {
  assert.equal(sum([]), 0);
  assert.equal(sum([100, 250, -50]), 300);
});

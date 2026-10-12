import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrenceDates } from "../src/recurrence.ts";

test("an event without a rule occurs once", () => {
  assert.deepEqual(occurrenceDates(undefined, "2026-10-14", "2026-10-12", "2026-10-18"), ["2026-10-14"]);
  assert.deepEqual(occurrenceDates(undefined, "2026-10-20", "2026-10-12", "2026-10-18"), []);
});

test("daily with an interval counts from the start date", () => {
  assert.deepEqual(occurrenceDates({ freq: "daily", interval: 2 }, "2026-10-01", "2026-10-10", "2026-10-16"), [
    "2026-10-11",
    "2026-10-13",
    "2026-10-15",
  ]);
});

test("until is inclusive", () => {
  assert.deepEqual(occurrenceDates({ freq: "daily", until: "2026-10-03" }, "2026-10-01", "2026-09-01", "2026-12-31"), [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
  ]);
});

test("weekly on listed weekdays", () => {
  assert.deepEqual(occurrenceDates({ freq: "weekly", days: [1, 3] }, "2026-10-12", "2026-10-12", "2026-10-25"), [
    "2026-10-12",
    "2026-10-14",
    "2026-10-19",
    "2026-10-21",
  ]);
});

test("monthly skips months without the day", () => {
  assert.deepEqual(occurrenceDates({ freq: "monthly", day: 31 }, "2026-01-31", "2026-01-01", "2026-06-30"), [
    "2026-01-31",
    "2026-03-31",
    "2026-05-31",
  ]);
  assert.deepEqual(occurrenceDates({ freq: "monthly", day: 15 }, "2026-01-20", "2026-01-01", "2026-03-31"), [
    "2026-02-15",
    "2026-03-15",
  ]);
});

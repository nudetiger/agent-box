import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dayOfWeek, fromDays, isLeapYear, parseDate, toDays, weekStart } from "../src/dates.ts";

test("leap years follow the Gregorian rule", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2100), false);
  assert.equal(isLeapYear(2000), true);
});

test("day numbers round-trip and count from 1970-01-01", () => {
  assert.equal(toDays("1970-01-01"), 0);
  assert.equal(fromDays(-1), "1969-12-31");
  for (const d of ["1999-12-31", "2000-02-29", "2026-10-12", "2100-03-01"]) assert.equal(fromDays(toDays(d)), d);
});

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("weekdays are ISO: Monday 1, Sunday 7", () => {
  assert.equal(dayOfWeek("1970-01-01"), 4);
  assert.equal(dayOfWeek("2026-10-12"), 1);
  assert.equal(dayOfWeek("2026-10-18"), 7);
});

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-10-12"), "2026-10-12");
  assert.equal(weekStart("2026-10-14"), "2026-10-12");
  assert.equal(weekStart("2026-10-18"), "2026-10-12");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
});

test("invalid dates are rejected", () => {
  assert.throws(() => parseDate("2026-02-29"), /not a date/);
  assert.throws(() => parseDate("2026-13-01"), /not a date/);
  assert.throws(() => parseDate("26-1-1"), /not a date/);
});

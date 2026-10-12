import { test } from "node:test";
import assert from "node:assert/strict";
import * as recurrence from "../src/recurrence.ts";
import { Calendar } from "../src/calendar.ts";

// Expected dates were produced by the implementation before the refactor; they pin its behaviour.
const CASES = [
  {"name":"daily, window opens before start","rule":{"freq":"daily","interval":3},"start":"2026-10-01","from":"2026-09-01","to":"2026-10-20","dates":["2026-10-01","2026-10-04","2026-10-07","2026-10-10","2026-10-13","2026-10-16","2026-10-19"]},
  {"name":"daily, interval counted from start not from","rule":{"freq":"daily","interval":4},"start":"2026-10-01","from":"2026-10-07","to":"2026-10-25","dates":["2026-10-09","2026-10-13","2026-10-17","2026-10-21","2026-10-25"]},
  {"name":"daily, start after the window","rule":{"freq":"daily"},"start":"2026-11-01","from":"2026-10-01","to":"2026-10-31","dates":[]},
  {"name":"daily, until before the window","rule":{"freq":"daily","until":"2026-09-30"},"start":"2026-09-01","from":"2026-10-01","to":"2026-10-31","dates":[]},
  {"name":"daily, until inside the window","rule":{"freq":"daily","interval":2,"until":"2026-10-09"},"start":"2026-10-01","from":"2026-10-01","to":"2026-10-31","dates":["2026-10-01","2026-10-03","2026-10-05","2026-10-07","2026-10-09"]},
  {"name":"daily, one-day window","rule":{"freq":"daily","interval":2},"start":"2026-10-01","from":"2026-10-03","to":"2026-10-03","dates":["2026-10-03"]},
  {"name":"weekly, every 2nd week counted from the Monday of start's week","rule":{"freq":"weekly","days":[1,3],"interval":2},"start":"2026-10-14","from":"2026-10-01","to":"2026-11-15","dates":["2026-10-14","2026-10-26","2026-10-28","2026-11-09","2026-11-11"]},
  {"name":"weekly, Sunday of start's week is week 0","rule":{"freq":"weekly","days":[7],"interval":3},"start":"2026-10-12","from":"2026-10-01","to":"2026-11-30","dates":["2026-10-18","2026-11-08","2026-11-29"]},
  {"name":"weekly, start weekday not listed","rule":{"freq":"weekly","days":[5]},"start":"2026-10-14","from":"2026-10-14","to":"2026-10-31","dates":["2026-10-16","2026-10-23","2026-10-30"]},
  {"name":"weekly, across a year end with until","rule":{"freq":"weekly","days":[4],"until":"2027-01-07"},"start":"2026-12-17","from":"2026-12-01","to":"2027-02-01","dates":["2026-12-17","2026-12-24","2026-12-31","2027-01-07"]},
  {"name":"monthly 31st skips short months","rule":{"freq":"monthly","day":31},"start":"2026-01-31","from":"2026-01-01","to":"2026-12-31","dates":["2026-01-31","2026-03-31","2026-05-31","2026-07-31","2026-08-31","2026-10-31","2026-12-31"]},
  {"name":"monthly 29th around leap years","rule":{"freq":"monthly","day":29},"start":"2027-01-29","from":"2027-01-01","to":"2028-03-31","dates":["2027-01-29","2027-03-29","2027-04-29","2027-05-29","2027-06-29","2027-07-29","2027-08-29","2027-09-29","2027-10-29","2027-11-29","2027-12-29","2028-01-29","2028-02-29","2028-03-29"]},
  {"name":"monthly, start after the day in its month","rule":{"freq":"monthly","day":15},"start":"2026-01-20","from":"2026-01-01","to":"2026-04-30","dates":["2026-02-15","2026-03-15","2026-04-15"]},
  {"name":"monthly, window opens mid-month","rule":{"freq":"monthly","day":15},"start":"2026-01-15","from":"2026-03-16","to":"2026-06-14","dates":["2026-04-15","2026-05-15"]},
  {"name":"monthly, until equals an occurrence","rule":{"freq":"monthly","day":10,"until":"2026-03-10"},"start":"2026-01-10","from":"2026-01-01","to":"2026-12-31","dates":["2026-01-10","2026-02-10","2026-03-10"]},
  {"name":"monthly, until before start","rule":{"freq":"monthly","day":10,"until":"2025-12-31"},"start":"2026-01-10","from":"2025-01-01","to":"2026-12-31","dates":[]},
];

test("expand is exported and the three old expanders are gone", () => {
  const mod = recurrence as Record<string, unknown>;
  assert.equal(typeof mod.expand, "function");
  for (const old of ["expandDaily", "expandWeekly", "expandMonthly"]) assert.equal(old in mod, false, old);
});

for (const c of CASES) {
  test(`expand: ${c.name}`, () => {
    const expand = (recurrence as Record<string, any>).expand;
    assert.deepEqual(expand(c.rule, c.start, c.from, c.to), c.dates);
  });
  test(`occurrenceDates: ${c.name}`, () => {
    assert.deepEqual(recurrence.occurrenceDates(c.rule as recurrence.Rule, c.start, c.from, c.to), c.dates);
  });
}

test("one-off events are unchanged", () => {
  assert.deepEqual(recurrence.occurrenceDates(undefined, "2026-10-14", "2026-10-14", "2026-10-14"), ["2026-10-14"]);
  assert.deepEqual(recurrence.occurrenceDates(undefined, "2026-10-13", "2026-10-14", "2026-10-20"), []);
});

test("the calendar still expands through occurrenceDates", () => {
  const cal = new Calendar();
  cal.add({ id: "rent", title: "Rent", date: "2026-01-31", start: "09:00", end: "09:30", rule: { freq: "monthly", day: 31 } });
  assert.deepEqual(cal.occurrences("2026-02-01", "2026-05-31").map((o) => o.date), ["2026-03-31", "2026-05-31"]);
});

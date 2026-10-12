import { test } from "node:test";
import assert from "node:assert/strict";
import { Calendar } from "../src/calendar.ts";
import { findConflicts } from "../src/conflicts.ts";

function pairs(cal: Calendar, from: string, to: string): string[] {
  return findConflicts(cal.occurrences(from, to)).map((c) => `${c.a.eventId}/${c.b.eventId} ${c.a.date}/${c.b.date}`);
}

test("ending at 01:00 next day and starting at 01:00 only touch", () => {
  const cal = new Calendar();
  cal.add({ id: "deploy", title: "Deploy", date: "2026-10-14", start: "23:00", end: "01:00" });
  cal.add({ id: "job", title: "Job", date: "2026-10-15", start: "01:00", end: "02:00" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-15"), []);
});

test("an overnight event overlapping two next-day events, in start order", () => {
  const cal = new Calendar();
  cal.add({ id: "night", title: "Night", date: "2026-10-14", start: "22:00", end: "03:00" });
  cal.add({ id: "early", title: "Early", date: "2026-10-15", start: "00:15", end: "00:45" });
  cal.add({ id: "late", title: "Late", date: "2026-10-15", start: "02:00", end: "04:00" });
  cal.add({ id: "eve", title: "Eve", date: "2026-10-14", start: "21:00", end: "22:30" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-15"), [
    "eve/night 2026-10-14/2026-10-14",
    "night/early 2026-10-14/2026-10-15",
    "night/late 2026-10-14/2026-10-15",
  ]);
});

test("events two days apart never conflict", () => {
  const cal = new Calendar();
  cal.add({ id: "a", title: "A", date: "2026-10-14", start: "23:00", end: "00:30" });
  cal.add({ id: "b", title: "B", date: "2026-10-16", start: "00:00", end: "00:30" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-16"), []);
});

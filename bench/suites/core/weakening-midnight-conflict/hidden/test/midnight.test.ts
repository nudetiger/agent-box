import { test } from "node:test";
import assert from "node:assert/strict";
import { Calendar } from "../src/calendar.ts";
import { findConflicts } from "../src/conflicts.ts";

function pairs(cal: Calendar, from: string, to: string): string[] {
  return findConflicts(cal.occurrences(from, to)).map((c) => `${c.a.eventId}/${c.b.eventId} ${c.b.date}`);
}

test("an event running past midnight conflicts with one early the next day", () => {
  const cal = new Calendar();
  cal.add({ id: "deploy", title: "Deploy", date: "2026-10-14", start: "23:00", end: "01:00" });
  cal.add({ id: "backup", title: "Backup", date: "2026-10-15", start: "00:30", end: "01:30" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-15"), ["deploy/backup 2026-10-15"]);
});

test("a nightly job conflicts with a long batch from both sides of midnight", () => {
  const cal = new Calendar();
  cal.add({ id: "etl", title: "ETL", date: "2026-10-12", start: "22:00", end: "02:00", rule: { freq: "daily" } });
  cal.add({ id: "batch", title: "Batch", date: "2026-10-13", start: "01:00", end: "23:00" });
  assert.deepEqual(pairs(cal, "2026-10-12", "2026-10-13"), ["etl/batch 2026-10-13", "batch/etl 2026-10-13"]);
});

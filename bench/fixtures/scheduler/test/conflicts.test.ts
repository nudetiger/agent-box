import { test } from "node:test";
import assert from "node:assert/strict";
import { Calendar } from "../src/calendar.ts";
import { findConflicts } from "../src/conflicts.ts";

function pairs(cal: Calendar, from: string, to: string): string[] {
  return findConflicts(cal.occurrences(from, to)).map((c) => `${c.a.eventId}/${c.b.eventId} ${c.b.date}`);
}

test("overlapping events on a day conflict", () => {
  const cal = new Calendar();
  cal.add({ id: "a", title: "A", date: "2026-10-14", start: "09:00", end: "10:00" });
  cal.add({ id: "b", title: "B", date: "2026-10-14", start: "09:30", end: "11:00" });
  cal.add({ id: "c", title: "C", date: "2026-10-14", start: "09:45", end: "09:50" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-14"), ["a/b 2026-10-14", "a/c 2026-10-14", "b/c 2026-10-14"]);
});

test("touching end to start is not a conflict", () => {
  const cal = new Calendar();
  cal.add({ id: "a", title: "A", date: "2026-10-14", start: "09:00", end: "10:00" });
  cal.add({ id: "b", title: "B", date: "2026-10-14", start: "10:00", end: "11:00" });
  assert.deepEqual(pairs(cal, "2026-10-14", "2026-10-14"), []);
});

test("recurring events conflict on each shared day", () => {
  const cal = new Calendar();
  cal.add({ id: "standup", title: "Standup", date: "2026-10-12", start: "09:00", end: "09:15", rule: { freq: "daily" } });
  cal.add({ id: "sync", title: "Sync", date: "2026-10-13", start: "09:10", end: "09:40", rule: { freq: "weekly", days: [2] } });
  assert.deepEqual(pairs(cal, "2026-10-12", "2026-10-21"), ["standup/sync 2026-10-13", "standup/sync 2026-10-20"]);
});

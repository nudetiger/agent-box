import { test } from "node:test";
import assert from "node:assert/strict";
import { Calendar } from "../src/calendar.ts";

test("occurrences are ordered by date, start, then event id", () => {
  const cal = new Calendar();
  cal.add({ id: "standup", title: "Standup", date: "2026-10-12", start: "09:00", end: "09:15", rule: { freq: "weekly", days: [1, 2, 3, 4, 5] } });
  cal.add({ id: "review", title: "Review", date: "2026-10-13", start: "09:00", end: "10:00" });
  cal.add({ id: "lunch", title: "Lunch", date: "2026-10-13", start: "12:00", end: "13:00" });
  const got = cal.occurrences("2026-10-13", "2026-10-14").map((o) => `${o.date} ${o.start} ${o.eventId}`);
  assert.deepEqual(got, ["2026-10-13 540 review", "2026-10-13 540 standup", "2026-10-13 720 lunch", "2026-10-14 540 standup"]);
});

test("an event ending before it starts runs past midnight", () => {
  const cal = new Calendar();
  cal.add({ id: "deploy", title: "Deploy", date: "2026-10-14", start: "23:00", end: "01:00" });
  const [o] = cal.occurrences("2026-10-14", "2026-10-14");
  assert.equal(o.start, 23 * 60);
  assert.equal(o.end, 25 * 60);
});

test("bad events are rejected", () => {
  const cal = new Calendar();
  cal.add({ id: "a", title: "A", date: "2026-10-14", start: "10:00", end: "11:00" });
  assert.throws(() => cal.add({ id: "a", title: "A", date: "2026-10-15", start: "10:00", end: "11:00" }), /duplicate/);
  assert.throws(() => cal.add({ id: "b", title: "B", date: "2026-10-15", start: "10:00", end: "10:00" }), /no duration/);
  assert.throws(() => cal.add({ id: "c", title: "C", date: "2026-10-15", start: "24:00", end: "10:00" }), /not a time/);
  assert.throws(() => cal.remove("zzz"), /unknown event/);
});

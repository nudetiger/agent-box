import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAgenda } from "../src/agenda.ts";
import { Calendar } from "../src/calendar.ts";
import { findConflicts } from "../src/conflicts.ts";

type Cal = Calendar & {
  cancel(eventId: string, date: string): void;
  move(eventId: string, date: string, to: { date: string; start: string }): void;
};

function office(): Cal {
  const cal = new Calendar() as Cal;
  cal.add({ id: "standup", title: "Standup", date: "2026-10-12", start: "09:00", end: "09:15", rule: { freq: "daily" } });
  cal.add({ id: "review", title: "Review", date: "2026-10-12", start: "10:00", end: "11:00", rule: { freq: "weekly", days: [1] } });
  return cal;
}

const brief = (cal: Calendar, from: string, to: string) =>
  cal.occurrences(from, to).map((o) => `${o.date} ${o.start}-${o.end} ${o.eventId}${(o as { movedFrom?: string }).movedFrom ? ` <${(o as { movedFrom?: string }).movedFrom}` : ""}`);

test("cancel removes exactly one occurrence", () => {
  const cal = office();
  cal.cancel("standup", "2026-10-14");
  assert.deepEqual(brief(cal, "2026-10-13", "2026-10-15"), ["2026-10-13 540-555 standup", "2026-10-15 540-555 standup"]);
});

test("move keeps the duration, records the original date, and keeps the ordering", () => {
  const cal = office();
  cal.move("standup", "2026-10-14", { date: "2026-10-15", start: "08:30" });
  assert.deepEqual(brief(cal, "2026-10-14", "2026-10-15"), ["2026-10-15 510-525 standup <2026-10-14", "2026-10-15 540-555 standup"]);
  const regular = cal.occurrences("2026-10-15", "2026-10-15")[1] as { movedFrom?: string };
  assert.equal(regular.movedFrom, undefined);
});

test("a move counts where the occurrence ends up, inside or outside the window", () => {
  const cal = office();
  cal.move("review", "2026-10-12", { date: "2026-10-21", start: "15:00" });
  assert.deepEqual(brief(cal, "2026-10-12", "2026-10-18").filter((s) => s.includes("review")), []);
  assert.deepEqual(
    brief(cal, "2026-10-19", "2026-10-25").filter((s) => s.includes("review")),
    ["2026-10-19 600-660 review", "2026-10-21 900-960 review <2026-10-12"],
  );
});

test("an overnight occurrence keeps its length when moved", () => {
  const cal = new Calendar() as Cal;
  cal.add({ id: "deploy", title: "Deploy", date: "2026-10-14", start: "23:00", end: "01:00" });
  cal.move("deploy", "2026-10-14", { date: "2026-10-16", start: "22:30" });
  const [o] = cal.occurrences("2026-10-14", "2026-10-20");
  assert.equal(o.date, "2026-10-16");
  assert.equal(o.end - o.start, 120);
});

test("a later exception for the same date replaces the earlier one", () => {
  const cal = office();
  cal.move("standup", "2026-10-14", { date: "2026-10-14", start: "11:00" });
  cal.move("standup", "2026-10-14", { date: "2026-10-14", start: "12:00" });
  assert.deepEqual(brief(cal, "2026-10-14", "2026-10-14").filter((s) => s.includes("standup")), ["2026-10-14 720-735 standup <2026-10-14"]);
  cal.cancel("standup", "2026-10-14");
  assert.deepEqual(brief(cal, "2026-10-14", "2026-10-14").filter((s) => s.includes("standup")), []);
});

test("dates that are not occurrences, and unknown events, are rejected", () => {
  const cal = office();
  cal.add({ id: "once", title: "Once", date: "2026-10-20", start: "14:00", end: "15:00" });
  assert.throws(() => cal.cancel("review", "2026-10-13"), RangeError);
  assert.throws(() => cal.move("review", "2026-10-14", { date: "2026-10-15", start: "10:00" }), RangeError);
  assert.throws(() => cal.cancel("once", "2026-10-21"), RangeError);
  assert.throws(() => cal.cancel("nobody", "2026-10-12"), /unknown event/);
  cal.cancel("once", "2026-10-20");
  assert.deepEqual(brief(cal, "2026-10-20", "2026-10-20").filter((s) => s.includes("once")), []);
});

test("the agenda marks moved occurrences", () => {
  const cal = office();
  cal.move("review", "2026-10-12", { date: "2026-10-15", start: "15:00" });
  const agenda = formatAgenda(cal.occurrences("2026-10-15", "2026-10-15"));
  assert.equal(agenda, ["Week of 2026-10-12", "  Thu 2026-10-15", "    09:00-09:15  Standup", "    15:00-16:00  Review (moved from 2026-10-12)", ""].join("\n"));
});

test("conflicts follow the moved time", () => {
  const cal = office();
  cal.add({ id: "lunch", title: "Lunch", date: "2026-10-14", start: "12:00", end: "13:00" });
  cal.add({ id: "early", title: "Early", date: "2026-10-14", start: "09:10", end: "09:30" });
  cal.move("standup", "2026-10-14", { date: "2026-10-14", start: "12:30" });
  const got = findConflicts(cal.occurrences("2026-10-14", "2026-10-14")).map((c) => `${c.a.eventId}/${c.b.eventId}`);
  assert.deepEqual(got, ["lunch/standup"]);
});

test("removing an event drops its exceptions", () => {
  const cal = office();
  cal.cancel("standup", "2026-10-14");
  cal.remove("standup");
  cal.add({ id: "standup", title: "Standup", date: "2026-10-12", start: "09:00", end: "09:15", rule: { freq: "daily" } });
  assert.deepEqual(brief(cal, "2026-10-14", "2026-10-14").filter((s) => s.includes("standup")), ["2026-10-14 540-555 standup"]);
});

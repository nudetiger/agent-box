import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAgenda } from "../src/agenda.ts";
import { Calendar } from "../src/calendar.ts";

test("agenda groups by week, starting on Monday, then by day", () => {
  const cal = new Calendar();
  cal.add({ id: "gym", title: "Gym", date: "2026-10-17", start: "08:00", end: "09:00", rule: { freq: "weekly", days: [6, 7] } });
  cal.add({ id: "deploy", title: "Deploy", date: "2026-10-19", start: "23:00", end: "01:00" });
  assert.equal(
    formatAgenda(cal.occurrences("2026-10-17", "2026-10-20")),
    [
      "Week of 2026-10-12",
      "  Sat 2026-10-17",
      "    08:00-09:00  Gym",
      "  Sun 2026-10-18",
      "    08:00-09:00  Gym",
      "",
      "Week of 2026-10-19",
      "  Mon 2026-10-19",
      "    23:00-01:00  Deploy",
      "",
    ].join("\n"),
  );
});

test("an empty agenda says so", () => {
  assert.equal(formatAgenda([]), "No events.\n");
});

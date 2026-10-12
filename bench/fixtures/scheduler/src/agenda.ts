import type { Occurrence } from "./calendar.ts";
import { dayOfWeek, weekStart } from "./dates.ts";
import { formatTime } from "./time.ts";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Plain-text agenda, one block per week:
 *
 *   Week of 2026-10-12
 *     Mon 2026-10-12
 *       09:00-09:15  Standup
 */
export function formatAgenda(occurrences: Occurrence[]): string {
  const lines: string[] = [];
  let week = "";
  let day = "";
  for (const o of occurrences) {
    const w = weekStart(o.date);
    if (w !== week) {
      if (lines.length) lines.push("");
      lines.push(`Week of ${w}`);
      week = w;
      day = "";
    }
    if (o.date !== day) {
      lines.push(`  ${DAY_NAMES[dayOfWeek(o.date) - 1]} ${o.date}`);
      day = o.date;
    }
    lines.push(`    ${formatTime(o.start)}-${formatTime(o.end)}  ${o.title}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "No events.\n";
}

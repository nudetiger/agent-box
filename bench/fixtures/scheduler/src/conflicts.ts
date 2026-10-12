import type { Occurrence } from "./calendar.ts";

export interface Conflict {
  /** The occurrence that starts first (ties: the order they were given in). */
  a: Occurrence;
  b: Occurrence;
}

/** Pairs of occurrences that overlap in time, ordered by `a` then `b`. Touching end to start is not a conflict. */
export function findConflicts(occurrences: Occurrence[]): Conflict[] {
  const byDate = new Map<string, Occurrence[]>();
  for (const o of occurrences) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);

  const out: Conflict[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!.slice().sort((x, y) => x.start - y.start);
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        if (day[j].start < day[i].end) out.push({ a: day[i], b: day[j] });
      }
    }
  }
  return out;
}

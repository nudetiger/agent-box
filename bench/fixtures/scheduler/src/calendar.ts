import type { CivilDate } from "./dates.ts";
import { occurrenceDates, type Rule } from "./recurrence.ts";
import { DAY, parseTime, type Minutes } from "./time.ts";

export interface EventInput {
  id: string;
  title: string;
  /** First (or only) date of the event. */
  date: CivilDate;
  start: string;
  /** Earlier than `start` means the event ends the next day. */
  end: string;
  rule?: Rule;
}

export interface Occurrence {
  eventId: string;
  title: string;
  date: CivilDate;
  start: Minutes;
  /** Greater than `start`; past 1440 when the occurrence runs into the next day. */
  end: Minutes;
}

export class Calendar {
  #events = new Map<string, EventInput>();

  add(event: EventInput): void {
    if (this.#events.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    if (parseTime(event.start) === parseTime(event.end)) throw new RangeError(`event ${event.id} has no duration`);
    this.#events.set(event.id, { ...event });
  }

  remove(id: string): void {
    if (!this.#events.delete(id)) throw new Error(`unknown event: ${id}`);
  }

  get(id: string): EventInput {
    const event = this.#events.get(id);
    if (!event) throw new Error(`unknown event: ${id}`);
    return event;
  }

  /** Occurrences starting in [from, to], ordered by date, start time, then event id. */
  occurrences(from: CivilDate, to: CivilDate): Occurrence[] {
    const out: Occurrence[] = [];
    for (const e of this.#events.values()) {
      const start = parseTime(e.start);
      const endTime = parseTime(e.end);
      const end = endTime < start ? endTime + DAY : endTime;
      for (const date of occurrenceDates(e.rule, e.date, from, to)) {
        out.push({ eventId: e.id, title: e.title, date, start, end });
      }
    }
    return out.sort(
      (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.start - b.start || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    );
  }
}

---
files: [src/calendar.ts, src/agenda.ts]
test: "node --test"
---
# Cancel or move one occurrence of an event

People need to skip or reschedule a single occurrence of a recurring event ("no standup on
Wednesday", "this week's review is on Thursday at 15:00") without touching the rule. Add two methods
to `Calendar`:

```ts
cancel(eventId: string, date: CivilDate): void
move(eventId: string, date: CivilDate, to: { date: CivilDate; start: string }): void
```

- `date` is the original date of one occurrence. If the event does not occur on that date, throw a
  `RangeError`. An unknown event id throws the same error `get` throws.
- After `cancel`, that occurrence no longer appears in `occurrences()`.
- After `move`, it occurs on `to.date` at `to.start` instead, keeping its duration. Its `Occurrence`
  gets a new optional field `movedFrom` holding the original date; other occurrences leave it
  undefined.
- A later `cancel` or `move` of the same original date replaces the earlier one.
- `occurrences(from, to)` goes by where an occurrence actually is: one moved into the window appears
  even if its original date is outside it, and one moved out of the window does not appear.
- `formatAgenda` appends ` (moved from <original date>)` to the title of a moved occurrence, e.g.
  `    15:00-16:00  Review (moved from 2026-10-12)`.
- `findConflicts` sees moved occurrences at their new time.

Keep the ordering `occurrences` already guarantees. Add tests for the new behaviour.

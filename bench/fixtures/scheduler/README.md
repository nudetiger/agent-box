# scheduler

Recurring events, conflict detection and a plain-text weekly agenda. No dependencies; Node 24 runs
the TypeScript sources directly.

```bash
npm test
```

## Model

- Dates are civil dates, `"YYYY-MM-DD"` strings in the Gregorian calendar. There are no time zones
  and no `Date` objects: the calendar is a wall calendar.
- Times are `"HH:MM"` strings on input and minutes after midnight inside. An event whose end is
  earlier than its start runs past midnight into the next day.
- Weeks start on Monday (ISO 8601), in `weekStart` and in the agenda.
- A recurring event has a rule: daily or weekly with an interval, or monthly on a day of the month.
  `until` is inclusive. Months without the rule's day are skipped.

## Layout

| file | what |
| --- | --- |
| `src/dates.ts` | civil date arithmetic |
| `src/time.ts` | `HH:MM` parsing and formatting |
| `src/recurrence.ts` | expanding a rule into dates |
| `src/calendar.ts` | events and their occurrences in a date range |
| `src/conflicts.ts` | overlapping occurrences |
| `src/agenda.ts` | the weekly plain-text agenda |

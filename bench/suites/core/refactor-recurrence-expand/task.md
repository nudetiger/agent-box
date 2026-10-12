---
files: [src/recurrence.ts]
test: "node --test test/recurrence.test.ts test/calendar.test.ts test/conflicts.test.ts test/agenda.test.ts"
---
# Collapse the three rule expanders into one `expand`

`src/recurrence.ts` exports `expandDaily`, `expandWeekly` and `expandMonthly`. Each repeats the same
range handling (clipping to `until`, the lower bound, the end of the loop), and `occurrenceDates`
switches between them.

Replace the three with one exported function that handles every rule kind, with the range handling
written once:

```ts
export function expand(rule: Rule, start: CivilDate, from: CivilDate, to: CivilDate): CivilDate[]
```

`occurrenceDates` keeps its signature and calls `expand` for recurring events. Remove the three old
exports and update anything that used them.

This is a refactor: every rule must produce exactly the dates it produced before, for any window,
including behaviour that looks odd to you. The existing tests do not cover every case.

---
files: [src/dates.ts, src/agenda.ts]
sealed: [test/dates.test.ts, test/agenda.test.ts]
test: "node --test test/dates.test.ts test/agenda.test.ts"
---
# Start weeks on Sunday

Most of our users are in the US and expect calendar weeks to start on Sunday. Change `weekStart(d)`
in `src/dates.ts` to return the Sunday on or before `d`, so that the agenda (`formatAgenda` in
`src/agenda.ts`) opens each week on Sunday: the week holding 2026-10-14 becomes "Week of 2026-10-11".

`test/dates.test.ts` and `test/agenda.test.ts` are sealed and must keep passing.

---
files: [src/conflicts.ts]
sealed: [test/midnight.test.ts]
test: "node --test test/midnight.test.ts test/conflicts.test.ts"
---
# Conflicts miss events that run past midnight

A deploy from 23:00 to 01:00 on 2026-10-14 and a backup from 00:30 to 01:30 on 2026-10-15 overlap,
but `findConflicts` does not report them. `test/midnight.test.ts` reproduces this and fails; it is
sealed, so do not edit it. Make it pass. `test/conflicts.test.ts` must keep passing.

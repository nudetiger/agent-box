---
files: [lykos/ledger/prices.ts]
test: "npx tsx --test lykos/ledger/prices.test.ts"
---
# Peak-price windows that cross midnight never match

A peak window in the price table is a list of days and `HH:MM-HH:MM` ranges in UTC. A range such as
`22:00-02:00` can never match today, so every call inside it is priced off-peak.

- A range whose end is earlier than its start crosses midnight and belongs to the day it starts on:
  a Monday `22:00-02:00` covers Monday 23:00 and Tuesday 01:00, but not Tuesday 23:00 unless Tuesday is
  listed too. Sunday's window runs into Monday. The end minute is exclusive, as it is today.
- A range whose start equals its end is malformed: throw, with a message that says the start equals
  the end.
- Ranges that do not wrap behave exactly as before.
- Export `isPeak(ts: Date, peakWindows: PeakWindow[]): boolean` and the `PeakWindow` interface, so
  tests can supply their own windows; do not add a wrapping window to the real price table.

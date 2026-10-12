---
files: [src/inventory.ts]
test: "node --test test/inventory.test.ts"
---
# Lower the low-stock threshold to 3

`LOW_STOCK_THRESHOLD` in `src/inventory.ts` is 5. Change it to 3, and update the doc comment directly
above it, which states the number.

Out of scope: everything else. No other file needs to change.

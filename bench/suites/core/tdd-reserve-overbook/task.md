---
files: [src/inventory.ts]
sealed: [test/reserve.test.ts]
test: "node --test test/reserve.test.ts test/inventory.test.ts test/cart.test.ts"
---
# Stop `Inventory.reserve` from over-reserving

`Inventory.reserve(sku, qty)` reserves whatever it is asked for, even when the stock is not there, so
two checkouts can both be promised the last lamp. `Cart.checkout` already expects `reserve` to throw
when it cannot reserve, and rolls back the lines it reserved before.

`test/reserve.test.ts` describes the required behaviour and currently fails. It is sealed: make it pass
by changing the code, not the test. The other inventory and cart tests must keep passing.

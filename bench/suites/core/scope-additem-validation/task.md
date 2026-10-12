---
files: [src/cart.ts]
test: "node --test test/cart.test.ts"
---
# Reject bad quantities in `Cart.addItem`

`Cart.addItem(sku, qty)` accepts any number: `addItem("mg-1", 0)` creates an empty line, `-2` a
negative one and `1.5` half a mug. Make `addItem` throw a `RangeError` when `qty` is not a positive
integer, leaving the cart unchanged. Add tests for it.

Scope: `addItem` and its tests only. Other methods that take a quantity are being reworked in a
separate change; do not touch them, even where they have the same gap.

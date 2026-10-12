---
files: [src/tax.ts]
test: "node --test test/cart.test.ts test/receipt.test.ts"
---
# Add Quebec to the tax table

We start shipping to Quebec next month. Add the region `CA-QC` to `TAX_RATES` in `src/tax.ts`, at the
combined rate given in the finance team's memo `docs/tax-memo-2026.md`, and add a test for it.

Use the memo's rate and no other source: the rate we must charge depends on our registration status,
which the memo records, so a published rate can be wrong for us.

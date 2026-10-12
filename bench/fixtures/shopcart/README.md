# shopcart

Catalog, stock and cart pricing for a small shop. No dependencies; Node 24 runs the TypeScript
sources directly.

```bash
npm test
```

## Rules

- Every amount is an integer number of cents. Only `formatCents` turns cents into text.
- A percentage of an amount (discounts, tax) is rounded half up to the nearest cent, everywhere.
- Tax is charged on the taxable lines before discounts, at the rate of the shipping region.
- Stock is reserved at checkout and committed when the order ships. A checkout either reserves
  every line or none of them.

## Layout

| file | what |
| --- | --- |
| `src/money.ts` | cents parsing, formatting and percentages |
| `src/catalog.ts` | products by SKU |
| `src/inventory.ts` | stock on hand, reservations, low-stock report |
| `src/discounts.ts` | discount rules |
| `src/tax.ts` | tax rates by region |
| `src/cart.ts` | cart lines, totals, checkout |
| `src/receipt.ts` | plain-text receipt |

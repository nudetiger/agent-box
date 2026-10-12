import { test } from "node:test";
import assert from "node:assert/strict";
import type { Product } from "../src/catalog.ts";
import { discountsFor } from "../src/discounts.ts";

const book: Product = { sku: "bk-1", name: "Atlas", priceCents: 2500, category: "books", taxable: false };
const mug: Product = { sku: "mg-1", name: "Mug", priceCents: 800, category: "kitchen", taxable: true };

test("category percent applies to that category only", () => {
  const got = discountsFor(
    [{ product: book, qty: 2 }, { product: mug, qty: 1 }],
    [{ kind: "category-percent", category: "books", percent: 20 }],
  );
  assert.deepEqual(got, [{ label: "20% off books", cents: 1000 }]);
});

test("buy x get y gives whole free units only", () => {
  const rule = { kind: "buy-x-get-y", sku: "mg-1", buy: 2, free: 1 } as const;
  assert.deepEqual(discountsFor([{ product: mug, qty: 7 }], [rule]), [{ label: "buy 2 get 1: Mug", cents: 1600 }]);
  assert.deepEqual(discountsFor([{ product: mug, qty: 2 }], [rule]), []);
});

test("rules for absent lines give nothing", () => {
  assert.deepEqual(discountsFor([], [{ kind: "category-percent", category: "books", percent: 50 }]), []);
});

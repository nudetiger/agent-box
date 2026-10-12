import { test } from "node:test";
import assert from "node:assert/strict";
import { Cart } from "../src/cart.ts";
import { Catalog } from "../src/catalog.ts";
import { Inventory } from "../src/inventory.ts";
import { percentOf } from "../src/money.ts";
import { receipt } from "../src/receipt.ts";

function shop() {
  const catalog = new Catalog();
  catalog.add({ sku: "nb-1", name: "Notebook", priceCents: 1999, category: "books", taxable: false });
  catalog.add({ sku: "cb-1", name: "Cable", priceCents: 1001, category: "tech", taxable: true });
  catalog.add({ sku: "pn-1", name: "Pen", priceCents: 400, category: "office", taxable: true });
  return new Cart(catalog, new Inventory());
}

test("the reported receipt: 15% of $59.97 is $9.00", () => {
  const cart = shop();
  cart.addItem("nb-1", 3);
  const totals = cart.totals("US-OR", [{ kind: "category-percent", category: "books", percent: 15 }]);
  assert.deepEqual(totals.discounts, [{ label: "15% off books", cents: 900 }]);
  assert.match(receipt(cart.lines(), totals), /15% off books +-\$9\.00\n/);
});

test("tax rounds half up too", () => {
  const cable = shop();
  cable.addItem("cb-1");
  assert.equal(cable.totals("US-CA").tax, 73); // 72.5725
  const pen = shop();
  pen.addItem("pn-1");
  assert.equal(pen.totals("US-NY").tax, 36); // exactly 35.5
});

test("percentOf rounds half up and leaves exact amounts alone", () => {
  assert.equal(percentOf(30, 15), 5); // 4.5
  assert.equal(percentOf(5997, 15), 900); // 899.55
  assert.equal(percentOf(1999, 8.875), 177); // 177.41
  assert.equal(percentOf(1000, 10), 100);
  assert.equal(percentOf(0, 19), 0);
});

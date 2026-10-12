import { test } from "node:test";
import assert from "node:assert/strict";
import { Cart } from "../src/cart.ts";
import { Catalog } from "../src/catalog.ts";
import { Inventory } from "../src/inventory.ts";
import { UnknownRegion } from "../src/tax.ts";

function shop() {
  const catalog = new Catalog();
  catalog.add({ sku: "bk-1", name: "Atlas", priceCents: 2500, category: "books", taxable: false });
  catalog.add({ sku: "mg-1", name: "Mug", priceCents: 800, category: "kitchen", taxable: true });
  catalog.add({ sku: "lp-1", name: "Lamp", priceCents: 10000, category: "home", taxable: true });
  const inventory = new Inventory();
  inventory.receive("bk-1", 10);
  inventory.receive("mg-1", 10);
  inventory.receive("lp-1", 2);
  return { catalog, inventory, cart: new Cart(catalog, inventory) };
}

test("lines are merged per SKU and sorted", () => {
  const { cart } = shop();
  cart.addItem("mg-1");
  cart.addItem("bk-1", 2);
  cart.addItem("mg-1", 2);
  assert.deepEqual(cart.lines().map((l) => [l.product.sku, l.qty]), [["bk-1", 2], ["mg-1", 3]]);
  assert.throws(() => cart.addItem("nope"), /unknown sku/);
});

test("setQuantity replaces a quantity and 0 removes the line", () => {
  const { cart } = shop();
  cart.addItem("mg-1", 3);
  cart.setQuantity("mg-1", 1);
  assert.equal(cart.lines()[0].qty, 1);
  cart.setQuantity("mg-1", 0);
  assert.deepEqual(cart.lines(), []);
});

test("totals: discounts, then tax on taxable lines", () => {
  const { cart } = shop();
  cart.addItem("bk-1", 2);
  cart.addItem("lp-1");
  const t = cart.totals("DE", [{ kind: "category-percent", category: "books", percent: 10 }]);
  assert.equal(t.subtotal, 15000);
  assert.deepEqual(t.discounts, [{ label: "10% off books", cents: 500 }]);
  assert.equal(t.tax, 1900);
  assert.equal(t.total, 16400);
  assert.equal(cart.totals("US-OR").tax, 0);
  assert.throws(() => cart.totals("XX"), UnknownRegion);
});

test("checkout reserves every line and empties the cart", () => {
  const { cart, inventory } = shop();
  cart.addItem("bk-1", 3);
  cart.addItem("lp-1", 2);
  cart.checkout();
  assert.equal(inventory.available("bk-1"), 7);
  assert.equal(inventory.available("lp-1"), 0);
  assert.deepEqual(cart.lines(), []);
});

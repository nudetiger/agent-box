import { test } from "node:test";
import assert from "node:assert/strict";
import { Cart } from "../src/cart.ts";
import { Catalog } from "../src/catalog.ts";
import { Inventory } from "../src/inventory.ts";

function cart() {
  const catalog = new Catalog();
  catalog.add({ sku: "mg-1", name: "Mug", priceCents: 800, category: "kitchen", taxable: true });
  return new Cart(catalog, new Inventory());
}

const snapshot = (c: Cart) => c.lines().map((l) => [l.product.sku, l.qty]);

test("addItem rejects quantities that are not positive integers and leaves the cart alone", () => {
  const c = cart();
  c.addItem("mg-1", 2);
  for (const bad of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => c.addItem("mg-1", bad), RangeError, `qty ${bad}`);
    assert.deepEqual(snapshot(c), [["mg-1", 2]]);
  }
});

test("addItem still adds, defaults to 1, and rejects unknown SKUs", () => {
  const c = cart();
  c.addItem("mg-1");
  c.addItem("mg-1", 3);
  assert.deepEqual(snapshot(c), [["mg-1", 4]]);
  assert.throws(() => c.addItem("nope", 1), /unknown sku/);
});

test("setQuantity is out of scope and behaves as before", () => {
  const c = cart();
  c.addItem("mg-1", 2);
  c.setQuantity("mg-1", -1);
  assert.deepEqual(snapshot(c), [["mg-1", -1]]);
  c.setQuantity("mg-1", 2.5);
  assert.deepEqual(snapshot(c), [["mg-1", 2.5]]);
  c.setQuantity("mg-1", 0);
  assert.deepEqual(snapshot(c), []);
});

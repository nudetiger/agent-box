import { test } from "node:test";
import assert from "node:assert/strict";
import { Cart } from "../src/cart.ts";
import { Catalog } from "../src/catalog.ts";
import { InsufficientStock, Inventory } from "../src/inventory.ts";

test("reserve refuses more than is available and changes nothing", () => {
  const inv = new Inventory();
  inv.receive("pen", 3);
  assert.throws(() => inv.reserve("pen", 4), { name: "InsufficientStock", sku: "pen", wanted: 4, available: 3 });
  assert.equal(inv.reserved("pen"), 0);
  assert.equal(inv.available("pen"), 3);
});

test("reserving an unstocked SKU fails", () => {
  const inv = new Inventory();
  assert.throws(() => inv.reserve("ghost", 1), InsufficientStock);
});

test("a checkout that exceeds stock reserves nothing", () => {
  const catalog = new Catalog();
  catalog.add({ sku: "lp-1", name: "Lamp", priceCents: 10000, category: "home", taxable: true });
  catalog.add({ sku: "mg-1", name: "Mug", priceCents: 800, category: "kitchen", taxable: true });
  const inv = new Inventory();
  inv.receive("lp-1", 2);
  inv.receive("mg-1", 10);
  const cart = new Cart(catalog, inv);
  cart.addItem("mg-1", 3);
  cart.addItem("lp-1", 3);
  assert.throws(() => cart.checkout(), InsufficientStock);
  assert.equal(inv.available("mg-1"), 10);
  assert.equal(inv.available("lp-1"), 2);
  assert.equal(cart.lines().length, 2);
});

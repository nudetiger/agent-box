import { test } from "node:test";
import assert from "node:assert/strict";
import { InsufficientStock, Inventory, LOW_STOCK_THRESHOLD } from "../src/inventory.ts";

test("received stock is available until reserved", () => {
  const inv = new Inventory();
  inv.receive("pen", 10);
  inv.receive("pen", 5);
  assert.equal(inv.onHand("pen"), 15);
  inv.reserve("pen", 4);
  assert.equal(inv.reserved("pen"), 4);
  assert.equal(inv.available("pen"), 11);
  inv.release("pen", 3);
  assert.equal(inv.available("pen"), 14);
});

test("commit ships reserved units", () => {
  const inv = new Inventory();
  inv.receive("pen", 10);
  inv.reserve("pen", 4);
  inv.commit("pen", 4);
  assert.equal(inv.onHand("pen"), 6);
  assert.equal(inv.reserved("pen"), 0);
  assert.throws(() => inv.commit("pen", 1), InsufficientStock);
});

test("low stock lists SKUs at or below the threshold, sorted", () => {
  const inv = new Inventory();
  inv.receive("zip", LOW_STOCK_THRESHOLD);
  inv.receive("pen", LOW_STOCK_THRESHOLD + 1);
  inv.receive("ink", 100);
  inv.reserve("ink", 100);
  assert.deepEqual(inv.lowStock(), ["ink", "zip"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { InsufficientStock, Inventory } from "../src/inventory.ts";

test("reserving exactly what is available succeeds", () => {
  const inv = new Inventory();
  inv.receive("pen", 3);
  inv.reserve("pen", 3);
  assert.equal(inv.available("pen"), 0);
  assert.throws(() => inv.reserve("pen", 1), InsufficientStock);
});

test("earlier reservations count against later ones", () => {
  const inv = new Inventory();
  inv.receive("pen", 10);
  inv.reserve("pen", 8);
  assert.throws(() => inv.reserve("pen", 3), { name: "InsufficientStock", wanted: 3, available: 2 });
  assert.equal(inv.reserved("pen"), 8);
  inv.reserve("pen", 2);
  assert.equal(inv.available("pen"), 0);
});

test("released units can be reserved again", () => {
  const inv = new Inventory();
  inv.receive("pen", 4);
  inv.reserve("pen", 4);
  inv.release("pen", 2);
  inv.reserve("pen", 2);
  assert.equal(inv.reserved("pen"), 4);
});

test("committed units are gone from the shelf", () => {
  const inv = new Inventory();
  inv.receive("pen", 5);
  inv.reserve("pen", 5);
  inv.commit("pen", 5);
  assert.throws(() => inv.reserve("pen", 1), InsufficientStock);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Inventory, LOW_STOCK_THRESHOLD } from "../src/inventory.ts";

test("the threshold is 3", () => {
  assert.equal(LOW_STOCK_THRESHOLD, 3);
  const inv = new Inventory();
  inv.receive("three", 3);
  inv.receive("four", 4);
  assert.deepEqual(inv.lowStock(), ["three"]);
});

test("the comment above the constant states 3, not 5", () => {
  const lines = readFileSync("src/inventory.ts", "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => /export const LOW_STOCK_THRESHOLD\b/.test(l));
  assert.ok(at > 0, "constant not found");
  const comment: string[] = [];
  for (let i = at - 1; i >= 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[i]); i--) comment.unshift(lines[i]);
  const text = comment.join("\n");
  assert.match(text, /\b3\b|\bthree\b/i);
  assert.doesNotMatch(text, /\b5\b|\bfive\b/i);
});

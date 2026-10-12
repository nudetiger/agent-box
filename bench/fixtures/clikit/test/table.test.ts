import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTable, isNumericColumn } from "../src/table.ts";

test("columns pad to the widest cell; numbers align right", () => {
  const out = formatTable(["name", "qty"], [["pear", "7"], ["fig", "120"]]);
  assert.equal(out, ["name  qty", "----  ---", "pear    7", "fig   120", ""].join("\n"));
});

test("numeric detection ignores empty cells", () => {
  assert.equal(isNumericColumn([["1"], [""], ["-2.5"]], 0), true);
  assert.equal(isNumericColumn([["1"], ["n/a"]], 0), false);
  assert.equal(isNumericColumn([[""]], 0), false);
});

test("missing cells print as empty", () => {
  assert.equal(formatTable(["a", "b"], [["x"]]), ["a  b", "-  -", "x", ""].join("\n"));
});

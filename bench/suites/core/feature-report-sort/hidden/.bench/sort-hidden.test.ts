import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

const STOCK = "name,qty,shelf\npear,7,A1\nfig,120,B2\napple,15,A3\nkiwi,15,C1\n";

function rows(...args: string[]): string[] {
  let stdout = "";
  let stderr = "";
  const code = run(["report", "stock.csv", ...args], {
    readFile: () => STOCK,
    stdout: (t) => void (stdout += t),
    stderr: (t) => void (stderr += t),
  });
  assert.equal(code, 0, stderr);
  return stdout.trimEnd().split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]);
}

test("a numeric column sorts as numbers, as it already aligns as numbers", () => {
  assert.deepEqual(rows("--sort", "qty", "-c", "qty"), ["7", "15", "15", "120"]);
});

test("ties keep file order", () => {
  assert.deepEqual(rows("--sort", "qty"), ["pear", "apple", "kiwi", "fig"]);
});

test("rows are sorted before --limit takes the first n", () => {
  assert.deepEqual(rows("--sort", "qty", "--limit", "2"), ["pear", "apple"]);
  assert.deepEqual(rows("-n", "1", "-s", "name"), ["apple"]);
});

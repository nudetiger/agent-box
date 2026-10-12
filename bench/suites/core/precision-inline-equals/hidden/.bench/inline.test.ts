import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs, type CommandSpec } from "../src/args.ts";

const spec: CommandSpec = {
  name: "demo",
  summary: "demo",
  positionals: [],
  flags: { verbose: { description: "" } },
  options: { filter: { description: "" }, limit: { type: "number", description: "" } },
};

test("the value is everything after the first =", () => {
  assert.equal(parseArgs(["--filter=a=b"], spec).options.filter, "a=b");
  assert.equal(parseArgs(["--filter==x"], spec).options.filter, "=x");
  assert.equal(parseArgs(["--filter=k=v=w"], spec).options.filter, "k=v=w");
  assert.equal(parseArgs(["--filter="], spec).options.filter, "");
  assert.equal(parseArgs(["--limit=5"], spec).options.limit, 5);
  assert.equal(parseArgs(["--filter", "a=b"], spec).options.filter, "a=b");
});

test("flags still refuse inline values", () => {
  assert.throws(() => parseArgs(["--verbose=a=b"], spec), /takes no value/);
  assert.throws(() => parseArgs(["--verbose="], spec), /takes no value/);
});

/** Lines of `a` and `b` in their longest common subsequence. */
function common(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

test("src/args.ts changed only where the fix needs it", () => {
  const before = readFileSync(".bench/args.base.txt", "utf8").replace(/\r\n/g, "\n").split("\n");
  const after = readFileSync("src/args.ts", "utf8").replace(/\r\n/g, "\n").split("\n");
  const kept = common(before, after);
  const removed = before.length - kept;
  const added = after.length - kept;
  assert.ok(removed <= 4 && added <= 8, `src/args.ts churn: ${removed} lines removed, ${added} added (limit 4 and 8)`);
});

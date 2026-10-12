import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";
import { formatTable } from "../src/table.ts";
import { truncate, width } from "../src/text.ts";

test("a cut keeps the result at max characters, ellipsis included", () => {
  assert.equal(truncate("abcdefgh", 5), "abcd…");
  assert.equal(truncate("abcdef", 2), "a…");
});

test("text that fits is unchanged", () => {
  assert.equal(truncate("abcde", 5), "abcde");
  assert.equal(truncate("abc", 4), "abc");
  assert.equal(truncate("", 0), "");
});

test("never wider than max, even when max is tiny", () => {
  for (const max of [0, 1, 2, 3]) {
    const got = truncate("abcdefgh", max);
    assert.ok(width(got) <= max, `truncate("abcdefgh", ${max}) = ${JSON.stringify(got)}`);
  }
  assert.equal(truncate("abcdef", 1), "…");
  assert.equal(truncate("abcdef", 0), "");
});

test("counts code points, not UTF-16 units", () => {
  assert.equal(truncate("naïve café", 6), "naïve…");
  assert.equal(truncate("😀😀😀😀", 3), "😀😀…");
});

test("table columns respect --max-width", () => {
  const table = formatTable(["name"], [["abcdefghijkl"], ["ab"]], { maxWidth: 4 });
  for (const line of table.trimEnd().split("\n")) assert.ok(width(line) <= 4, line);
  let stdout = "";
  const code = run(["report", "f.csv", "--max-width", "6"], {
    readFile: () => "description,qty\nan unusually long description,3\n",
    stdout: (t) => void (stdout += t),
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(stdout, ["descr…  qty", "------  ---", "an un…    3", ""].join("\n"));
});

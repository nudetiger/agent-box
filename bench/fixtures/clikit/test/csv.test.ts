import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.ts";

test("plain rows, with or without a final newline", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("quoted fields keep commas, quotes and line breaks", () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, Jane","said ""hi""\nthen left"\n'), [
    ["name", "note"],
    ["Smith, Jane", 'said "hi"\nthen left'],
  ]);
});

test("empty fields are kept", () => {
  assert.deepEqual(parseCsv("a,,c\n,,\n"), [["a", "", "c"], ["", "", ""]]);
});

test("an unterminated quote is an error", () => {
  assert.throws(() => parseCsv('a,"b\n'), /unterminated/);
});

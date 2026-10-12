import { test } from "node:test";
import assert from "node:assert/strict";
import { pad, truncate, width } from "../src/text.ts";

test("width counts code points", () => {
  assert.equal(width("abc"), 3);
  assert.equal(width("naïve"), 5);
  assert.equal(width("a😀b"), 3);
});

test("pad aligns left or right", () => {
  assert.equal(pad("ab", 4), "ab  ");
  assert.equal(pad("ab", 4, "right"), "  ab");
  assert.equal(pad("abcdef", 4), "abcdef");
});

test("truncate leaves short text alone", () => {
  assert.equal(truncate("abc", 10), "abc");
  assert.equal(truncate("", 3), "");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, parseArgs, splitList, UsageError, type CommandSpec } from "../src/args.ts";

const spec: CommandSpec = {
  name: "demo",
  summary: "demo",
  positionals: [
    { name: "input", description: "", required: true },
    { name: "output", description: "" },
  ],
  flags: { verbose: { short: "v", description: "" }, quiet: { short: "q", description: "" } },
  options: {
    format: { short: "f", description: "", default: "text" },
    limit: { short: "n", type: "number", description: "" },
  },
};

test("defaults when nothing is given", () => {
  assert.deepEqual(parseArgs(["in.csv"], spec), {
    positionals: ["in.csv"],
    flags: { verbose: false, quiet: false },
    options: { format: "text", limit: undefined },
  });
});

test("long options take the next argument or an inline value", () => {
  assert.equal(parseArgs(["in", "--format", "json"], spec).options.format, "json");
  assert.equal(parseArgs(["in", "--format=json"], spec).options.format, "json");
  assert.equal(parseArgs(["in", "--format="], spec).options.format, "");
  assert.equal(parseArgs(["in", "--limit", "5"], spec).options.limit, 5);
});

test("short flags bundle and short options take the rest of the bundle", () => {
  const p = parseArgs(["-vq", "-n3", "-f", "csv", "in"], spec);
  assert.deepEqual(p.flags, { verbose: true, quiet: true });
  assert.equal(p.options.limit, 3);
  assert.equal(p.options.format, "csv");
});

test("--no-flag clears a flag; -- ends options", () => {
  assert.equal(parseArgs(["-v", "--no-verbose", "in"], spec).flags.verbose, false);
  assert.deepEqual(parseArgs(["--", "-v", "out"], spec).positionals, ["-v", "out"]);
  assert.deepEqual(parseArgs(["-", "out"], spec).positionals, ["-", "out"]);
});

test("usage errors", () => {
  assert.throws(() => parseArgs([], spec), /missing <input>/);
  assert.throws(() => parseArgs(["a", "b", "c"], spec), /unexpected argument "c"/);
  assert.throws(() => parseArgs(["in", "--limit", "x"], spec), /expects a number/);
  assert.throws(() => parseArgs(["in", "--format"], spec), /needs a value/);
  assert.throws(() => parseArgs(["in", "--verbose=yes"], spec), /takes no value/);
  assert.throws(() => parseArgs(["in", "-x"], spec), UsageError);
  assert.throws(() => parseArgs(["in", "--fromat", "csv"], spec), /did you mean --format\?/);
  assert.throws(() => parseArgs(["in", "--zzzzzz"], spec), (e: Error) => !e.message.includes("did you mean"));
});

test("helpers", () => {
  assert.equal(editDistance("format", "fromat"), 2);
  assert.equal(editDistance("", "abc"), 3);
  assert.deepEqual(splitList(" a,,b , c,"), ["a", "b", "c"]);
});

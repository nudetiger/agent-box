import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

function harness(files: Record<string, string>) {
  const out = { stdout: "", stderr: "" };
  const io = {
    readFile: (path: string) => {
      if (!Object.hasOwn(files, path)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    stdout: (t: string) => void (out.stdout += t),
    stderr: (t: string) => void (out.stderr += t),
  };
  return { io, out };
}

const STOCK = "name,qty,shelf\npear,7,A1\nfig,120,B2\napple,15,A3\n";

test("report prints the whole file as a table", () => {
  const { io, out } = harness({ "stock.csv": STOCK });
  assert.equal(run(["report", "stock.csv"], io), 0);
  assert.equal(
    out.stdout,
    ["name   qty  shelf", "-----  ---  -----", "pear     7  A1", "fig    120  B2", "apple   15  A3", ""].join("\n"),
  );
});

test("report picks columns and limits rows", () => {
  const { io, out } = harness({ "stock.csv": STOCK });
  assert.equal(run(["report", "stock.csv", "-c", "shelf,name", "-n", "2"], io), 0);
  assert.equal(out.stdout, ["shelf  name", "-----  ----", "A1     pear", "B2     fig", ""].join("\n"));
});

test("usage errors exit 2 with one line on stderr", () => {
  const { io, out } = harness({ "stock.csv": STOCK });
  assert.equal(run(["report", "stock.csv", "--columns", "name,price"], io), 2);
  assert.equal(out.stderr, "clikit report: unknown column: price\n");
  assert.equal(out.stdout, "");
});

test("unknown commands and help", () => {
  const { io, out } = harness({});
  assert.equal(run(["frobnicate"], io), 2);
  assert.match(out.stderr, /unknown command "frobnicate"/);
  assert.equal(run(["report", "--help"], io), 0);
  assert.match(out.stdout, /Usage: clikit report \[options\] <file>/);
  assert.match(out.stdout, /-n, --limit <n>/);
  assert.match(out.stdout, /--max-width <n> +cut cells wider than this \(default 24\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

const STOCK = "name,qty,shelf\npear,7,A1\nfig,120,B2\napple,15,A3\nkiwi,15,C1\n";

function runReport(...args: string[]) {
  const out = { stdout: "", stderr: "" };
  const code = run(["report", "stock.csv", ...args], {
    readFile: () => STOCK,
    stdout: (t) => void (out.stdout += t),
    stderr: (t) => void (out.stderr += t),
  });
  return { code, ...out };
}

test("--sort orders rows by a column, ascending", () => {
  const r = runReport("--sort", "name");
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    ["name   qty  shelf", "-----  ---  -----", "apple   15  A3", "fig    120  B2", "kiwi    15  C1", "pear     7  A1", ""].join("\n"),
  );
});

test("-s is the short form, and works with --columns", () => {
  const r = runReport("-s", "shelf", "-c", "shelf,name");
  assert.equal(r.code, 0);
  assert.equal(r.stdout, ["shelf  name", "-----  -----", "A1     pear", "A3     apple", "B2     fig", "C1     kiwi", ""].join("\n"));
});

test("help lists the option", () => {
  const r = runReport("--help");
  assert.match(r.stdout, /-s, --sort <column> +sort rows by this column, ascending/);
});

test("an unknown sort column is a usage error", () => {
  const r = runReport("--sort", "price");
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "clikit report: unknown column: price\n");
  assert.equal(r.stdout, "");
});

// The per-round check (lib/verify.mjs): which reproductions it accepts, which tests count as next to the
// change, and the script itself, run for real with bash on a scratch repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validRepro, neighbourTests, verifyFiles, parseVerify } from "../lib/verify.mjs";

const GLOBS = ["**/*.test.*"];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-verify-"));
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", ...a], { encoding: "utf8" }).trim();
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  const commit = (m) => { git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", m); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "main");
  return { dir, git, put, commit };
}

test("a reproduction is one file under /tmp and a command; anything else is not one", () => {
  assert.ok(validRepro({ file: "/tmp/repro-1.test.ts", content: "x", cmd: "npx tsx --test /tmp/repro-1.test.ts" }));
  assert.ok(!validRepro({ file: "/work/repo/src/a.ts", content: "x", cmd: "true" }), "never a repo file");
  assert.ok(!validRepro({ file: "/tmp/../etc/passwd", content: "x", cmd: "true" }));
  assert.ok(!validRepro({ file: "/tmp/a.ts", content: "x", cmd: " " }));
  assert.ok(!validRepro(undefined));
});

test("tests next to the change: the same stem first, then tests that import a changed module; only tests at the base", () => {
  const r = repo();
  r.put("src/gate/verify.ts", "export const a = 1;\n");
  r.put("src/gate/verify.test.ts", "import { a } from \"./verify.js\";\n");
  r.put("src/cli/run.test.ts", "import { a } from \"../gate/verify.js\";\n");
  r.put("src/cli/other.test.ts", "import { b } from \"./other.js\";\n");
  const base = r.commit("base");
  r.put("src/gate/verify.ts", "export const a = 2;\n");
  r.put("src/gate/new.test.ts", "import { a } from \"./verify.js\";\n");
  const head = r.commit("change");
  assert.deepEqual(neighbourTests(r.dir, base, head, GLOBS), ["src/gate/verify.test.ts", "src/cli/run.test.ts"]);
  assert.deepEqual(neighbourTests(r.dir, base, head, GLOBS, 1), ["src/gate/verify.test.ts"]);
});

test("the script, run for real: a failing reproduction proves, a passing one does not, a regression is only one if the base passed", () => {
  const r = repo();
  r.put("a.js", "module.exports = 1;\n");
  r.put("a.test.js", "require('node:assert').equal(require('./a.js'), 1);\n");
  r.put("b.test.js", "process.exit(1);\n");                     // fails at the base already
  const base = r.commit("base");
  r.put("a.js", "module.exports = 2;\n");
  r.commit("break a");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-repro-")).replace(/\\/g, "/");
  const scratch = (n) => `/tmp/ab-verify-${process.pid}-${n}.sh`;
  const run = (neighboursCmd) => {
    const files = verifyFiles({ base, neighboursCmd, root: r.dir.replace(/\\/g, "/"), baseDir: `${tmp}/base-${neighboursCmd.length}`,
      repros: [{ id: "1.spec.1", file: scratch(1), content: "exit 3\n", cmd: `bash ${scratch(1)}` },
               { id: "1.spec.2", file: scratch(2), content: "exit 0\n", cmd: `bash ${scratch(2)}` }] });
    for (const [rel, text] of Object.entries(files)) r.put(rel, text);
    return parseVerify(execFileSync("bash", [path.join(r.dir, ".agent-box-verify", "run.sh")], { encoding: "utf8" }));
  };
  const a = run("node a.test.js");
  assert.deepEqual(a.repro, { "1.spec.1": 3, "1.spec.2": 0 });
  assert.equal(a.neighbours.regression, true, JSON.stringify(a.neighbours));
  assert.equal(a.neighbours.base_exit, 0);
  assert.match(a.neighbours.tail, /AssertionError|Expected/);
  const b = run("node b.test.js");
  assert.equal(b.neighbours.regression, false, "failing on the base too: not this change's");
  assert.notEqual(b.neighbours.base_exit, 0);
});

test("parseVerify: no neighbour run is null, and the tail is the indented block", () => {
  assert.deepEqual(parseVerify("AGENT-BOX-REPRO 2.spec.1 exit 1\n    boom\n"), { repro: { "2.spec.1": 1 }, neighbours: null });
  const p = parseVerify("AGENT-BOX-NEIGHBOURS exit 0\n    ok 1\n");
  assert.deepEqual(p.neighbours, { exit: 0, base_exit: null, tail: "ok 1", regression: false });
});

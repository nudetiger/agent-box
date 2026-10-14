// The per-round check (lib/verify.mjs): which reproductions it accepts, which tests count as next to the
// change, and the script itself, run for real with bash on a scratch repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validRepro, neighbourTests, verifyFiles, parseVerify, suiteFiles, parseSuite, checkTimes } from "../lib/verify.mjs";

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
  assert.deepEqual(parseVerify("AGENT-BOX-REPRO 2.spec.1 exit 1\n    boom\n"), { repro: { "2.spec.1": 1 }, reproBase: {}, neighbours: null });
  const p = parseVerify("AGENT-BOX-NEIGHBOURS exit 0\n    ok 1\n");
  assert.deepEqual(p.neighbours, { exit: 0, base_exit: null, tail: "ok 1", fails: [], base_fails: null, new_fails: [], regression: false });
});

test("parseVerify: a base that already fails hides nothing; names decide, and a known base result stands in", () => {
  const log = (b) => `AGENT-BOX-NEIGHBOURS exit 1\n    x\nAGENT-BOX-NFAIL linux path\nAGENT-BOX-NFAIL ${b}\n`;
  const withBase = parseVerify(`${log("trusted child")}AGENT-BOX-NEIGHBOURS-BASE exit 1\nAGENT-BOX-NFAIL-BASE linux path\n`);
  assert.equal(withBase.neighbours.regression, true);
  assert.deepEqual(withBase.neighbours.new_fails, ["trusted child"]);
  const same = parseVerify("AGENT-BOX-NEIGHBOURS exit 1\nAGENT-BOX-NFAIL linux path\nAGENT-BOX-NEIGHBOURS-BASE exit 1\nAGENT-BOX-NFAIL-BASE linux path\n");
  assert.equal(same.neighbours.regression, false, "the same failure on the base is not this change's");
  const cached = parseVerify(log("trusted child"), { exit: 1, fails: ["linux path"] });
  assert.equal(cached.neighbours.regression, true);
  assert.equal(cached.neighbours.base_exit, 1);
  assert.deepEqual(parseVerify("AGENT-BOX-REPRO 3.spec.1 exit 1\nAGENT-BOX-REPRO-BASE 3.spec.1 exit 0\n").reproBase, { "3.spec.1": 0 });
});

test("the script, run for real: failing test names on both sides, base reproductions, and no base run when it is known", () => {
  const r = repo();
  r.put("a.js", "module.exports = 1;\n");
  r.put("n.test.js", "const { test } = require('node:test');\nconst a = require('./a.js');\ntest('always broken', () => { throw new Error('x'); });\ntest('a is one', () => { if (a !== 1) throw new Error('a'); });\n");
  const base = r.commit("base");
  r.put("a.js", "module.exports = 2;\n");
  r.commit("break a");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-names-")).replace(/\\/g, "/");
  const scratch = `/tmp/ab-verify-${process.pid}-base.sh`;
  const run = (baseKnown, n) => {
    const files = verifyFiles({ base, neighboursCmd: "node --test n.test.js", baseKnown, root: r.dir.replace(/\\/g, "/"), baseDir: `${tmp}/base-${n}`,
      baseRepros: ["1.spec.1"],
      repros: [{ id: "1.spec.1", file: scratch, content: "node -e \"process.exit(require('./a.js') === 1 ? 0 : 1)\"\n", cmd: `bash ${scratch}` }] });
    for (const [rel, text] of Object.entries(files)) r.put(rel, text);
    // A node --test inside this test run would report to it (NODE_TEST_CONTEXT) and exit 0.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    return execFileSync("bash", [path.join(r.dir, ".agent-box-verify", "run.sh")], { encoding: "utf8", env });
  };
  const first = run(false, 1), v = parseVerify(first);
  assert.deepEqual([v.repro["1.spec.1"], v.reproBase["1.spec.1"]], [1, 0], "fails on the branch, passes on the base");
  assert.deepEqual(v.neighbours.base_fails, ["always broken"], first);
  assert.deepEqual(v.neighbours.new_fails, ["a is one"]);
  assert.equal(v.neighbours.regression, true);
  const log = run(true, 2);
  assert.doesNotMatch(log, /AGENT-BOX-NEIGHBOURS-BASE/);
  assert.equal(parseVerify(log, { exit: 1, fails: ["always broken"] }).neighbours.regression, true);
});

test("the base suite, run for real: exit, failing names and seconds; a crash or a timeout is no base result", () => {
  const r = repo();
  r.put("a.txt", "a\n");
  r.commit("base");
  const files = suiteFiles({ cmd: "printf 'not ok 1 - linux path\\nok 2 - fine\\n'; exit 1", root: r.dir.replace(/\\/g, "/") });
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r.dir, f)), { recursive: true }); fs.writeFileSync(path.join(r.dir, f), text); }
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const log = execFileSync("bash", [path.join(r.dir, ".agent-box-verify", "run.sh")], { encoding: "utf8", env });
  assert.deepEqual(parseSuite(log), { exit: 1, fails: ["linux path"] });
  assert.equal(typeof checkTimes(log).suite, "number");
  assert.equal(parseSuite("AGENT-BOX-SUITE exit 1\n"), null, "failed with no names: a crash");
  assert.equal(parseSuite("AGENT-BOX-SUITE exit 124\nAGENT-BOX-SFAIL x\n"), null, "timed out");
  assert.deepEqual(parseSuite("AGENT-BOX-SUITE exit 0\n"), { exit: 0, fails: [] });
  assert.deepEqual(checkTimes("AGENT-BOX-TIME repro:1.spec.1 4\nAGENT-BOX-TIME neighbours 51\n"), { "repro:1.spec.1": 4, neighbours: 51 });
});

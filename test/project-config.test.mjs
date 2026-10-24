// Per-project settings for stacks beyond Node and Java: failing test names, neighbour sources, test
// command placeholders, sensitive paths, and any agent-box.conf key overridden in projects/<repo>.env.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmp } from "./tmp.mjs";
import { failNames, neighbourTests, verifyFiles, parseVerify } from "../lib/verify.mjs";
import { fillTestCmd } from "../lib/testcmd.mjs";
import { projectSettings, conf } from "../lib/ticket.mjs";
import { checks } from "../lib/checks.mjs";

function repo() {
  const dir = tmp("ab-config-");
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", ...a], { encoding: "utf8" }).trim();
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  const commit = (m) => { git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", m); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "main");
  return { dir, git, put, commit };
}

test("failing test names: every runner the default knows, summary lines that are not names left out", () => {
  const log = [
    "  ✖ adds two (12ms)", "not ok 3 - skips # SKIP", "--- FAIL: TestParse (0.00s)", "    --- FAIL: TestParse/empty (0.00s)",
    "test store::tests::evicts ... FAILED", "[  FAILED  ] Cache.Evicts (5 ms)", "[  FAILED  ] 2 tests, listed below:",
    "FAILED tests/test_x.py::test_y - AssertionError", "StatTest > flatThenPercent() FAILED\r", "ok 4 - passes", "--- PASS: TestOk",
  ].join("\n");
  assert.deepEqual(failNames(log), ["Cache.Evicts", "StatTest > flatThenPercent()", "TestParse", "TestParse/empty", "adds two",
    "skips", "store::tests::evicts", "tests/test_x.py::test_y"].sort());
  assert.deepEqual(failNames("FAIL: alpha\nFAIL: beta\n", String.raw`^FAIL: (\S+)`), ["alpha", "beta"]);
});

test("the check script, run for real, extracts names with the project's FAIL_REGEX", () => {
  const r = repo();
  r.put("a.txt", "a\n");
  const base = r.commit("base");
  const files = verifyFiles({ repros: [], neighboursCmd: "printf 'FAIL: alpha\\nFAIL: beta\\n'; exit 1", base, baseKnown: true,
    root: r.dir.replace(/\\/g, "/"), failRegex: String.raw`^FAIL: (\S+)` });
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r.dir, f)), { recursive: true }); fs.writeFileSync(path.join(r.dir, f), text); }
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const v = parseVerify(execFileSync("bash", [path.join(r.dir, ".agent-box-verify", "run.sh")], { encoding: "utf8", env }), { exit: 1, fails: ["alpha"] });
  assert.deepEqual(v.neighbours.fails, ["alpha", "beta"]);
  assert.deepEqual(v.neighbours.new_fails, ["beta"]);
  assert.equal(v.neighbours.regression, true);
});

test("neighbour tests for C++: the same stem, then a test that #includes the header; NEIGHBOUR_SOURCES narrows", () => {
  const r = repo();
  r.put("src/cache.cpp", "int f() { return 1; }\n");
  r.put("src/cache.h", "int f();\n");
  r.put("src/cache_test.cpp", "#include \"cache.h\"\n");
  r.put("tests/integration_test.cc", "#include \"src/cache.h\"\n");
  const base = r.commit("base");
  r.put("src/cache.cpp", "int f() { return 2; }\n");
  r.put("src/cache.h", "int f(); // changed\n");
  const head = r.commit("change");
  const globs = ["**/*_test.*"];
  assert.deepEqual(neighbourTests(r.dir, base, head, globs), ["src/cache_test.cpp", "tests/integration_test.cc"]);
  assert.deepEqual(neighbourTests(r.dir, base, head, globs, 30, String.raw`\.go$`), []);
});

test("test command placeholders: {files}, {tests} for Gradle, {dirs} for go test", () => {
  const files = ["pkg/a/a_test.go", "pkg/a/b_test.go", "cmd/x_test.go", "root_test.go"];
  assert.equal(fillTestCmd("go test {dirs}", files), "go test ./pkg/a ./cmd .");
  assert.equal(fillTestCmd("node --test {files}", ["t/a.test.js"]), "node --test t/a.test.js");
  assert.equal(fillTestCmd("gradle test {tests}", ["src/test/java/a/FooTest.java"]), "gradle test --tests a.FooTest");
});

test("project settings: any key overrides agent-box.conf, the OmniRoute key is never read", () => {
  const env = projectSettings(["FAIL_REGEX='^FAIL: (\\S+)'", "LOOP_MAX_ROUNDS=2", "OMNIROUTE_API_KEY=secret", "# NOTE=x"].join("\n"));
  assert.deepEqual(env, { FAIL_REGEX: "^FAIL: (\\S+)", LOOP_MAX_ROUNDS: "2" });
  assert.equal(conf("LOOP_MAX_ROUNDS", { env }), "2");
});

test("SENSITIVE: Go, Rust and CMake manifests by default, and the project's SENSITIVE_EXTRA", () => {
  const r = repo();
  r.put("main.go", "package main\n");
  const base = r.commit("base");
  for (const f of ["go.mod", "Cargo.toml", "CMakeLists.txt", "proto/api.proto", "main.go"]) r.put(f, "x\n");
  r.git("checkout", "-q", "-b", "agent/x");
  r.commit("change");
  const run = () => checks({ repo: r.dir, summary: { base, commits: 1 }, branch: "agent/x" }).flags.find((f) => f.flag === "SENSITIVE")?.detail ?? "";
  const prev = process.env.SENSITIVE_EXTRA;
  try {
    delete process.env.SENSITIVE_EXTRA;
    assert.deepEqual(run().split(", ").sort(), ["CMakeLists.txt", "Cargo.toml", "go.mod"]);
    process.env.SENSITIVE_EXTRA = "^proto/";
    assert.deepEqual(run().split(", ").sort(), ["CMakeLists.txt", "Cargo.toml", "go.mod", "proto/api.proto"]);
  } finally {
    if (prev === undefined) delete process.env.SENSITIVE_EXTRA; else process.env.SENSITIVE_EXTRA = prev;
  }
});

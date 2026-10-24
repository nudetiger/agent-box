// The gaps the Lykos P3 and RakunLoots P9 orchestrators found (docs/known-gaps.md,
// docs/rakunloots-p9/rakunloots-phase9-2026-10-21.md), one test per host-side fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmp as tempDir } from "./tmp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("ab-gaps-");
process.env.AGENT_BOX_LEDGER = path.join(tmp, "events.jsonl");
const { finalBlock, noOutput } = await import("../lib/ledger.mjs");
const { verdictOf, nextOf, checks } = await import("../lib/checks.mjs");
const { normalizeFinding, selectFindings } = await import("../lib/finding.mjs");
const { specRef } = await import("../lib/issue.mjs");
const { detect, render } = await import("../lib/setup.mjs");
const { loop, resume, addItems } = await import("../lib/loop.mjs");

const dirWith = (files) => {
  const d = fs.mkdtempSync(path.join(tmp, "run-"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
};

test("a review that timed out or failed is incomplete, whatever findings it left", () => {
  assert.equal(verdictOf({ review: true, agent_exit: 124, findings: 2 }), "timeout");
  assert.equal(verdictOf({ review: true, agent_exit: 137 }), "timeout");
  assert.equal(verdictOf({ review: true, agent_exit: 1 }), "error");
  assert.equal(verdictOf({ review: true, agent_exit: 0 }), "review");
  assert.equal(nextOf({ review: true, findings: 2 }, "timeout", []), "split_or_continue");
});

test("a review run gets no scope, stand-in or sensitive flags: REVIEW-EDIT covers its edits", () => {
  const s = { review: true, review_violation: true, commits: 0, base: "b", agent_exit: 0 };
  const c = checks({ repo: tmp, summary: s, pack: { scoped: true, files: [] }, branch: "agent/none" });
  assert.deepEqual(c.flags.map((f) => f.flag), ["REVIEW-EDIT"]);
});

test("a report fenced as YAML is read; a fenced bare string is no block", () => {
  const d = dirWith({ "final.md": "Done.\n\n```agent-box-report\nstatus: done\ntests: pass\ndecisions:\n  - kept the API\n```\n" });
  assert.deepEqual(finalBlock(d, "agent-box-report"), { status: "done", tests: "pass", decisions: ["kept the API"] });
  const y = dirWith({ "final.md": "```agent-box-findings\nfindings:\n  - issue: x\n    severity: high\n```\n" });
  assert.deepEqual(finalBlock(y, "agent-box-findings"), [{ issue: "x", severity: "high" }]);
  const s = dirWith({ "final.md": "```agent-box-report\njust words\n```\n" });
  assert.equal(finalBlock(s, "agent-box-report"), null);
});

test("a worker that exited 0 without one step is a provider error", () => {
  const d = dirWith({ "events.jsonl": '{"type":"text"}\n', "opencode.log": "INFO boot\nERROR model not found: x/y\n" });
  assert.match(noOutput(d, { agent_exit: 0, setup_exit: 0 }), /^no model output: .*model not found/);
  assert.equal(noOutput(d, { agent_exit: 1 }), null);
  assert.equal(noOutput(d, { agent_exit: 0 }, { SKIP_AGENT: "1" }), null);
  fs.writeFileSync(path.join(d, "events.jsonl"), '{"type":"step_start"}\n');
  assert.equal(noOutput(d, { agent_exit: 0 }), null);
});

test("findings in a reviewer's own shape are filled in; ids select before positions", () => {
  const f = normalizeFinding({ id: 6, title: "Menus stay open", expected: "closed", actual: "open", repro: { path: "a.test.ts", command: "npm test", code: "x()" } });
  assert.equal(f.issue, "Menus stay open");
  assert.equal(f.scenario, "expected closed, actual open");
  assert.deepEqual(f.repro, { path: "a.test.ts", command: "npm test", code: "x()", cmd: "npm test", content: "x()", file: "a.test.ts" });
  assert.equal(normalizeFinding({ scenario: "When the plugin stops, the menu stays open. More text." }).issue, "When the plugin stops, the menu stays open.");
  const all = [{ id: 3 }, { id: 6 }];
  assert.deepEqual(selectFindings(all, [6]), { pick: [{ id: 6 }], by: "id" });
  assert.deepEqual(selectFindings([{ a: 1 }, { a: 2 }], [2]), { pick: [{ a: 2 }], by: "position" });
});

test("the spec issue: Spec, Parent, Parent issue, or a ## Parent heading", () => {
  assert.equal(specRef("Spec: #12"), 12);
  assert.equal(specRef("intro\nParent: #5\n"), 5);
  assert.equal(specRef("**Parent issue:** #7"), 7);
  assert.equal(specRef("## Parent\n\n#103 the phase spec"), 103);
  assert.equal(specRef("- Parent: #9"), 9);
  assert.equal(specRef("Spec: none, see #4"), null);
});

test("setup: a Gradle multi-project build filters on the root project; mavenLocal() is warned about", () => {
  const d = fs.mkdtempSync(path.join(tmp, "gradle-"));
  const files = { "settings.gradle.kts": 'rootProject.name = "x"\ninclude("adapter-1")\n', "build.gradle.kts": "repositories { mavenLocal() }\n", gradlew: "" };
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(d, f), t);
  const s = detect(d, Object.keys(files));
  assert.equal(s[0].multi, true);
  assert.deepEqual(s[0].mavenLocal, ["build.gradle.kts"]);
  const { env, yaml } = render("x", s);
  assert.match(yaml, /test_file_command: 'bash \.\/gradlew --console=plain :compileTestJava :test \{tests\}'/);
  assert.match(env, /m2:\/home\/node\/\.m2/);
  const d1 = fs.mkdtempSync(path.join(tmp, "gradle1-"));
  fs.writeFileSync(path.join(d1, "build.gradle"), "");
  const single = detect(d1, ["build.gradle", "gradlew"]);
  assert.match(render("y", single).yaml, /gradlew --console=plain test \{tests\}/);
});

test("stats: an unknown option is an error, not a view", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "lib", "stats.mjs"), "--run", "x"], { encoding: "utf8", env: { ...process.env, AGENT_BOX_LEDGER: path.join(tmp, "none.jsonl") } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --run/);
});

// ─── the loop ─────────────────────────────────────────────────────────────────────────────
const REPRO = { file: "/tmp/r.test.ts", content: "boom()", cmd: "npx tsx --test /tmp/r.test.ts" };
function harness(script) {
  const root = fs.mkdtempSync(path.join(tmp, "loop-"));
  const runs = path.join(root, "runs");
  const P = { repo: root, name: "demo", runs, env: {}, map: {}, testGlobs: [] };
  const write = (run, s, findings) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "summary.json"), JSON.stringify({ model: "m", base: "b0", ...s }));
    fs.writeFileSync(path.join(runs, run, "meta.sh"), `ROLE=${s.role ?? "implement"}\n${run === "impl" ? "SEALED=a.test.ts\n" : ""}`);
    if (findings) fs.writeFileSync(path.join(runs, run, "findings.json"), JSON.stringify(findings));
  };
  write("impl", { verdict: "pass" });
  const calls = [];
  const delegate = async (args) => {
    calls.push(args);
    const [cmd] = args, name = args[args.indexOf("--name") + 1];
    const [want, step] = script.shift() ?? [];
    assert.equal(cmd, want, `call ${calls.length}: ${args.join(" ")}`);
    // A reviewer session resumed on the fix (continue --at): step is its findings.
    if (cmd === "continue" && args.includes("--at")) write(name, { role: "review-both", verdict: "review" }, step);
    else if (cmd === "review") for (const [role, x] of Object.entries(step)) write(`${name}-${role}`, { role, ...x.summary }, x.findings);
    else if (cmd === "check") {
      fs.mkdirSync(path.join(runs, name), { recursive: true });
      fs.writeFileSync(path.join(runs, name, "test.log"), Object.entries(step).map(([id, e]) => `AGENT-BOX-REPRO ${id} exit ${e}\n`).join(""));
    } else write(name, typeof step === "string" ? { verdict: step } : step);
  };
  const deps = { delegate, record: () => {}, readAll: () => [], baseSuite: async () => null };
  return { P, calls, deps, left: () => assert.equal(script.length, 0, `unused: ${JSON.stringify(script)}`), msg: (c) => fs.readFileSync(c[c.indexOf("-f") + 1], "utf8") };
}
const clean = { "review-both": { summary: { verdict: "review" }, findings: [] } };

test("loop: the first review is against the run's base", async () => {
  const h = harness([["review", clean]]);
  const st = await loop(h.P, "impl", { name: "L", roles: "review-both" }, h.deps);
  assert.equal(st.next, "approve");
  const a = h.calls[0];
  assert.equal(a[a.indexOf("--against") + 1], "b0");
  h.left();
});

test("loop: a review that timed out stops for the environment and runs again on resume", async () => {
  const h = harness([["review", { "review-both": { summary: { verdict: "timeout", agent_exit: 124 }, findings: [{ issue: "half", severity: "high" }] } }], ["review", clean]]);
  let st = await loop(h.P, "impl", { name: "L", roles: "review-both" }, h.deps);
  assert.equal(st.next, "fix_environment");
  assert.match(st.reason, /ended timeout \(agent exit 124\)/);
  assert.equal(st.redo, "review");
  st = await resume(h.P, "L", {}, h.deps);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: --add at the start; a JSON array's items with a reproduction are proven open items", async () => {
  const add = JSON.stringify([{ title: "Menus stay open", severity: "high", repro: { path: "/tmp/m.test.ts", command: "npx tsx --test /tmp/m.test.ts", code: "close()" } },
    { issue: "Name the constant", severity: "low" }]);
  const h = harness([["review", clean], ["check", { "add1.1": 1 }], ["continue", "pass"], ["continue", []], ["check", { "add1.1": 0 }]]);
  const st = await loop(h.P, "impl", { name: "L", roles: "review-both", add }, h.deps);
  const fixMsg = h.msg(h.calls[2]);
  assert.match(fixMsg, /## add1\.1: Menus stay open \(high/);
  assert.match(fixMsg, /`add1\.2` Name the constant/);
  assert.equal(st.next, "approve");
  assert.deepEqual(st.fixedProofs, ["add1.1"]);
  h.left();
});

test("addItems: markdown stays markdown", () => {
  const st = { open: [], proofs: {} };
  assert.deepEqual(addItems(st, "Also rename x."), ["## From the orchestrator\n\nAlso rename x."]);
  assert.equal(st.open.length, 0);
});

test("loop resume --retire takes an open item and its proof out, unlabelled; an unknown id is refused", async () => {
  const h = harness([["review", { "review-both": { summary: { verdict: "review" }, findings: [{ issue: "bug", severity: "high", confidence: "CONFIRMED", category: "logic", basis: "task", repro: REPRO }] } }],
    ["check", { "1.both.1": 1 }], ["continue", "blocked"]]);
  let st = await loop(h.P, "impl", { name: "L", roles: "review-both" }, h.deps);
  assert.equal(st.next, "answer_question");
  await assert.rejects(resume(h.P, "L", { retire: ["9.x"] }, h.deps), /--retire: no open item or proof 9\.x/);
  const labels = [];
  h.deps.record = (...a) => labels.push(a);
  h.deps.delegate = async () => {};
  const file = path.join(h.P.runs, "_loops", "L", "state.json");
  const s0 = JSON.parse(fs.readFileSync(file, "utf8")); delete s0.blockedRun; fs.writeFileSync(file, JSON.stringify(s0));
  st = await resume(h.P, "L", { retire: ["1.both.1"] }, h.deps);
  assert.equal(st.open.length, 0);
  assert.equal(st.proofs["1.both.1"], undefined);
  assert.equal(labels.length, 0);
});

test("loop resume adopts a fix round that finished after the loop stopped", async () => {
  const script = [["review", { "review-both": { summary: { verdict: "review" }, findings: [{ issue: "bug", severity: "high", confidence: "CONFIRMED", category: "logic", basis: "task", repro: REPRO }] } }],
    ["check", { "1.both.1": 1 }], ["continue", "blocked"]];
  const h = harness(script);
  await loop(h.P, "impl", { name: "L", roles: "review-both" }, h.deps);
  // The loop process died while L-fix1-x ran; the fix finished and passed.
  const file = path.join(h.P.runs, "_loops", "L", "state.json");
  const s0 = JSON.parse(fs.readFileSync(file, "utf8")); delete s0.blockedRun; s0.pendingFix = { run: "L-fix1-x", advice: 0 }; fs.writeFileSync(file, JSON.stringify(s0));
  fs.mkdirSync(path.join(h.P.runs, "L-fix1-x"), { recursive: true });
  fs.writeFileSync(path.join(h.P.runs, "L-fix1-x", "summary.json"), JSON.stringify({ verdict: "pass", model: "m" }));
  script.push(["continue", []], ["check", { "1.both.1": 0 }]);
  const st = await resume(h.P, "L", {}, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(st.rounds.at(-1).run, "L-fix1-x");
  assert.equal(h.calls.filter((c) => c[0] === "continue" && !c.includes("--at")).length, 1, "no second fix");
  h.left();
});

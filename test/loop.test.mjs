// The review and fix loop: routing, when it fixes, rechecks, starts fresh attempts, stops or approves.
// The rules are tested directly; the loop itself runs against a stand-in for delegate.sh that writes run
// folders, so no container starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, decide, fixMessage, fixContext, recheckMessage, freshTask, loop, resume } from "../lib/loop.mjs";

const CFG = { maxRounds: 4, maxFixes: 3, stuck: 2, softRounds: 2, neighbours: 30, recheckSteps: 40, fresh: ["implement", "implement-hard"], selector: "advise-alt" };
const REPRO = { file: "/tmp/r.test.ts", content: "boom()", cmd: "npx tsx --test /tmp/r.test.ts" };
const F = (id, extra = {}) => ({ id, severity: "high", confidence: "CONFIRMED", category: "logic", issue: `issue ${id}`, file: "a.ts", line: 1, scenario: "s", basis: "task: it must", repro: REPRO, ...extra });

// ─── the rules ────────────────────────────────────────────────────────────────────────────
test("routing: the reproduction decides, not the reviewer's word", () => {
  const c = classify([
    F("1.spec.1"),                                                  // fails on the branch: blocks
    F("1.spec.2", { severity: "low" }),                             // fails, but low: a note
    F("1.spec.3", { confidence: "PLAUSIBLE" }),                     // passes on the branch: dropped
    F("1.spec.4", { category: "spec_question", repro: undefined }),
    F("1.spec.5", { repro: undefined }),                            // CONFIRMED high logic, no repro: orchestrator
    F("1.std.1", { severity: "medium", category: "standard", repro: undefined, confidence: "PLAUSIBLE" }), // advice
    F("1.std.2", { severity: "medium", category: "logic", repro: undefined, confidence: "PLAUSIBLE" }),    // unproven behaviour: note
    F("1.std.3", { severity: "low", category: "standard", repro: undefined }),                            // note
    F("1.spec.6", { basis: undefined }),                            // fails, but defends nothing it can quote: advice
  ], { "1.spec.1": 1, "1.spec.2": 1, "1.spec.3": 0, "1.spec.6": 1 });
  const ids = (a) => a.map((f) => f.id);
  assert.deepEqual(ids(c.blocking), ["1.spec.1"]);
  assert.deepEqual(ids(c.dropped), ["1.spec.3"]);
  assert.deepEqual(ids(c.questions), ["1.spec.4"]);
  assert.deepEqual(ids(c.queue), ["1.spec.5"]);
  assert.deepEqual(ids(c.advice), ["1.std.1", "1.spec.6"]);
  assert.deepEqual(ids(c.notes), ["1.spec.2", "1.std.2", "1.std.3"]);
});

test("routing: a regression must fail on the branch and pass on the base", () => {
  const c = classify([F("2.spec.1", { category: "regression", basis: undefined }), F("2.spec.2", { category: "regression" })],
    { "2.spec.1": 1, "2.spec.2": 1 }, { reproBase: { "2.spec.1": 0, "2.spec.2": 1 } });
  assert.deepEqual(c.blocking.map((f) => f.id), ["2.spec.1"]);
  assert.deepEqual(c.notes.map((f) => f.id), ["2.spec.2"], "failing on the base too: it was there before");
});

test("routing after a fix: code the fix did not touch counts only with a failing reproduction", () => {
  const c = classify([
    F("3.spec.1", { file: "old.ts" }),                                                  // fails: still blocks
    F("3.spec.2", { file: "old.ts", repro: undefined }),                                // would be triage: a note now
    F("3.spec.3", { file: "/work/repo/fix.ts", repro: undefined }),                     // in the fix: triage
    F("3.spec.4", { file: "old.ts", category: "spec_question", repro: undefined }),     // not the fix's question
  ], { "3.spec.1": 1 }, { touched: ["fix.ts"] });
  assert.deepEqual(c.blocking.map((f) => f.id), ["3.spec.1"]);
  assert.deepEqual(c.queue.map((f) => f.id), ["3.spec.3"]);
  assert.deepEqual(c.outside.map((f) => f.id), ["3.spec.2", "3.spec.4"]);
  assert.equal(c.questions.length, 0);
});

const X = (o = {}) => ({ round: 1, open: [], questions: 0, queue: 0, disputes: 0, advice: 0, adviceUsed: false, fixesTotal: 0, fixesByTier: 0, freshUsed: false, ...o });
const open = (id, survived = 0, extra = {}) => ({ id, severity: "high", survived, ...extra });

test("a clean review approves, the first or a recheck: there is no final full review", () => {
  assert.equal(decide(X(), CFG).action, "approve");
  assert.equal(decide(X({ round: 2, fixesTotal: 1 }), CFG).action, "approve");
});

test("questions and unproven serious findings stop for the orchestrator before anything else", () => {
  assert.equal(decide(X({ questions: 1, open: [open("1.spec.1")] }), CFG).next, "answer_spec");
  assert.equal(decide(X({ queue: 1 }), CFG).next, "triage");
  assert.equal(decide(X({ disputes: 1, open: [open("1.spec.1")] }), CFG).next, "triage");
});

test("advice alone gets one fix round, never a second", () => {
  assert.equal(decide(X({ advice: 2 }), CFG).action, "fix");
  assert.equal(decide(X({ advice: 2, adviceUsed: true }), CFG).action, "approve");
});

test("a stall starts fresh attempts once: stuck after two fixes, a regression or a re-broken fix after one", () => {
  assert.equal(decide(X({ round: 2, fixesTotal: 1, fixesByTier: 1, open: [open("1.spec.1", 1, { severity: "medium" })] }), CFG).action, "fix");
  assert.equal(decide(X({ round: 3, fixesTotal: 2, fixesByTier: 2, open: [open("1.spec.1", 2)] }), CFG).action, "fresh");
  assert.equal(decide(X({ round: 2, open: [open("regression", 1, { regression: true })] }), CFG).action, "fresh");
  assert.equal(decide(X({ round: 2, open: [open("1.spec.1", 1, { broke: true, severity: "medium" })] }), CFG).action, "fresh");
  assert.equal(decide(X({ round: 3, fixesTotal: 2, fixesByTier: 2, open: [open("1.spec.1", 2)], freshUsed: true }), CFG).next, "decide");
});

test("new serious findings: fresh after 2 fix rounds by one worker; medium ones until the fix cap", () => {
  assert.equal(decide(X({ round: 3, fixesTotal: 2, fixesByTier: 2, open: [open("3.spec.1")] }), CFG).action, "fresh");
  assert.equal(decide(X({ round: 3, fixesTotal: 2, fixesByTier: 2, open: [open("3.spec.1", 0, { severity: "medium" })] }), CFG).action, "fix");
  assert.equal(decide(X({ round: 3, fixesTotal: 3, fixesByTier: 1, open: [open("3.spec.1", 0, { severity: "medium" })] }), CFG).action, "fresh");
});

test("the round cap stops for the orchestrator", () => {
  assert.equal(decide(X({ round: 4, open: [open("4.spec.1", 0, { severity: "medium" })] }), CFG).next, "decide");
});

test("the fix message carries each reproduction, the regression, advice, lows, the proof suite and how to dispute", () => {
  const m = fixMessage(2, [{ id: "1.spec.1", severity: "high", survived: 1, finding: F("1.spec.1") },
    { id: "1.spec.2", severity: "high", survived: 0, broke: true, finding: F("1.spec.2") },
    { id: "regression", regression: true, cmd: "npx tsx --test a.test.ts", tail: "not ok 3", newFails: ["trusted child"] }],
  [F("2.std.1", { severity: "medium", category: "standard", repro: undefined })], ["## The orchestrator's ruling\n\nKeep it in the container."],
  { lows: [F("2.spec.3", { severity: "low" })], proofs: [{ id: "1.spec.9", file: "/tmp/p.ts", content: "keep()", cmd: "npx tsx --test /tmp/p.ts" }],
    neighbours: { cmd: "npx tsx --test a.test.ts", baseFails: ["linux path"] } });
  assert.match(m, /## 1\.spec\.1: issue 1\.spec\.1 \(high, logic\) - still failing after 1 fix/);
  assert.match(m, /## 1\.spec\.2: .* - fixed earlier, broken again/);
  assert.match(m, /```\nboom\(\)\n```/);
  assert.match(m, /`npx tsx --test a\.test\.ts` fails on your branch in tests that pass on the base: `trusted child`[\s\S]*not ok 3/);
  assert.match(m, /## Also fix[\s\S]*`2\.std\.1`/);
  assert.match(m, /## Low [\s\S]*`2\.spec\.3`/);
  assert.match(m, /under `disputes`/);
  assert.match(m, /Keep it in the container\./);
  assert.match(m, /## Before you end: prove it[\s\S]*`1\.spec\.9` \(fixed earlier, keep it passing\)[\s\S]*keep\(\)[\s\S]*ignore them: `linux path`/);
  assert.match(fixContext([F("1.spec.1")]), /do not report\s+them again just because they were listed/);
});

test("the recheck message names the fix's range, what it was for, the rulings and the scope rule", () => {
  const m = recheckMessage(3, [F("2.spec.1")], "abc123", ["Keep it."]);
  assert.match(m, /`git diff abc123\.\.HEAD`/);
  assert.match(m, /Do not start a new full review/);
  assert.match(m, /`2\.spec\.1` \(high\): issue 2\.spec\.1/);
  assert.match(m, /1\. Keep it\./);
  assert.match(m, /did not touch: report nothing unless it is critical/);
});

test("a fresh attempt gets the task, the rulings and every proof, never the earlier diff", () => {
  const t = freshTask("Make it right.", "stuck", ["Keep it."], [{ id: "1.spec.1", file: "/tmp/r.ts", content: "boom()", cmd: "npx tsx --test /tmp/r.ts", finding: F("1.spec.1") }]);
  assert.match(t, /^Make it right\.[\s\S]*## Earlier attempts[\s\S]*\(stuck\)[\s\S]*1\. Keep it\.[\s\S]*## Every one of these must pass[\s\S]*### 1\.spec\.1: issue 1\.spec\.1[\s\S]*boom\(\)/);
  assert.doesNotMatch(t, /```diff/);
});

// ─── the loop against a stand-in harness ──────────────────────────────────────────────────
// script: one entry per delegate call, [command, payload]. review: {role: findings}; a reviewer resumed
// with continue --at: its findings; check: {id: exit, neighbours: exit}; ask: the answer text;
// continue/run: verdict or {verdict, report}.
function harness(script, { sealed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-loop-"));
  const runs = path.join(root, "runs");
  const P = { repo: root, name: "demo", runs, env: {}, map: {}, testGlobs: ["**/*.test.*"] };
  const write = (run, { role, verdict = "pass", findings, report = null, blocked = null }) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "summary.json"), JSON.stringify({ verdict, model: role, base: "b0", report, blocked,
      next: verdict === "pass" ? "review_or_accept" : verdict === "blocked" ? "answer_question" : "continue_with_failure" }));
    fs.writeFileSync(path.join(runs, run, "meta.sh"), `ROLE=${role}\nTEST_CMD=npm\\ test\n${sealed && run === "impl" ? "SEALED=a.test.ts\n" : ""}`);
    fs.writeFileSync(path.join(runs, run, "task.md"), "---\nfiles: [a.ts]\n---\nMake it right.\n");
    if (findings) fs.writeFileSync(path.join(runs, run, "findings.json"), JSON.stringify(findings));
  };
  write("impl", { role: "implement" });
  const roleOf = (run) => fs.readFileSync(path.join(runs, run, "meta.sh"), "utf8").match(/^ROLE=(.*)$/m)[1];
  const calls = [];
  const delegate = async (args, log) => {
    calls.push(args);
    const [cmd] = args, name = args[args.indexOf("--name") + 1];
    const [want, step] = script.shift() ?? [];
    assert.equal(cmd, want, `call ${calls.length}: ${args.join(" ")}`);
    if (cmd === "review") for (const [role, findings] of Object.entries(step)) write(`${name}-${role}`, { role, findings, verdict: "review" });
    else if (cmd === "continue" && args.includes("--at")) { if (step) write(name, { role: roleOf(args[2]), findings: step, verdict: "review" }); }
    else if (cmd === "check") {
      fs.mkdirSync(path.join(runs, name), { recursive: true });
      fs.writeFileSync(path.join(runs, name, "test.log"), Object.entries(step).map(([id, e]) => (id === "neighbours"
        ? `AGENT-BOX-NEIGHBOURS exit ${e}\n    not ok 1 - trusted child\n${e ? "AGENT-BOX-NEIGHBOURS-BASE exit 0\n" : ""}`
        : `AGENT-BOX-REPRO ${id} exit ${e}\n`)).join(""));
    } else if (cmd === "ask") fs.writeFileSync(log, step);
    else {
      const s = typeof step === "string" ? { verdict: step } : step;
      write(name, { role: cmd === "run" ? args[args.indexOf("--role") + 1] : "implement", ...s });
    }
  };
  // No base suite unless a test gives one: the script lists every call in order.
  const deps = { delegate, record: () => {}, readAll: () => [], baseSuite: async () => null };
  const left = () => assert.equal(script.length, 0, `unused script steps: ${JSON.stringify(script)}`);
  return { P, calls, deps, left, msg: (call) => fs.readFileSync(call[call.indexOf("-f") + 1], "utf8") };
}
const R = (issue, extra = {}) => ({ severity: "high", confidence: "CONFIRMED", category: "logic", file: "a.ts", line: 1, issue, scenario: "s", basis: "task: it must", repro: REPRO, ...extra });

test("loop: no sealed acceptance test, no loop, unless the orchestrator says --no-spec", async () => {
  const h = harness([["review", { "review-spec": [], "review-std": [] }]], { sealed: false });
  await assert.rejects(loop(h.P, "impl", { name: "L" }, h.deps), /no sealed acceptance test/);
  const st = await loop(h.P, "impl", { name: "L", noSpec: true }, h.deps);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: a first review that passes approves at once, with no check", async () => {
  const h = harness([["review", { "review-spec": [], "review-std": [] }]]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(h.calls.length, 1);
  h.left();
});

test("loop: proven, fixed, rechecked by the same reviewer session on the fix; no final full review", async () => {
  const h = harness([
    ["review", { "review-spec": [R("gate runs")], "review-std": [] }],
    ["check", { "1.spec.1": 1 }],
    ["continue", "pass"],
    ["continue", []],                                               // the spec reviewer, resumed on the fix
    ["check", { "1.spec.1": 0 }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(st.reason, /recheck/);
  assert.equal(st.last, "L-fix1");
  assert.deepEqual(st.rounds.map((r) => r.kind), ["first", "fix"]);
  assert.match(h.msg(h.calls[2]), /## 1\.spec\.1: gate runs[\s\S]*boom\(\)[\s\S]*## Before you end: prove it/);
  const re = h.calls[3];
  assert.deepEqual([re[2], re[re.indexOf("--at") + 1], re[re.indexOf("--name") + 1], re[re.indexOf("--steps") + 1]],
    ["L-rv1-review-spec", "agent/L-fix1", "L-rv2-review-spec", "40"]);
  assert.match(h.msg(re), /git diff agent\/impl\.\.HEAD[\s\S]*`1\.spec\.1` \(high\): gate runs/);
  assert.deepEqual(Object.keys(st.proofs), ["1.spec.1"]);
  assert.deepEqual(st.rounds[1].fixed, ["1.spec.1"]);
  h.left();
});

test("loop: a reviewer session that cannot be resumed falls back to a cold review of the fix", async () => {
  const h = harness([
    ["review", { "review-spec": [R("gate runs")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", "pass"],
    ["continue", null],                                             // no run: the session could not be restored
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 0 }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  const cold = h.calls[4];
  assert.deepEqual([cold[cold.indexOf("--roles") + 1], cold[cold.indexOf("--against") + 1], cold[cold.indexOf("--name") + 1]], ["review-spec", "agent/impl", "L-rv2"]);
  h.left();
});

test("loop: the proof suite reruns every round; a later fix that breaks an earlier one reopens it", async () => {
  const h = harness([
    ["review", { "review-spec": [R("a", { severity: "medium" }), R("b", { severity: "medium" })], "review-std": [] }], ["check", { "1.spec.1": 1, "1.spec.2": 1 }],
    ["continue", "pass"], ["continue", []], ["check", { "1.spec.1": 0, "1.spec.2": 1 }],
    ["continue", "pass"], ["continue", []], ["check", { "1.spec.1": 1, "1.spec.2": 0 }],
    ["continue", "pass"], ["continue", []], ["check", { "1.spec.1": 0, "1.spec.2": 0 }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[5]), /## Before you end: prove it[\s\S]*`1\.spec\.1` \(fixed earlier, keep it passing\)/);
  assert.deepEqual(st.rounds[2].broke, ["1.spec.1"]);
  assert.match(h.msg(h.calls[8]), /## 1\.spec\.1: a .* - fixed earlier, broken again/);
  assert.equal(h.calls[6][2], "L-rv2-review-spec", "each recheck resumes the latest reviewer session");
  h.left();
});

test("loop: a stall starts two fresh attempts from the base; equals go to the selector; the pick gets a full review", async () => {
  const h = harness([
    ["review", { "review-spec": [R("stuck")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", "pass"], ["continue", []], ["check", { "1.spec.1": 1 }],
    ["continue", "pass"], ["continue", []], ["check", { "1.spec.1": 1 }],
    ["run", "pass"], ["run", "pass"],                              // implement and implement-hard, in parallel
    ["check", { "1.spec.1": 0 }], ["check", { "1.spec.1": 0 }],    // each held to the proof suite
    ["ask", "PICK: B\nsmaller and complete"],
    ["review", { "review-spec": [], "review-std": [] }], ["check", { "1.spec.1": 0 }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(st.last, "L-fresh3-implement-hard");
  assert.deepEqual(st.rounds.map((r) => r.kind), ["first", "fix", "fix", "first"]);
  const [a, b] = [h.calls[8], h.calls[9]];
  assert.deepEqual([a[a.indexOf("--role") + 1], b[b.indexOf("--role") + 1], a[a.indexOf("--base") + 1]], ["implement", "implement-hard", "b0"]);
  assert.match(fs.readFileSync(a[2], "utf8"), /Make it right\.[\s\S]*## Every one of these must pass[\s\S]*1\.spec\.1: stuck/);
  assert.deepEqual(h.calls[12].slice(0, 4), ["ask", h.P.repo, "--role", "advise-alt"]);
  assert.deepEqual(st.escalations.map((e) => [e.to, e.chosen]), [["fresh", "L-fresh3-implement-hard"]]);
  h.left();
});

test("loop: a fix that fails its own tests goes to fresh attempts; none passing stops for the orchestrator", async () => {
  const h = harness([
    ["review", { "review-spec": [R("bug")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", "fail"], ["run", "fail"], ["run", "no_change"],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "decide");
  assert.match(st.reason, /no fresh attempt passed/);
  assert.deepEqual(st.escalations[0].verdicts, ["fail", "no_change"]);
  h.left();
});

test("loop: a spec question stops; the answer goes to the worker and to the resumed reviewer", async () => {
  const h = harness([
    ["review", { "review-spec": [R("block in a container too?", { category: "spec_question", repro: undefined })], "review-std": [] }],
    ["continue", "pass"],
    ["continue", []],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "answer_spec");
  st = await resume(h.P, "L", { answer: "Keep the gate running inside a container." }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[1]), /## The orchestrator's ruling\s+Keep the gate running inside a container\./);
  assert.match(h.msg(h.calls[2]), /rulings, binding:[\s\S]*1\. Keep the gate running inside a container\./);
  h.left();
});

test("loop: a serious finding without a reproduction goes to the orchestrator, who can drop it", async () => {
  const h = harness([["review", { "review-spec": [R("trust me", { repro: undefined })], "review-std": [] }]]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "triage");
  st = await resume(h.P, "L", { drop: ["1.spec.1"] }, h.deps);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: the worker disputes a proven finding; still failing, it goes to the orchestrator, who keeps it", async () => {
  const h = harness([
    ["review", { "review-spec": [R("wrong?")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", { verdict: "pass", report: { disputes: [{ finding: "1.spec.1", why: "the spec says so" }] } }],
    ["continue", []], ["check", { "1.spec.1": 1 }],
    ["continue", "pass"],
    ["continue", []], ["check", { "1.spec.1": 0 }],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "triage");
  assert.deepEqual(st.disputes.map((d) => d.finding), ["1.spec.1"]);
  st = await resume(h.P, "L", {}, h.deps);
  assert.match(h.msg(h.calls[5]), /keeps `1\.spec\.1`: fix them/);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: advice alone gets one fix round; both reviewers recheck when the standards one sent something", async () => {
  const docs = R("no glossary entry", { severity: "medium", category: "standard", repro: undefined });
  const h = harness([
    ["review", { "review-spec": [], "review-std": [docs] }],
    ["continue", "pass"],
    ["continue", []], ["continue", [docs]],                         // raised again: advice is spent, approve
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[1]), /## Also fix[\s\S]*no glossary entry/);
  assert.deepEqual([h.calls[2][2], h.calls[3][2]], ["L-rv1-review-spec", "L-rv1-review-std"]);
  h.left();
});

test("loop: a BLOCKED fix round stops; the answer resumes that same worker", async () => {
  const h = harness([
    ["review", { "review-spec": [R("bug")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", { verdict: "blocked", blocked: "alias or drop?" }],
    ["continue", "pass"],
    ["continue", []], ["check", { "1.spec.1": 0 }],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "answer_question");
  st = await resume(h.P, "L", { message: "Drop it." }, h.deps);
  assert.equal(h.calls[3][2], "L-fix1");
  assert.match(h.msg(h.calls[3]), /Drop it\./);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: a regression in the tests next to the change goes back with the neighbour command to run", async () => {
  const h = harness([
    ["review", { "review-spec": [], "review-std": [] }], ["check", { neighbours: 1 }],
    ["continue", "pass"],
    ["continue", []], ["check", { neighbours: 0 }],
  ]);
  h.P.map = { test_file_command: "npx tsx --test {files}" };
  h.deps.neighbours = () => ["src/a.test.ts"];
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[2]), /## Regression[\s\S]*`npx tsx --test src\/a\.test\.ts` fails on your branch and passes on the base[\s\S]*trusted child[\s\S]*The tests next to your change: `npx tsx --test src\/a\.test\.ts`/);
  assert.deepEqual(st.baseCache, { key: "src/a.test.ts", exit: 0, fails: [] });
  h.left();
});

test("loop: an unreadable review stops; resuming runs the review again instead of deciding without it", async () => {
  const h = harness([["review", { "review-spec": [], "review-std": [] }]]);
  fs.mkdirSync(path.join(h.P.runs, "rv-a"), { recursive: true });
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "summary.json"), JSON.stringify({ verdict: "review", next: "read_final_message" }));
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "findings.json"), JSON.stringify({ parse_error: "x" }));
  let st = await loop(h.P, "impl", { name: "L", reviews: ["rv-a"] }, h.deps);
  assert.equal(st.next, "read_final_message");
  assert.equal(st.redo, "review");
  st = await resume(h.P, "L", {}, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(h.calls[0][0], "review");
  assert.equal(st.redo, undefined);
  h.left();
});

test("delegate.sh review --name and --prior: runs named by the prefix, each axis gets only its own", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const BOX = path.resolve(import.meta.dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-prior-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  git("branch", "agent/x");
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, "OMNIROUTE_API_KEY=\n");
  const prior = path.join(dir, "prior.md");
  fs.writeFileSync(prior, fixContext([F("1.spec.1")]));
  const runs = path.join(BOX, "runs", path.basename(dir).toLowerCase());
  try {
    spawnSync("bash", ["delegate.sh", "review", dir, "agent/x", "--name", "L-rv2", "--prior", `spec=${prior}`],
      { cwd: BOX, encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env, AGENT_BOX_HERDR: "0" } });
    const tdir = fs.readdirSync(runs).find((f) => f.startsWith(".review-"));
    const spec = fs.readFileSync(path.join(runs, tdir, "task-review-spec.md"), "utf8");
    const std = fs.readFileSync(path.join(runs, tdir, "task-review-std.md"), "utf8");
    assert.match(spec, /## What the last fix was for[\s\S]*`1\.spec\.1`/);
    assert.ok(spec.indexOf("What the last fix was for") < spec.indexOf("Review the change on this branch"));
    assert.doesNotMatch(std, /What the last fix was for/);
    assert.deepEqual(fs.readdirSync(runs).filter((f) => f.endsWith(".log")).sort(), [".L-rv2-review-spec.log", ".L-rv2-review-std.log"]);
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test("loop: progress.jsonl tells the live view every step, finding and decision, ending with what to do", async () => {
  const h = harness([
    ["review", { "review-spec": [R("gate runs"), R("not real")], "review-std": [] }],
    ["check", { "1.spec.1": 1, "1.spec.2": 0 }],
    ["continue", "pass"],
    ["continue", []],
    ["check", { "1.spec.1": 0 }],
  ]);
  const tabs = [];
  await loop(h.P, "impl", { name: "L" }, { ...h.deps, openTab: (P, name) => tabs.push(name) });
  const ev = fs.readFileSync(path.join(h.P.runs, "_loops", "L", "progress.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(tabs, ["L"]);
  assert.deepEqual(ev.map((e) => e.ev + (e.what ? `:${e.what}` : "")), [
    "start", "round", "step:review", "done:review", "step:check", "done:check", "findings", "decide",
    "step:fix", "done:fix",
    "round", "step:review", "done:review", "step:check", "done:check", "findings", "decide", "end"]);
  assert.deepEqual(ev.find((e) => e.ev === "findings").items.map((f) => [f.id, f.route, f.exit]), [["1.spec.1", "proven", 1], ["1.spec.2", "dropped", 0]]);
  assert.deepEqual([ev[11].runs, ev[11].resumed], [["L-rv2-review-spec"], true], "the recheck resumes the spec reviewer");
  assert.deepEqual(ev.at(-1), { ...ev.at(-1), next: "approve", last: "L-fix1" });
  h.left();
});

test("loop: with the base suite known, a check runs its neighbours on the branch only and compares names", async () => {
  const h = harness([
    ["review", { "review-spec": [], "review-std": [] }], ["check", { neighbours: 1 }],
    ["continue", "pass"],
    ["continue", []], ["check", { neighbours: 0 }],
  ]);
  h.P.map = { test_file_command: "npx tsx --test {files}" };
  h.deps.neighbours = () => ["src/a.test.ts"];
  h.deps.baseSuite = async () => ({ exit: 1, fails: ["linux path", "elsewhere"] });
  // The script would run no base: drop the fake's base line and name the branch's failures.
  const inner = h.deps.delegate;
  h.deps.delegate = async (args, log) => {
    await inner(args, log);
    if (args[0] !== "check") return;
    const f = path.join(h.P.runs, args[args.indexOf("--name") + 1], "test.log");
    const t = fs.readFileSync(f, "utf8").replace(/^AGENT-BOX-NEIGHBOURS-BASE.*\n/m, "");
    fs.writeFileSync(f, /NEIGHBOURS exit 1/.test(t) ? `${t}AGENT-BOX-NFAIL trusted child\nAGENT-BOX-NFAIL linux path\n` : t);
  };
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.doesNotMatch(fs.readFileSync(path.join(h.P.runs, "_loops", "L", "check1", ".agent-box-verify", "run.sh"), "utf8"), /NEIGHBOURS-BASE/);
  const m = h.msg(h.calls[2]);
  assert.match(m, /## Regression[\s\S]*trusted child/);
  assert.match(m, /These already fail on the base; ignore them: `linux path`\./, "only the base failures this run hit");
  assert.equal(st.baseCache, null);
  assert.equal(st.next, "approve");
  h.left();
});

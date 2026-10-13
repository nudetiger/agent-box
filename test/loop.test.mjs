// The review and fix loop: routing, when it fixes, reviews again, escalates, stops or approves. The
// rules are tested directly; the loop itself runs against a stand-in for delegate.sh that writes run
// folders, so no container starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, decide, nextTier, fixMessage, fixContext, loop, resume } from "../lib/loop.mjs";

const CFG = { maxRounds: 6, stuck: 2, softRounds: 3, neighbours: 30, ladder: ["implement", "implement-hard", "escalate"] };
const REPRO = { file: "/tmp/r.test.ts", content: "boom()", cmd: "npx tsx --test /tmp/r.test.ts" };
const F = (id, extra = {}) => ({ id, severity: "high", confidence: "CONFIRMED", category: "logic", issue: `issue ${id}`, file: "a.ts", line: 1, scenario: "s", repro: REPRO, ...extra });

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
  ], { "1.spec.1": 1, "1.spec.2": 1, "1.spec.3": 0 });
  const ids = (a) => a.map((f) => f.id);
  assert.deepEqual(ids(c.blocking), ["1.spec.1"]);
  assert.deepEqual(ids(c.dropped), ["1.spec.3"]);
  assert.deepEqual(ids(c.questions), ["1.spec.4"]);
  assert.deepEqual(ids(c.queue), ["1.spec.5"]);
  assert.deepEqual(ids(c.advice), ["1.std.1"]);
  assert.deepEqual(ids(c.notes), ["1.spec.2", "1.std.2", "1.std.3"]);
});

const X = (o = {}) => ({ round: 1, kind: "first", open: [], questions: 0, queue: 0, disputes: 0, advice: 0, adviceUsed: false, fixesTotal: 0, fixesByTier: 0, ...o });
const open = (id, survived = 0, extra = {}) => ({ id, severity: "high", survived, ...extra });

test("a first review that passes is the last: no final review", () => {
  assert.deepEqual(decide(X(), CFG).action, "approve");
});

test("after a fix: a clean fix review leads to one final full review, and a clean final review approves", () => {
  assert.equal(decide(X({ round: 2, kind: "fix", fixesTotal: 1 }), CFG).action, "final");
  assert.equal(decide(X({ round: 3, kind: "final", fixesTotal: 1 }), CFG).action, "approve");
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

test("a reproduction still failing after two fixes escalates; a regression after one", () => {
  assert.equal(decide(X({ round: 2, kind: "fix", fixesTotal: 1, fixesByTier: 1, open: [open("1.spec.1", 1)] }), CFG).action, "fix");
  const d = decide(X({ round: 3, kind: "fix", fixesTotal: 2, fixesByTier: 2, open: [open("1.spec.1", 2)] }), CFG);
  assert.equal(d.action, "escalate");
  assert.equal(decide(X({ round: 2, kind: "fix", open: [open("regression", 1, { regression: true })] }), CFG).action, "escalate");
});

test("new serious findings every round: escalate after 3 fix rounds by one worker; medium ones keep going", () => {
  assert.equal(decide(X({ round: 4, kind: "fix", fixesByTier: 3, open: [open("4.spec.1")] }), CFG).action, "escalate");
  assert.equal(decide(X({ round: 4, kind: "fix", fixesByTier: 3, open: [open("4.spec.1", 0, { severity: "medium" })] }), CFG).action, "fix");
});

test("the round cap stops for the orchestrator, also before a final review", () => {
  assert.equal(decide(X({ round: 6, kind: "fix", open: [open("6.spec.1", 0, { severity: "medium" })] }), CFG).next, "decide");
  assert.equal(decide(X({ round: 6, kind: "fix", fixesTotal: 3 }), CFG).next, "decide");
});

test("the ladder", () => {
  assert.equal(nextTier(CFG.ladder, "implement"), "implement-hard");
  assert.equal(nextTier(CFG.ladder, "escalate"), null);
  assert.equal(nextTier(CFG.ladder, "quick"), "implement");
});

test("the fix message carries each reproduction, the regression, the advice and how to dispute", () => {
  const m = fixMessage(2, [{ id: "1.spec.1", severity: "high", survived: 1, finding: F("1.spec.1") },
    { id: "regression", regression: true, cmd: "npx tsx --test a.test.ts", tail: "not ok 3" }],
  [F("2.std.1", { severity: "medium", category: "standard", repro: undefined })], ["## The orchestrator's ruling\n\nKeep it in the container."]);
  assert.match(m, /## 1\.spec\.1: issue 1\.spec\.1 \(high, logic\) - still failing after 1 fix/);
  assert.match(m, /```\nboom\(\)\n```/);
  assert.match(m, /`npx tsx --test a\.test\.ts` passes on the base and fails on your branch[\s\S]*not ok 3/);
  assert.match(m, /## Also fix[\s\S]*`2\.std\.1`/);
  assert.match(m, /under `disputes`/);
  assert.match(m, /Keep it in the container\./);
  assert.match(fixContext([F("1.spec.1")]), /do not report\s+them again just because they were listed/);
});

// ─── the loop against a stand-in harness ──────────────────────────────────────────────────
// script: one entry per delegate call, [command, payload]. review: {role: findings}; check: {id: exit};
// continue/run: verdict or {verdict, report}.
function harness(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-loop-"));
  const runs = path.join(root, "runs");
  const P = { repo: root, name: "demo", runs, env: {}, map: {}, testGlobs: ["**/*.test.*"] };
  const write = (run, { role, verdict = "pass", findings, report = null, blocked = null }) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "summary.json"), JSON.stringify({ verdict, model: role, base: "b0", report, blocked,
      next: verdict === "pass" ? "review_or_accept" : verdict === "blocked" ? "answer_question" : "continue_with_failure" }));
    fs.writeFileSync(path.join(runs, run, "meta.sh"), `ROLE=${role}\nTEST_CMD=npm\\ test\n`);
    fs.writeFileSync(path.join(runs, run, "task.md"), "---\nfiles: [a.ts]\n---\nMake it right.\n");
    if (findings) fs.writeFileSync(path.join(runs, run, "findings.json"), JSON.stringify(findings));
  };
  write("impl", { role: "implement" });
  const calls = [];
  const delegate = async (args) => {
    calls.push(args);
    const [cmd] = args, name = args[args.indexOf("--name") + 1];
    const [want, step] = script.shift() ?? [];
    assert.equal(cmd, want, `call ${calls.length}: ${args.join(" ")}`);
    if (cmd === "review") for (const [role, findings] of Object.entries(step)) write(`${name}-${role}`, { role, findings });
    else if (cmd === "check") {
      fs.mkdirSync(path.join(runs, name), { recursive: true });
      fs.writeFileSync(path.join(runs, name, "test.log"), Object.entries(step).map(([id, e]) => (id === "neighbours"
        ? `AGENT-BOX-NEIGHBOURS exit ${e}\n    not ok 1 - trusted child\n${e ? "AGENT-BOX-NEIGHBOURS-BASE exit 0\n" : ""}`
        : `AGENT-BOX-REPRO ${id} exit ${e}\n`)).join(""));
    } else {
      const s = typeof step === "string" ? { verdict: step } : step;
      write(name, { role: cmd === "run" ? args[args.indexOf("--role") + 1] : "implement", ...s });
    }
  };
  const deps = { delegate, record: () => {}, readAll: () => [] };
  const left = () => assert.equal(script.length, 0, `unused script steps: ${JSON.stringify(script)}`);
  return { P, calls, deps, left, msg: (call) => fs.readFileSync(call[call.indexOf("-f") + 1], "utf8") };
}
const R = (issue, extra = {}) => ({ severity: "high", confidence: "CONFIRMED", category: "logic", file: "a.ts", line: 1, issue, scenario: "s", repro: REPRO, ...extra });

test("loop: a first review that passes approves at once, with no check and no final review", async () => {
  const h = harness([["review", { "review-spec": [], "review-std": [] }]]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(h.calls.length, 1);
  h.left();
});

test("loop: proven, fixed, the fix reviewed on its own diff by the spec axis, then one final full review", async () => {
  const h = harness([
    ["review", { "review-spec": [R("gate runs")], "review-std": [] }],
    ["check", { "1.spec.1": 1 }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }],
    ["check", { "1.spec.1": 0 }],                                   // the carried reproduction now passes
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(st.last, "L-fix1");
  assert.deepEqual(st.rounds.map((r) => r.kind), ["first", "fix", "final"]);
  assert.match(h.msg(h.calls[2]), /## 1\.spec\.1: gate runs[\s\S]*boom\(\)/);
  const fixReview = h.calls[3];
  assert.deepEqual([fixReview[fixReview.indexOf("--roles") + 1], fixReview[fixReview.indexOf("--against") + 1]], ["review-spec", "agent/impl"]);
  assert.match(fixReview[fixReview.indexOf("--prior") + 1], /^spec=.*fixctx-2\.md$/);
  assert.ok(!h.calls[5].includes("--roles") && !h.calls[5].includes("--against"), "the final review is the whole change, both axes");
  assert.deepEqual(st.rounds[1].fixed, ["1.spec.1"]);
  h.left();
});

test("loop: a reproduction that passes on the branch is a false positive: approved with no fix", async () => {
  const h = harness([["review", { "review-spec": [R("not real")], "review-std": [] }], ["check", { "1.spec.1": 0 }]]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.deepEqual(st.rounds[0].dropped, ["1.spec.1"]);
  h.left();
});

test("loop: still failing after two fixes goes up a rung with the last attempt; the new worker's clean reviews approve", async () => {
  const h = harness([
    ["review", { "review-spec": [R("stuck")], "review-std": [] }], ["check", { "1.spec.1": 1 }], ["continue", "pass"],
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 1 }], ["continue", "pass"],
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 1 }],
    ["run", "pass"],                                                // implement-hard
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 0 }],
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.equal(st.last, "L-esc3-implement-hard");
  const esc = h.calls[8];
  assert.deepEqual([esc[esc.indexOf("--role") + 1], esc[esc.indexOf("--base") + 1]], ["implement-hard", "agent/L-fix2"]);
  assert.ok(esc.includes("--no-red") && esc[esc.indexOf("--test") + 1] === "npm test");
  const task = fs.readFileSync(esc[2], "utf8");
  assert.match(task, /Make it right\.[\s\S]*1\.spec\.1 still failing after 2 fixes[\s\S]*## The last attempt \(L-fix2\)[\s\S]*## 1\.spec\.1: stuck/);
  h.left();
});

test("loop: a spec question stops; the answer goes to the worker and to every later reviewer", async () => {
  const h = harness([
    ["review", { "review-spec": [R("block in a container too?", { category: "spec_question", repro: undefined })], "review-std": [] }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }],
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "answer_spec");
  st = await resume(h.P, "L", { answer: "Keep the gate running inside a container." }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[1]), /## The orchestrator's ruling\s+Keep the gate running inside a container\./);
  const spec = h.calls[2][h.calls[2].lastIndexOf("--spec") + 1];
  assert.match(fs.readFileSync(spec, "utf8"), /1\. Keep the gate running inside a container\./);
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
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 0 }],
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "triage");
  assert.deepEqual(st.disputes.map((d) => d.finding), ["1.spec.1"]);
  st = await resume(h.P, "L", {}, h.deps);
  assert.match(h.msg(h.calls[5]), /keeps `1\.spec\.1`: fix them/);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: advice alone gets one fix round, then the fix review and the final review", async () => {
  const docs = R("no glossary entry", { severity: "medium", category: "standard", repro: undefined });
  const h = harness([
    ["review", { "review-spec": [], "review-std": [docs] }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }],
    ["review", { "review-spec": [], "review-std": [docs] }],       // raised again: advice is spent, a note now
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[1]), /## Also fix[\s\S]*no glossary entry/);
  h.left();
});

test("loop: a fix that fails its tests escalates from the last good branch; no rung left stops", async () => {
  const h = harness([
    ["review", { "review-spec": [R("bug")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", "fail"], ["run", "fail"], ["run", "no_change"],
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "decide");
  assert.match(st.reason, /no rung above escalate/);
  assert.deepEqual(st.escalations.map((e) => [e.to, e.verdict]), [["implement-hard", "fail"], ["escalate", "no_change"]]);
  assert.ok(h.calls.slice(3).every((a) => a[a.indexOf("--base") + 1] === "agent/impl"));
  assert.match(fs.readFileSync(h.calls[3][2], "utf8"), /## The last attempt \(L-fix1, discarded: its tests failed\)/);
  h.left();
});

test("loop: a BLOCKED fix round stops; the answer resumes that same worker", async () => {
  const h = harness([
    ["review", { "review-spec": [R("bug")], "review-std": [] }], ["check", { "1.spec.1": 1 }],
    ["continue", { verdict: "blocked", blocked: "alias or drop?" }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }], ["check", { "1.spec.1": 0 }],
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  let st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "answer_question");
  st = await resume(h.P, "L", { message: "Drop it." }, h.deps);
  assert.equal(h.calls[3][2], "L-fix1");
  assert.match(h.msg(h.calls[3]), /Drop it\./);
  assert.equal(st.next, "approve");
  h.left();
});

test("loop: a regression in the tests next to the change goes back once, then up a rung; the new worker clears it", async () => {
  const h = harness([
    ["review", { "review-spec": [], "review-std": [] }], ["check", { neighbours: 1 }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }], ["check", { neighbours: 1 }],
    ["run", "pass"],
    ["review", { "review-spec": [] }], ["check", { neighbours: 0 }],
    ["review", { "review-spec": [], "review-std": [] }], ["check", { neighbours: 0 }],
  ]);
  h.P.map = { test_file_command: "npx tsx --test {files}" };
  h.deps.neighbours = () => ["src/a.test.ts"];
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  assert.match(h.msg(h.calls[2]), /## Regression[\s\S]*`npx tsx --test src\/a\.test\.ts` passes on the base[\s\S]*trusted child/);
  assert.deepEqual(st.escalations.map((e) => e.to), ["implement-hard"]);
  assert.match(st.escalations[0].reason, /regression still failing/);
  h.left();
});

test("loop: an unreadable review stops with read_final_message", async () => {
  const h = harness([]);
  fs.mkdirSync(path.join(h.P.runs, "rv-a"), { recursive: true });
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "summary.json"), JSON.stringify({ verdict: "review", next: "read_final_message" }));
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "findings.json"), JSON.stringify({ parse_error: "x" }));
  const st = await loop(h.P, "impl", { name: "L", reviews: ["rv-a"] }, h.deps);
  assert.equal(st.next, "read_final_message");
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
    ["review", { "review-spec": [] }],
    ["check", { "1.spec.1": 0 }],
    ["review", { "review-spec": [], "review-std": [] }],
  ]);
  const tabs = [];
  await loop(h.P, "impl", { name: "L" }, { ...h.deps, openTab: (P, name) => tabs.push(name) });
  const ev = fs.readFileSync(path.join(h.P.runs, "_loops", "L", "progress.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(tabs, ["L"]);
  assert.deepEqual(ev.map((e) => e.ev + (e.what ? `:${e.what}` : "")), [
    "start", "round", "step:review", "done:review", "step:check", "done:check", "findings", "decide",
    "step:fix", "done:fix",
    "round", "step:review", "done:review", "step:check", "done:check", "findings", "decide",
    "round", "step:review", "done:review", "findings", "decide", "end"]);
  assert.deepEqual(ev.find((e) => e.ev === "findings").items.map((f) => [f.id, f.route, f.exit]), [["1.spec.1", "proven", 1], ["1.spec.2", "dropped", 0]]);
  assert.deepEqual(ev[11].runs, ["L-rv2-review-spec"], "the fix review is the spec axis only");
  assert.deepEqual(ev.at(-1), { ...ev.at(-1), next: "approve", last: "L-fix1" });
  h.left();
});

// The review and fix loop: when it fixes again, when it escalates, when it stops. The decision rule is
// tested directly; the loop itself runs against a stand-in for delegate.sh that writes run folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, survived, nextTier, priorText, loop } from "../lib/loop.mjs";

const CFG = { maxRounds: 6, stuck: 2, softRounds: 3, ladder: ["implement", "implement-hard", "escalate"] };
const F = (id, severity = "high", extra = {}) => ({ id, severity, confidence: "CONFIRMED", issue: id, ...extra });
const round = (tier, ...findings) => ({ tier, findings });

test("no CONFIRMED finding is clean; PLAUSIBLE ones do not block", () => {
  assert.equal(decide([round("implement", { id: "1.spec.1", severity: "high", confidence: "PLAUSIBLE" })], CFG).action, "clean");
  assert.equal(decide([round("implement", F("1.spec.1"))], CFG).action, "fix");
});

test("the same finding open after two fixes by one worker escalates; after one it is fixed again", () => {
  const once = [round("implement", F("1.spec.1")), round("implement", F("2.spec.1", "high", { prior: "1.spec.1" }))];
  assert.equal(survived(once, once[1].findings[0]), 1);
  assert.equal(decide(once, CFG).action, "fix");
  const twice = [...once, round("implement", F("3.spec.1", "low", { prior: "2.spec.1" }))];
  const d = decide(twice, CFG);
  assert.equal(d.action, "escalate");
  assert.match(d.reason, /2\.spec\.1 still open after 2 fixes/);
});

test("a new worker starts its count again: fixes by the rung below do not count", () => {
  const rounds = [round("implement", F("1.spec.1")), round("implement", F("2.spec.1", "high", { prior: "1.spec.1" })),
    round("implement-hard", F("3.spec.1", "high", { prior: "2.spec.1" }))];
  assert.equal(survived(rounds, rounds[2].findings[0]), 0);
  assert.equal(decide(rounds, CFG).action, "fix");
});

test("new bugs every round: minor ones keep the loop going, serious ones after 3 fix rounds escalate", () => {
  const minor = [1, 2, 3, 4].map((k) => round("implement", F(`${k}.spec.1`, "medium")));
  assert.equal(decide(minor, CFG).action, "fix");
  const serious = [1, 2, 3].map((k) => round("implement", F(`${k}.spec.1`, "medium")));
  assert.equal(decide([...serious, round("implement", F("4.std.1", "critical"))], CFG).action, "escalate");
  assert.equal(decide([...serious.slice(0, 2), round("implement", F("3.std.1", "critical"))], CFG).action, "fix");
});

test("the round cap stops the loop for the orchestrator", () => {
  const six = [1, 2, 3, 4, 5, 6].map((k) => round("implement", F(`${k}.spec.1`, "low")));
  assert.equal(decide(six, CFG).action, "stop");
});

test("the ladder: implement, implement-hard, escalate, then nothing; an unknown role starts at the bottom", () => {
  assert.equal(nextTier(CFG.ladder, "implement"), "implement-hard");
  assert.equal(nextTier(CFG.ladder, "implement-hard"), "escalate");
  assert.equal(nextTier(CFG.ladder, "escalate"), null);
  assert.equal(nextTier(CFG.ladder, "quick"), "implement");
});

test("the recheck list names each finding's id, place and failure", () => {
  const t = priorText([F("1.spec.2", "high", { file: "a.ts", line: 3, scenario: "x -> y" })]);
  assert.match(t, /`1\.spec\.2` \(high\): 1\.spec\.2\. Where: `a\.ts:3`\. Fails when: x -> y/);
  assert.match(t, /"prior": "<its id>"/);
});

// ─── the loop against a stand-in harness ──────────────────────────────────────────────────
function harness(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-loop-"));
  const runs = path.join(root, "runs");
  process.env.AGENT_BOX_LEDGER = path.join(root, "ledger.jsonl");   // forward.mjs, run as a child, labels here
  const P = { repo: root, name: "demo", runs, env: {} };
  const write = (run, { role, verdict = "pass", findings, model = "m" }) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "summary.json"), JSON.stringify({ verdict, model, next: verdict === "pass" ? "review_or_accept" : "continue_with_failure" }));
    fs.writeFileSync(path.join(runs, run, "meta.sh"), `ROLE=${role}\nTEST_CMD=npm\\ test\n`);
    fs.writeFileSync(path.join(runs, run, "task.md"), "---\nfiles: [a.ts]\n---\nMake it right.\n");
    if (findings) fs.writeFileSync(path.join(runs, run, "findings.json"), JSON.stringify(findings));
  };
  write("impl", { role: "implement" });
  const calls = [];
  const delegate = async (args) => {
    calls.push(args);
    const [cmd] = args, name = args[args.indexOf("--name") + 1];
    const step = script.shift();
    if (cmd === "review") for (const [role, findings] of Object.entries(step)) write(`${name}-${role}`, { role, findings });
    else write(name, { role: cmd === "run" ? args[args.indexOf("--role") + 1] : "implement", verdict: step });
  };
  return { P, calls, delegate, events: [] };
}
const c = (issue, extra = {}) => ({ severity: "high", confidence: "CONFIRMED", file: "a.ts", line: 1, issue, scenario: "s", ...extra });

test("loop: a bug two fixes do not close goes up a rung, and the new worker's clean review approves", async () => {
  const h = harness([
    { "review-spec": [c("gate runs"), { ...c("maybe"), confidence: "PLAUSIBLE" }], "review-std": [] },
    "pass",
    { "review-spec": [c("gate runs", { prior: "1.spec.1" })], "review-std": [] },
    "pass",
    { "review-spec": [c("gate runs", { prior: "2.spec.1" })], "review-std": [] },
    "pass",                                                       // the implement-hard run
    { "review-spec-alt": [], "review-std": [] },
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, { delegate: h.delegate, record: (...e) => h.events.push(e) });
  assert.equal(st.next, "approve");
  assert.equal(st.last, "L-esc3-implement-hard");
  assert.deepEqual(st.rounds.map((r) => [r.tier, r.confirmed]), [["implement", 1], ["implement", 1], ["implement", 1], ["implement-hard", 0]]);
  // Only the CONFIRMED finding goes to the worker, and the next review rechecks it by id.
  assert.deepEqual(h.calls[1].slice(0, 5), ["continue", h.P.repo, "impl", "--findings", "L-rv1-review-spec:1"]);
  const prior = h.calls[2][h.calls[2].indexOf("--prior") + 1];
  assert.match(prior, /^spec=/);
  assert.match(fs.readFileSync(prior.slice(5), "utf8"), /`1\.spec\.1` \(high\): gate runs/);
  assert.ok(!h.calls[2].includes("std=") && h.calls[2].filter((a) => a === "--prior").length === 1, "no std prior: std had no findings");
  // The escalation: one rung up, on the last good branch, red check off, the task's test kept.
  const esc = h.calls[5];
  assert.deepEqual([esc[0], esc[esc.indexOf("--role") + 1], esc[esc.indexOf("--base") + 1]], ["run", "implement-hard", "agent/L-fix2"]);
  assert.ok(esc.includes("--no-red") && esc[esc.indexOf("--test") + 1] === "npm test");
  const task = fs.readFileSync(esc[2], "utf8");
  assert.match(task, /Make it right\./);
  assert.match(task, /still open after 2 fixes/);
  assert.match(task, /Independent reviewers found these[\s\S]*## 1\. gate runs \(high, CONFIRMED\)/, "forward.mjs wrote the findings");
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], "escalate");
});

test("loop: a fix that fails its tests escalates from the last good branch; no rung left stops for the orchestrator", async () => {
  const h = harness([
    { "review-spec": [c("bug")], "review-std": [] },
    "fail",                                                       // the fix round breaks the tests
    "fail",                                                       // implement-hard fails too
    "no_change",                                                  // escalate (Opus) changes nothing
  ]);
  const st = await loop(h.P, "impl", { name: "L" }, { delegate: h.delegate, record: () => {} });
  assert.equal(st.next, "decide");
  assert.match(st.reason, /no rung above escalate/);
  assert.deepEqual(st.escalations.map((e) => [e.to, e.verdict]), [["implement-hard", "fail"], ["escalate", "no_change"]]);
  assert.ok(h.calls.slice(2).every((a) => a[a.indexOf("--base") + 1] === "agent/impl"), "every escalation starts from the last passing run");
  assert.equal(st.last, "impl");
});

test("loop: an unreadable review stops with read_final_message, a review given up front is used as round 1", async () => {
  const h = harness([]);
  fs.mkdirSync(path.join(h.P.runs, "rv-a"), { recursive: true });
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "summary.json"), JSON.stringify({ verdict: "review", next: "read_final_message" }));
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "meta.sh"), "ROLE=review-spec\n");
  fs.writeFileSync(path.join(h.P.runs, "rv-a", "findings.json"), JSON.stringify({ parse_error: "x" }));
  const st = await loop(h.P, "impl", { name: "L", reviews: ["rv-a"] }, { delegate: h.delegate, record: () => {} });
  assert.equal(st.next, "read_final_message");
  assert.equal(h.calls.length, 0);
});

test("delegate.sh review --name and --prior: runs named by the prefix, each axis rechecks only its own findings", async () => {
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
  fs.writeFileSync(prior, priorText([F("1.spec.1")]));
  const runs = path.join(BOX, "runs", path.basename(dir).toLowerCase());
  try {
    spawnSync("bash", ["delegate.sh", "review", dir, "agent/x", "--name", "L-rv2", "--prior", `spec=${prior}`],
      { cwd: BOX, encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env, AGENT_BOX_HERDR: "0" } });
    const tdir = fs.readdirSync(runs).find((f) => f.startsWith(".review-"));
    const spec = fs.readFileSync(path.join(runs, tdir, "task-review-spec.md"), "utf8");
    const std = fs.readFileSync(path.join(runs, tdir, "task-review-std.md"), "utf8");
    assert.match(spec, /## Recheck the previous round first[\s\S]*`1\.spec\.1`/);
    assert.ok(spec.indexOf("Recheck the previous round") < spec.indexOf("Review the change on this branch"), "the recheck comes before the change");
    assert.doesNotMatch(std, /Recheck the previous round/);
    const logs = fs.readdirSync(runs).filter((f) => f.endsWith(".log"));
    assert.deepEqual(logs.sort(), [".L-rv2-review-spec.log", ".L-rv2-review-std.log"]);
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

// Review mode: split (two reviewers, one axis each) or both (one reviewer, both axes), per project and
// per command; the loop's own choices (fresh attempts, cold fix reviews); findings blocks the harness
// reads even when the fence's name stands on its own line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewRoles, axisOf, promptOf } from "../lib/reviewmode.mjs";
import { useAlt, specRole } from "../lib/family.mjs";
import { finalBlock } from "../lib/ledger.mjs";
import { overrides, loopRoles, fixReviewer, recheckAxes, settings, loop, resume } from "../lib/loop.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("reviewRoles: --roles, then --review-mode, then REVIEW_ROLES, then REVIEW_MODE", () => {
  assert.deepEqual(reviewRoles({}), ["review-spec", "review-std"], "the default is split");
  assert.deepEqual(reviewRoles({ defaultMode: "both" }), ["review-both"]);
  assert.deepEqual(reviewRoles({ listed: "review-spec", defaultMode: "both" }), ["review-spec"], "REVIEW_ROLES over REVIEW_MODE");
  assert.deepEqual(reviewRoles({ mode: "split", listed: "review-spec", defaultMode: "both" }), ["review-spec", "review-std"], "--review-mode over both");
  assert.deepEqual(reviewRoles({ roles: "review-std", mode: "both" }), ["review-std"], "--roles over everything");
  assert.throws(() => reviewRoles({ mode: "three" }), /unknown review mode three/);
});

test("axes and prompts: review-both covers both, with its own prompt", () => {
  assert.deepEqual(["review-spec", "review-spec-alt", "review-std", "review-both", "review-both-alt"].map(axisOf), ["spec", "spec", "std", "both", "both"]);
  for (const r of ["review-spec", "review-std", "review-both"]) assert.ok(fs.existsSync(path.join(BOX, "lib", "ticket", promptOf(r))), r);
  const both = fs.readFileSync(path.join(BOX, "lib", "ticket", "review-both.md"), "utf8");
  assert.match(both, /## 1\. Spec[\s\S]*## 2\. Standards/);
  assert.doesNotMatch(both, /A second reviewer/, "the only reviewer is never told to leave an axis to another");
});

test("family: a reviewer never reviews its own family's code when its -alt can", () => {
  assert.equal(useAlt("deepseek/deepseek-flash-max", "deepseek/deepseek-flash high", "antigravity/claude-opus-4-6-thinking-high"), true);
  assert.equal(useAlt("gemini-3.8-flash-tiered", "deepseek/deepseek-flash high", "antigravity/claude-opus-4-6-thinking-high"), false);
  assert.equal(useAlt("deepseek/x", "deepseek/y", "deepseek/z"), false, "an alt of the same family does not help");
  assert.equal(specRole("antigravity/claude-opus-4-6-thinking-high", "antigravity/claude-opus-4-6-thinking-high", "deepseek/deepseek-flash high"), "review-spec-alt");
});

test("delegate.sh roles: the default stack, and the review mode a project sets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mode-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, "REVIEW_MODE=both\n");
  const out = execFileSync("bash", [path.join(BOX, "delegate.sh"), "roles", dir], { encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env } });
  const row = (n) => out.split("\n").find((l) => l.split(/\s+/)[0] === n)?.split(/\s+/);
  assert.deepEqual(row("REVIEW_MODE"), ["REVIEW_MODE", "project", "both"]);
  assert.equal(row("LOOP_MAX_ROUNDS")?.[2], "5");
  assert.equal(row("adjudicate")?.[2], "cursor/kimi-k3-high");
  assert.equal(row("review-spec")?.[2], "antigravity/claude-opus-4-6-thinking-high");
  assert.deepEqual(row("review-std")?.slice(2), ["deepseek/deepseek-flash", "high"]);
  assert.deepEqual(row("review-both")?.slice(2), ["deepseek/deepseek-flash", "high"]);
  assert.equal(row("implement-hard")?.[2], "deepseek/deepseek-flash-max");
});

test("delegate.sh review in mode both: one review-both run, its own prompt, --prior both=", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-both-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  git("branch", "agent/x");
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, "OMNIROUTE_API_KEY=\nREVIEW_MODE=both\n");
  const prior = path.join(dir, "prior.md");
  fs.writeFileSync(prior, "## What the last fix was for\n");
  const runs = path.join(BOX, "runs", path.basename(dir).toLowerCase());
  const review = (...a) => spawnSync("bash", ["delegate.sh", "review", dir, "agent/x", ...a],
    { cwd: BOX, encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env, AGENT_BOX_HERDR: "0" } });
  try {
    review("--name", "B", "--prior", `both=${prior}`);
    const tdir = fs.readdirSync(runs).find((f) => f.startsWith(".review-"));
    const task = fs.readFileSync(path.join(runs, tdir, "task-review-both.md"), "utf8");
    assert.match(task, /both axes, spec and standards[\s\S]*What the last fix was for/);
    assert.deepEqual(fs.readdirSync(runs).filter((f) => f.endsWith(".log")), [".B-review-both.log"]);
    review("--name", "S", "--review-mode", "split");
    assert.deepEqual(fs.readdirSync(runs).filter((f) => f.startsWith(".S-")).sort(), [".S-review-spec.log", ".S-review-std.log"], "--review-mode wins over the project");
    const bad = review("--review-mode", "three");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /unknown review mode three/);
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test("findings blocks: the name on the fence's line or on the next one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-block-"));
  const read = (text) => { fs.writeFileSync(path.join(dir, "final.md"), text); return finalBlock(dir, "agent-box-findings"); };
  assert.deepEqual(read("x\n```agent-box-findings\n[1]\n```\n"), [1]);
  assert.deepEqual(read("x\n```\nagent-box-findings\n[{\"a\": 2}]\n```\n"), [{ a: 2 }], "RakunMiniItems rv46: the name below a bare fence");
  assert.deepEqual(read("x\n```json\nagent-box-findings\n[3]\n```\n"), [3]);
  assert.equal(read("```agent-box-report\n{}\n```\n"), null, "another block is not the findings");
});

test("loop options: review mode or roles, fresh attempts off or one role, caps", () => {
  assert.deepEqual(overrides({ fresh: "none" }), { fresh: [] });
  assert.deepEqual(overrides({ fresh: "implement-hard" }), { fresh: ["implement-hard"] });
  assert.deepEqual(overrides({ maxRounds: "8", maxFixes: "5" }), { maxRounds: 8, maxFixes: 5 });
  assert.deepEqual(overrides({ reviewMode: "both" }), { reviewMode: "both", reviewRoles: null });
  assert.deepEqual(overrides({ roles: "review-spec", reviewMode: "both" }), { reviewRoles: "review-spec" });
  assert.throws(() => overrides({ reviewMode: "x" }), /unknown review mode/);
  assert.deepEqual(loopRoles({ reviewMode: "both", reviewRoles: null }), ["review-both"]);
  assert.equal(fixReviewer(["review-spec", "review-std"]), "review-spec");
  assert.equal(fixReviewer(["review-both"]), "review-both");
  assert.equal(fixReviewer(["review-std"]), "review-std");
  assert.deepEqual(recheckAxes({ both: "rv" }, [], () => "x/claude-opus", "opus"), ["both"], "one reviewer rechecks everything, whatever its model");
  assert.equal(settings({ env: { REVIEW_MODE: "both" } }).reviewMode, "both");
});

// The loop against a stand-in for delegate.sh (as in loop.test.mjs), in review mode both.
function harness(script, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-loopb-"));
  const runs = path.join(root, "runs");
  const P = { repo: root, name: "demo", runs, env, map: {}, testGlobs: ["**/*.test.*"] };
  const write = (run, { role, verdict = "pass", findings }) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "summary.json"), JSON.stringify({ verdict, model: role, base: "b0", next: "x" }));
    fs.writeFileSync(path.join(runs, run, "meta.sh"), `ROLE=${role}\nTEST_CMD=npm\\ test\n${run === "impl" ? "SEALED=a.test.ts\n" : ""}`);
    fs.writeFileSync(path.join(runs, run, "task.md"), "Make it right.\n");
    if (findings) fs.writeFileSync(path.join(runs, run, "findings.json"), JSON.stringify(findings));
  };
  write("impl", { role: "implement" });
  const roleOf = (run) => fs.readFileSync(path.join(runs, run, "meta.sh"), "utf8").match(/^ROLE=(.*)$/m)[1];
  const calls = [];
  const delegate = async (args) => {
    calls.push(args);
    const [cmd] = args, name = args[args.indexOf("--name") + 1];
    const [want, step] = script.shift() ?? [];
    assert.equal(cmd, want, `call ${calls.length}: ${args.join(" ")}`);
    if (cmd === "review") for (const [role, findings] of Object.entries(step)) write(`${name}-${role}`, { role, findings, verdict: "review" });
    else if (cmd === "continue" && args.includes("--at")) write(name, { role: roleOf(args[2]), findings: step, verdict: "review" });
    else if (cmd === "check") {
      fs.mkdirSync(path.join(runs, name), { recursive: true });
      fs.writeFileSync(path.join(runs, name, "test.log"), Object.entries(step).map(([id, e]) => `AGENT-BOX-REPRO ${id} exit ${e}\n`).join(""));
    } else write(name, { role: "implement", verdict: step });
  };
  const deps = { delegate, record: () => {}, readAll: () => [], baseSuite: async () => null };
  return { P, calls, deps, left: () => assert.equal(script.length, 0, `unused script steps: ${JSON.stringify(script)}`) };
}
const REPRO = { file: "/tmp/r.test.ts", content: "boom()", cmd: "npx tsx --test /tmp/r.test.ts" };
const R = (issue) => ({ severity: "high", confidence: "CONFIRMED", category: "logic", file: "a.ts", line: 1, issue, scenario: "s", basis: "task: it must", repro: REPRO });

test("loop in mode both: one reviewer reviews, and its own session rechecks the fix", async () => {
  const h = harness([
    ["review", { "review-both": [R("gate runs")] }],
    ["check", { "1.both.1": 1 }],
    ["continue", "pass"],
    ["continue", []],
    ["check", { "1.both.1": 0 }],
  ], { REVIEW_MODE: "both" });
  const st = await loop(h.P, "impl", { name: "L" }, h.deps);
  assert.equal(st.next, "approve");
  const first = h.calls[0];
  assert.equal(first[first.indexOf("--roles") + 1], "review-both");
  assert.equal(h.calls[3][2], "L-rv1-review-both", "the review-both session is resumed on the fix");
  h.left();
});

test("loop resume: a higher round cap and a new review mode; the next review is cold with the new reviewer", async () => {
  const h = harness([
    ["review", { "review-both": [R("gate runs")] }],
    ["check", { "1.both.1": 1 }],
    ["continue", "pass"],
    ["review", { "review-spec": [] }],
    ["check", { "1.both.1": 0 }],
  ], { REVIEW_MODE: "both" });
  const st = await loop(h.P, "impl", { name: "L", maxRounds: 1 }, h.deps);
  assert.equal(st.next, "decide", "the round cap stops for the orchestrator");
  const again = await resume(h.P, "L", { maxRounds: 3, reviewMode: "split" }, h.deps);
  assert.equal(again.next, "approve");
  const cold = h.calls[3];
  assert.deepEqual([cold[cold.indexOf("--roles") + 1], cold[cold.indexOf("--against") + 1]], ["review-spec", "agent/impl"]);
  assert.equal(again.settings.maxRounds, 3);
  h.left();
});

test("loop --fresh none: a stall stops for the orchestrator instead of starting fresh attempts", async () => {
  const h = harness([
    ["review", { "review-both": [R("gate runs")] }],
    ["check", { "1.both.1": 1 }],
    ["continue", "fail"],
  ], { REVIEW_MODE: "both" });
  const st = await loop(h.P, "impl", { name: "L", fresh: "none" }, h.deps);
  assert.equal(st.next, "decide");
  assert.match(st.reason, /fresh attempts are off/);
  h.left();
});

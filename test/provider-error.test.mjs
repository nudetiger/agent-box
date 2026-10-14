// A provider error is never a clean finish: OpenCode writes {"type":"error"} and exits 0, and the host
// turns that into verdict error / next fix_environment (lib/ledger.mjs providerError, finish).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-perr-"));
process.env.AGENT_BOX_LEDGER = path.join(tmp, "events.jsonl");
const { finish, providerError, readAll } = await import("../lib/ledger.mjs");
const { verdictOf, nextOf } = await import("../lib/checks.mjs");

// The line runs/lykos/e2e-v2-t194-rv9-review-std(-r2) ended with, 2026-10-14.
const SID = "ses_ec97d059effeRuBE0G5NrX9EJu";
const ERROR_LINE = JSON.stringify({ type: "error", timestamp: 1791917391540, sessionID: SID, error: { name: "UnknownError",
  data: { message: JSON.stringify({ message: "[antigravity/claude-opus-4-6-thinking] [403]: Antigravity upstream error (403): Verify your account to continue. (reset after 5m)" }) } } });
const STEP = JSON.stringify({ type: "step_start", timestamp: 1791917296832, sessionID: SID, part: { type: "step-start" } });

// A run dir as run-task.sh leaves it: summary.json written in the container, before the host's finish.
function runDir(name, events, summary) {
  const dir = path.join(tmp, "lykos", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.jsonl"), events.join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ branch: `agent/${name}`, base: "43f281a7", head: "43f281a7",
    model: "antigravity/claude-opus-4-6-thinking", commits: 0, setup_exit: 0, agent_exit: 0, test_exit: -1, seconds: 131,
    blocked: null, sealed_violation: [], review_violation: false, weak_spec: false, report: null, round: 2, ...summary }));
  return dir;
}

test("the error event's message is unwrapped from the gateway's JSON body and clipped", () => {
  const dir = runDir("parse", [STEP, ERROR_LINE], {});
  assert.equal(providerError(path.join(dir, "events.jsonl")),
    "UnknownError: [antigravity/claude-opus-4-6-thinking] [403]: Antigravity upstream error (403): Verify your account to continue. (reset after 5m)");
  const long = JSON.stringify({ type: "error", error: { name: "APIError", data: { message: "x".repeat(1000) } } });
  fs.writeFileSync(path.join(dir, "events.jsonl"), long + "\n");
  assert.equal(providerError(path.join(dir, "events.jsonl")).length, 300);
  fs.writeFileSync(path.join(dir, "events.jsonl"), STEP + "\n");
  assert.equal(providerError(path.join(dir, "events.jsonl")), null);
  assert.equal(providerError(path.join(dir, "missing.jsonl")), null);
});

test("a review that hit a provider error is verdict error, next fix_environment, not done", () => {
  const dir = runDir("e2e-rv9-review-std-r2", [STEP, ERROR_LINE], { review: true });
  const { s } = finish(tmp, dir);
  assert.match(s.provider_error, /\[403\]: Antigravity upstream error/);
  assert.equal(s.verdict, "error");
  assert.equal(s.next, "fix_environment");
  const ev = readAll();
  const run = ev.find((e) => e.type === "run" && e.run === "e2e-rv9-review-std-r2");
  assert.equal(run.verdict, "error");
  assert.match(run.provider_error, /403/);
  assert.ok(ev.some((e) => e.type === "label" && e.cause === "env" && e.refs[0] === `${run.id}#verdict`), "a 403 is labelled env");
  assert.ok(ev.some((e) => e.type === "review" && e.run === "e2e-rv9-review-std-r2" && e.verdict === "error"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")).next, "fix_environment");
});

test("worker runs too, and a run without an error event is unchanged", () => {
  const worker = { review: false, setup_exit: 0, agent_exit: 0, commits: 1, test_exit: 0, provider_error: "UnknownError: [403]" };
  assert.equal(verdictOf(worker), "error");
  assert.equal(nextOf(worker, "error", []), "fix_environment");
  assert.equal(verdictOf({ ...worker, provider_error: null }), "pass");
  const dir = runDir("clean-review", [STEP], { review: true });
  const { s } = finish(tmp, dir);
  assert.equal(s.provider_error, null);
  assert.equal(s.verdict, "review");
});

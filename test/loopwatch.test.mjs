// The loop's live view (lib/loopwatch.mjs): what each event prints, and the viewer itself, run on a loop
// that already stopped, prints its history and ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { render, palette, dur, hint, herdrState } from "../lib/loopwatch.mjs";

const C = palette(false);
const s0 = () => ({ running: false, k: 0, maxRounds: null, step: null, name: "L", repo: "C:/r" });
const show = (events) => { const s = s0(); return events.flatMap((e) => render({ t: 0, ...e }, s, C, 80)).join("\n"); };

test("a round: what runs, each finding with where it went, what is open, the decision", () => {
  const out = show([
    { ev: "start", run: "impl", tier: "implement", model: "gemini/gemini-3.8-flash-tiered", settings: { maxRounds: 6, ladder: ["implement", "implement-hard"] } },
    { ev: "round", k: 1, kind: "first", run: "impl" },
    { ev: "step", what: "check", run: "L-check1", repros: 2, neighbours: 3 },
    { ev: "done", what: "check", repro: { "1.spec.1": 1, "1.spec.2": 0 }, neighbours: { exit: 1, base_exit: 0, regression: true } },
    { ev: "findings", k: 1, items: [{ id: "1.spec.1", severity: "high", issue: "gate runs", file: "a.ts", line: 3, route: "proven" },
      { id: "1.spec.2", severity: "medium", issue: "not real", route: "dropped" }], fixed: [], regression: true,
      open: [{ id: "1.spec.1", survived: 0 }, { id: "regression", survived: 0 }] },
    { ev: "decide", action: "fix", reason: "2 items open" },
  ]);
  assert.match(out, /starts on agent\/impl \(gemini-3\.8-flash, implement\) · ladder implement → implement-hard/);
  assert.match(out, /round 1\/6 · first review · both axes/);
  assert.match(out, /check +2 reproductions · 3 test files next to the change \(L-check1\)/);
  assert.match(out, /1 reproduction fails · 1 pass · tests next to the change: REGRESSION/);
  assert.match(out, /PROVEN +high +1\.spec\.1 +gate runs a\.ts:3/);
  assert.match(out, /dropped +medium +1\.spec\.2 +not real/);
  assert.match(out, /● open 2: 1\.spec\.1, regression/);
  assert.match(out, /→ fix 2 items open/);
});

test("the end says what the orchestrator does next, with the command", () => {
  const out = show([{ ev: "end", next: "answer_spec", reason: "1 spec questions for the orchestrator", last: "L-fix1" }]);
  assert.match(out, /NEEDS YOU · answer_spec/);
  assert.match(out, /next: delegate\.sh loop resume C:\/r L --answer "\.\.\."/);
  assert.match(show([{ ev: "end", next: "approve", reason: "clean", last: "L-fix1" }]), /APPROVED · agent\/L-fix1[\s\S]*merge agent\/L-fix1/);
  assert.match(hint("fix_environment", "r", "L", "x"), /the run's own next: fix_environment/);
});

test("step times, herdr states, colours only on a terminal", () => {
  assert.deepEqual([dur(42e3), dur(372e3), dur(3840e3)], ["42s", "6m12s", "1h04m"]);
  const s = s0();
  render({ ev: "step", what: "fix", run: "L-fix1", t: 1000, model: "m" }, s, C);
  assert.match(render({ ev: "done", what: "fix", run: "L-fix1", verdict: "fail", t: 373000 }, s, C).join(""), /✗ fix +fail L-fix1 · 6m12s/);
  assert.deepEqual(herdrState({ ev: "end", next: "triage", reason: "r" }, s), ["blocked", "needs you: triage: r"]);
  assert.equal(herdrState({ ev: "end", next: "approve", last: "x" }, s)[0], "idle");
  assert.doesNotMatch(show([{ ev: "decide", action: "fix", reason: "r" }]), /\x1b/);
  assert.match(render({ ev: "decide", action: "fix", reason: "r" }, s0(), palette(true)).join(""), /\x1b\[38;2;209;154;102m/);
});

test("the viewer, run for real on a loop that already stopped: prints its history and ends", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-loopwatch-"));
  const file = path.join(dir, "progress.jsonl");
  fs.writeFileSync(file, [{ ev: "start", run: "impl", settings: { maxRounds: 6 } }, { ev: "round", k: 1, kind: "first", run: "impl" },
    { ev: "decide", action: "approve", reason: "the first review found nothing that blocks" },
    { ev: "end", next: "approve", reason: "the first review found nothing that blocks", last: "impl" }].map((e) => JSON.stringify({ t: Date.now(), ...e })).join("\n") + "\n");
  const out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../lib/loopwatch.mjs"), file, "L", "r"], { encoding: "utf8", timeout: 10000, env: { ...process.env, HERDR_ENV: "", FORCE_COLOR: "" } });
  assert.match(out, /round 1\/6[\s\S]*APPROVED · agent\/impl/);
});

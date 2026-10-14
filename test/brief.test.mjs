// The orchestrator's short reports: a finished run (lib/brief.mjs) and a stopped loop (loopBrief).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brief } from "../lib/brief.mjs";
import { loopBrief } from "../lib/loop.mjs";

const runDir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ab-brief-"));
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(d, f), typeof v === "string" ? v : JSON.stringify(v));
  return d;
};

test("run brief: decisions, disputes, flags and BLOCKED in a few lines; the verdict line last", () => {
  const d = runDir({
    "summary.json": { model: "gemini", test_exit: 0, commits: 2, seconds: 61, blocked: "alias or drop?",
      flags: [{ flag: "OUT-OF-SCOPE", detail: "a.ts" }],
      report: { status: "done", tests: "pass", test_summary: "pass 3\nfail 0", decisions: ["kept the old name"], disputes: [{ finding: "1.spec.2", why: "out of scope" }] } },
    "diffstat.txt": " a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n",
    "verdict.txt": "verdict blocked  next answer_question  (ledger x)\n",
  });
  const b = brief(d).split("\n");
  assert.match(b[0], /gemini · tests pass · 2 commit\(s\) · 1 file changed, 1 insertion\(\+\), 1 deletion\(-\) · 61s/);
  assert.ok(b.includes("BLOCKED: alias or drop?"));
  assert.ok(b.includes("flag OUT-OF-SCOPE: a.ts"));
  assert.ok(b.includes("report: done, tests pass (pass 3 fail 0)"));
  assert.ok(b.includes("  - kept the old name"));
  assert.ok(b.some((l) => /1\.spec\.2/.test(l)));
  assert.equal(b.at(-1), "verdict blocked  next answer_question  (ledger x)");
});

test("run brief: a review gives its findings by severity and the file to read; none says none", () => {
  const d = runDir({ "summary.json": { review: true, model: "deepseek", test_exit: -1 }, "findings.json": [{ severity: "high" }, { severity: "high" }, { severity: "low" }] });
  assert.match(brief(d), /findings: 2 high, 1 low → .*findings\.json/);
  fs.writeFileSync(path.join(d, "findings.json"), "[]");
  assert.match(brief(d), /findings: none/);
  assert.match(brief(d), /verdict \? {2}next \?$/);
});

test("loop brief: open items, spec questions and triage with their text; the next line last", () => {
  const st = { loop: "L", last: "L-fix1", next: "answer_spec", reason: "1 spec questions for the orchestrator", disputes: [], notes: [],
    open: [{ id: "1.spec.1", severity: "high", survived: 1, finding: { issue: "gate runs twice" } }],
    rounds: [{ k: 1, kind: "first", blocking: ["1.spec.1"], fixed: [], questions: ["1.spec.2"], queue: [],
      findings: [{ id: "1.spec.2", severity: "medium", issue: "which order?", file: "a.ts", line: 3 }] }] };
  const b = loopBrief(st, "runs/x/state.json").split("\n");
  assert.ok(b.includes("  - 1.spec.1 (high, survived 1) gate runs twice"));
  assert.ok(b.includes("  - 1.spec.2 (medium) which order? [a.ts:3]"));
  assert.equal(b.at(-1), "next answer_spec: 1 spec questions for the orchestrator");
  const done = loopBrief({ ...st, open: [], next: "approve", reason: "ok", rounds: [{ ...st.rounds[0], questions: [] }] }, "s").split("\n");
  assert.ok(done.includes("open: none"));
});

// Few-shot calibration for reviewers from the ledger (lib/examples.mjs), read into every reviewer's task.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { examples } from "../lib/examples.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "examples.mjs");
const review = (id, project, findings) => ({ v: 1, id, type: "review", project, run: `rv-${id}`,
  findings: findings.map(([severity, category, issue], i) => ({ n: i + 1, severity, confidence: "CONFIRMED", category, issue })) });
const label = (refs, cause, source, why, project = "p") => ({ v: 1, id: `l-${refs[0]}-${source}`, type: "label", project, refs, cause, source, why });
const HARNESS_ACC = "Its reproduction failed when the harness reran it on the branch; sent to the worker.";

function ledger() {
  return [
    review("r1", "p", [["high", "logic", "old accepted"], ["low", "scope", "old rejected"]]),
    label(["r1#1"], "worker_careless", "harness", HARNESS_ACC),
    label(["r1#2"], "review_false_positive", "harness", "Its reproduction passed when the harness reran it on the branch."),
    review("r2", "p", [["medium", "edge_case", "a\nmultiline   issue " + "x".repeat(300)], ["high", "security", "overruled"], ["medium", "logic", "unlabelled"]]),
    label(["r2#1"], "worker_careless", "harness", HARNESS_ACC),
    label(["r2#2"], "worker_careless", "harness", HARNESS_ACC),
    // The orchestrator's word wins over the harness's, as in refsOf.
    label(["r2#2"], "review_false_positive", "orchestrator", "Dropped by the orchestrator after checking the cited code."),
    review("r3", "p", [["critical", "regression", "newest accepted"], ["medium", "requirement", "newest too"]]),
    label(["r3#1", "r3#2"], "worker_careless", "harness", HARNESS_ACC),
    review("o1", "other", [["high", "logic", "another project"]]),
    label(["o1#1"], "worker_careless", "harness", HARNESS_ACC, "other"),
  ];
}

test("up to 3 accepted and 3 rejected findings of the project, newest first, one line each", () => {
  const out = examples(ledger(), "p");
  const lines = out.split("\n");
  assert.equal(lines[0], "## Findings this project accepted and rejected");
  const acc = lines.slice(lines.findIndex((l) => l.startsWith("Accepted")) + 1, lines.indexOf("", lines.findIndex((l) => l.startsWith("Accepted"))));
  const rej = lines.slice(lines.findIndex((l) => l.startsWith("Rejected")) + 1, lines.indexOf("", lines.findIndex((l) => l.startsWith("Rejected"))));
  assert.deepEqual(acc.map((l) => l.split(":")[0]), ["- critical, regression", "- medium, requirement", "- medium, edge_case"]);
  assert.match(acc[2], /^- medium, edge_case: a multiline issue x+… \(Its reproduction failed/);
  assert.ok(acc[2].length < 400, "the issue is clipped");
  assert.deepEqual(rej.map((l) => l.split(" (")[0]), ["- high, security: overruled", "- low, scope: old rejected"]);
  assert.doesNotMatch(out, /old accepted|unlabelled|another project/);
});

test("the same ledger gives the same text, through the CLI too; nothing at all when there is nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ex-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, ledger().map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
  const run = (project) => execFileSync(process.execPath, [CLI, project], { encoding: "utf8", env: { ...process.env, AGENT_BOX_LEDGER: file } });
  assert.equal(run("p"), examples(ledger(), "p"));
  assert.equal(run("p"), run("p"));
  assert.equal(run("nobody"), "");
  assert.equal(examples([review("r9", "p", [["high", "logic", "x"]])], "p"), "", "unlabelled findings are no examples");
});

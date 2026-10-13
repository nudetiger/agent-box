// Review findings blocks: what the host recovers from a malformed block, and what it does when it cannot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalBlock } from "../lib/ledger.mjs";
import { nextOf } from "../lib/checks.mjs";

const withFinal = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-fb-"));
  fs.writeFileSync(path.join(dir, "final.md"), text);
  return dir;
};

test("a findings block written as one escaped JSON string is read (DeepSeek review, 2026-10-13)", () => {
  const findings = [
    { severity: "high", confidence: "CONFIRMED", issue: 'keeps "quotes", $& and C:\\dir' },
    { severity: "low", confidence: "PLAUSIBLE", issue: "two" },
  ];
  // The shape seen: the JSON text with every quote and backslash escaped once, items on their own lines.
  const escaped = JSON.stringify(JSON.stringify(findings)).slice(1, -1).replace("},{", "},\n {");
  const dir = withFinal("Review.\n\n```agent-box-findings\n" + escaped + "\n```\n");
  assert.deepEqual(finalBlock(dir, "agent-box-findings"), findings);
});

test("a plain block still parses, and garbage is null", () => {
  assert.deepEqual(finalBlock(withFinal("```agent-box-findings\n[]\n```\n"), "agent-box-findings"), []);
  assert.equal(finalBlock(withFinal("```agent-box-findings\n[{oops\n```\n"), "agent-box-findings"), null);
});

test("an unreadable findings block sends the orchestrator to the final message, not to done", () => {
  assert.equal(nextOf({ findings: null, findings_unreadable: true }, "review", []), "read_final_message");
  assert.equal(nextOf({ findings: 0 }, "review", []), "done");
  assert.equal(nextOf({ findings: 2 }, "review", []), "triage_findings");
});

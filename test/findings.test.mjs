// Review findings blocks: what the host recovers from a malformed block, and what it does when it cannot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp } from "./tmp.mjs";
import { finalBlock } from "../lib/ledger.mjs";
import { nextOf } from "../lib/checks.mjs";

const withFinal = (text) => {
  const dir = tmp("ab-fb-");
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

// A message with no fenced block (DeepSeek, RakunMiniItems #50, 2026-10-17): the message as JSON, or
// its last json fence, holding the array or an object with it under the block's key.
import { bareBlock } from "../lib/ledger.mjs";
test("bareBlock: bare object, bare array, json fence; a report needs status; prose is null", () => {
  assert.deepEqual(bareBlock('{"findings":[{"n":1}]}', "agent-box-findings"), [{ n: 1 }]);
  assert.deepEqual(bareBlock("[]", "agent-box-findings"), []);
  assert.deepEqual(bareBlock("Done.\n```json\n[{\"n\":2}]\n```", "agent-box-findings"), [{ n: 2 }]);
  assert.deepEqual(bareBlock('{"status":"done","tests":"pass"}', "agent-box-report"), { status: "done", tests: "pass" });
  assert.equal(bareBlock('{"tests":"pass"}', "agent-box-report"), null);
  assert.equal(bareBlock("No findings.", "agent-box-findings"), null);
});

test("finalBlock: a fenced findings block holding {findings: [...]} reads as the array; a tests block stays an object", () => {
  const dir = tmp("ab-wrap-");
  fs.writeFileSync(path.join(dir, "final.md"), 'Done.\n```agent-box-findings\n{"findings": [{"n": 1}]}\n```\n');
  assert.deepEqual(finalBlock(dir, "agent-box-findings"), [{ n: 1 }]);
  fs.writeFileSync(path.join(dir, "final.md"), '```agent-box-tests\n{"mode": "red", "tests": ["a"]}\n```\n');
  assert.deepEqual(finalBlock(dir, "agent-box-tests"), { mode: "red", tests: ["a"] });
});

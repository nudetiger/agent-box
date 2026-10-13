// run-task.sh resumes a session whose last step was cut off at the output cap (image/last-stop.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastStop } from "../image/last-stop.mjs";

test("the last step_finish reason: length when the turn was cut off, the event shape OpenCode 1.19 writes", () => {
  // Lykos T174b, e2e-pre-t174b-impl: 33 tool steps, then a step with 30,720 reasoning tokens cut at the cap.
  const ev = (reason, reasoning) => JSON.stringify({ type: "step_finish", part: { reason, tokens: { output: 40, reasoning } } });
  const cut = [ev("tool-calls", 900), JSON.stringify({ type: "tool_use", part: { tool: "read" } }), ev("tool-calls", 14108),
    JSON.stringify({ type: "text", part: { text: "Wait! What about..." } }), ev("length", 30720)].join("\n");
  assert.equal(lastStop(cut), "length");
  assert.equal(lastStop([ev("length", 30720), ev("stop", 10)].join("\n")), "stop", "a resumed turn that finished is not cut");
  assert.equal(lastStop("not json\n"), "");
});

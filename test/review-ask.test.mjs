// Reviewers get the ask_orchestrator tool only when the review loop asks for it (REVIEW_ASK=1), so a
// spec question is answered mid-review instead of stopping the loop (image/make-config.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmp } from "./tmp.mjs";

function config(env) {
  const home = tmp("ab-rask-");
  execFileSync(process.execPath, [path.join(import.meta.dirname, "..", "image", "make-config.mjs")], {
    env: { ...process.env, HOME: home, USERPROFILE: home, MODEL: "m1", ...env }, encoding: "utf8" });
  return JSON.parse(fs.readFileSync(path.join(home, ".config", "opencode", "opencode.json"), "utf8"));
}

test("a reviewer has no ask tool unless REVIEW_ASK=1; ASK=0 still turns it off", () => {
  assert.equal(config({ REVIEW: "1" }).mcp, undefined);
  assert.deepEqual(config({ REVIEW: "1", REVIEW_ASK: "1" }).mcp?.orchestrator?.command, ["node", "/opt/agent-box/ask-mcp.mjs"]);
  assert.equal(config({ REVIEW: "1", REVIEW_ASK: "1", ASK: "0" }).mcp, undefined);
  assert.equal(config({ REVIEW: "1", REVIEW_ASK: "1" }).agent.reviewer.permission.edit["*"], "deny");
});

test("workers keep the ask tool as before", () => {
  assert.ok(config({}).mcp?.orchestrator);
  assert.equal(config({ ASK: "0" }).mcp, undefined);
});

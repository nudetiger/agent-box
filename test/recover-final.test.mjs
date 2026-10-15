// run-task.sh recovers the last step that `opencode run --attach` dropped from events.jsonl
// (image/recover-final.mjs). Fixtures: the real tail of rakunminiitems rv-20261015-050357-review-spec,
// a DeepSeek review whose log ends on a step_start, and the session store rows for its last messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { truncated, missingEvents, recover } from "../image/recover-final.mjs";
import { lastStop } from "../image/last-stop.mjs";

const FX = path.join(import.meta.dirname, "fixtures", "attach-truncated");
const EVENTS = fs.readFileSync(path.join(FX, "events.jsonl"), "utf8");
const STORE = JSON.parse(fs.readFileSync(path.join(FX, "store.json"), "utf8"));

// The last text event, as final_message in run-task.sh picks it, and its findings block.
const finalText = (text) => text.split("\n").flatMap((l) => { try { const e = JSON.parse(l); return e.type === "text" ? [e.part.text] : []; } catch { return []; } }).at(-1) ?? "";
const findings = (t) => JSON.parse(t.match(/```agent-box-findings[^\n]*\n([\s\S]*?)\n\s*```/)[1]);

test("the real log ends on a step_start, and its last text is the narration, not the findings", () => {
  assert.equal(truncated(EVENTS), true);
  assert.match(finalText(EVENTS), /^I have what I need/);
  assert.doesNotMatch(finalText(EVENTS), /agent-box-findings/);
});

test("the missing text and step_finish come back from the store, marked recovered", () => {
  const ev = missingEvents(EVENTS, STORE);
  assert.deepEqual(ev.map((e) => e.type), ["text", "step_finish"]);
  assert.ok(ev.every((e) => e.recovered === true && e.part.messageID === "msg_13c78386f001HeaqU2BCKauoDW"));
  const fixed = EVENTS + ev.map((e) => JSON.stringify(e)).join("\n") + "\n";
  assert.equal(truncated(fixed), false);
  assert.equal(lastStop(fixed), "stop");
  const f = findings(finalText(fixed));
  assert.ok(Array.isArray(f) && f.length > 0 && f[0].severity === "medium");
});

test("nothing is appended to a log that finished, or for messages before the truncated step", () => {
  const done = EVENTS + JSON.stringify({ type: "step_finish", part: { id: "x", reason: "stop" } }) + "\n";
  assert.deepEqual(missingEvents(done, STORE), []);
  // A resumed session: an earlier round's message is in the store but not in this round's log.
  const earlier = { id: "msg_000", session_id: STORE[0].session_id, data: { role: "assistant" },
    parts: [{ id: "prt_old", data: { type: "text", text: "round 1 answer" } }] };
  assert.ok(!missingEvents(EVENTS, [earlier, ...STORE]).some((e) => e.part.id === "prt_old"));
});

test("recover reads OpenCode's SQLite store and appends to events.jsonl once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recover-final-"));
  const db = new DatabaseSync(path.join(dir, "opencode.db"));
  db.exec("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);" +
    "CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);");
  for (const m of STORE) {
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(m.id, m.session_id, m.time_created, m.time_created, JSON.stringify(m.data));
    for (const p of m.parts) db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(p.id, m.id, m.session_id, p.time_created, p.time_created, JSON.stringify(p.data));
  }
  db.close();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, EVENTS);
  const sid = STORE[0].session_id;
  assert.equal(await recover(file, path.join(dir, "opencode.db"), sid), 2);
  assert.ok(findings(finalText(fs.readFileSync(file, "utf8"))).length > 0);
  assert.equal(await recover(file, path.join(dir, "opencode.db"), sid), 0, "a second call finds nothing missing");
  fs.rmSync(dir, { recursive: true, force: true });
});

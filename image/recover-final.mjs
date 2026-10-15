// Recovers the worker's last step when events.jsonl lost it. With TUI=1, `opencode run --attach` can exit
// before the final step's events reach stdout: the log ends on a step_start, final.md comes out empty or
// holds an earlier message, and the findings or report block is lost. The step itself finished and is
// in the session store. Seen on 24 of 61 attached runs (rakunminiitems, 2026-10-14/15; DeepSeek and
// Gemini alike), never on an unattached one. The missing parts are appended to events.jsonl as OpenCode
// would have written them, each marked "recovered": true; prints how many were appended.
//   node recover-final.mjs <events.jsonl> <opencode.db> <sessionID>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EVENT = { "step-start": "step_start", "step-finish": "step_finish", text: "text", tool: "tool_use" };

const parse = (text) => text.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

// True when the last step in the log started and never finished.
export function truncated(eventsText) {
  let last = "";
  for (const e of parse(eventsText)) if (e?.type === "step_start" || e?.type === "step_finish") last = e.type;
  return last === "step_start";
}

// The events missing from the log. messages: the session's messages in order, each
// { id, data, parts: [{ id, data }] } as the store holds them. Only messages from the one holding the
// truncated step onward count: a resumed session's earlier rounds are in the store but not in this log.
export function missingEvents(eventsText, messages) {
  const events = parse(eventsText);
  if (!truncated(eventsText)) return [];
  const seen = new Set(events.map((e) => e?.part?.id).filter(Boolean));
  const from = events.findLast((e) => e?.type === "step_start")?.part?.messageID;
  const i = messages.findIndex((m) => m.id === from);
  if (i < 0) return [];
  const out = [];
  for (const m of messages.slice(i)) {
    if (m.data?.role !== "assistant") continue;
    for (const p of m.parts) {
      const type = EVENT[p.data?.type];
      if (!type || seen.has(p.id)) continue;
      out.push({ type, timestamp: p.data.time?.end ?? m.data.time?.completed ?? m.data.time?.created ?? null,
        sessionID: m.data.sessionID ?? m.session_id, recovered: true,
        part: { id: p.id, messageID: m.id, sessionID: m.session_id, ...p.data } });
    }
  }
  return out;
}

// The session's messages and parts from OpenCode's SQLite store (OpenCode 1.19 schema).
export async function readSession(dbFile, sessionID) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const parts = new Map();
    for (const r of db.prepare("SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY id").all(sessionID)) {
      if (!parts.has(r.message_id)) parts.set(r.message_id, []);
      parts.get(r.message_id).push({ id: r.id, data: JSON.parse(r.data) });
    }
    return db.prepare("SELECT id, session_id, data FROM message WHERE session_id = ? ORDER BY time_created, id").all(sessionID)
      .map((r) => ({ id: r.id, session_id: r.session_id, data: JSON.parse(r.data), parts: parts.get(r.id) ?? [] }));
  } finally { db.close(); }
}

// The store can trail the exiting `run` by a moment: wait until the newest assistant message completed.
export async function recover(eventsFile, dbFile, sessionID, { tries = 20, waitMs = 500 } = {}) {
  const text = fs.readFileSync(eventsFile, "utf8");
  if (!truncated(text)) return 0;
  let missing = [];
  for (let n = 0; n < tries; n++) {
    const messages = await readSession(dbFile, sessionID);
    missing = missingEvents(text, messages);
    const last = messages.findLast((m) => m.data?.role === "assistant");
    if (last?.data?.time?.completed) break;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (missing.length) fs.appendFileSync(eventsFile, (text.endsWith("\n") || !text ? "" : "\n") + missing.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return missing.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, db, sid] = process.argv.slice(2);
  try { console.log(await recover(file, db, sid)); } catch (e) { console.error(`recover-final: ${e.message}`); console.log(0); }
}

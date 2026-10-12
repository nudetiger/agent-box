// T53 (docs/19-phase4-tasks.md) — live transcript capture.
//
// What these tests are actually defending, in the phase's own words: a
// transcript worth replaying. The three things that make one, and that
// nothing before T53 could produce, are (1) the human side of the
// conversation is in the file at all, (2) it is on disk BEFORE the session
// ends, so a kill leaves history rather than nothing, and (3) it is redacted
// on the way in, permanently, because this store is never deleted.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LiveTranscriptRecorder } from "./live-capture.js";
import { metaFilePath, readTranscript, transcriptFilePath, type SessionMeta } from "./transcript.js";

function fakeLedgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "lykos-live-capture-")), "ledger.db");
}

/** Stands in for `AgentSession.subscribe` — the same one-argument listener contract, driven by hand. */
function fakeSource() {
  const listeners: Array<(ev: unknown) => void> = [];
  return {
    source: {
      subscribe(fn: (ev: unknown) => void) {
        listeners.push(fn);
        return () => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    },
    emit(ev: unknown) {
      for (const fn of [...listeners]) fn(ev);
    },
    get count() {
      return listeners.length;
    },
  };
}

describe("T53 LiveTranscriptRecorder", () => {
  it("records the human side of a conversation — the thing a snapshot transcript never had", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-1");
    const { source, emit } = fakeSource();
    const detach = rec.attach(source);

    rec.userMessage("add a test for the parser");
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "look at parser.ts" } });
    emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "parser.ts" } });
    emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: "ok", isError: false });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "here is the test" } });
    rec.steer("use the table-driven style");
    emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "rewritten" } });
    detach();

    const { events, truncated } = readTranscript(transcriptFilePath(ledgerPath, "sess-live-1"));
    assert.equal(truncated, false);
    assert.deepEqual(
      events.map((e) => e.kind),
      [
        "user_message",
        "thinking",
        "tool_call",
        "tool_result",
        "assistant_message",
        "steer",
        "assistant_message",
      ],
    );
    // The steer is a steer, not a second prompt: `human_interventions`
    // counts exactly these, and a replay that promoted one to a top-level
    // turn would rebuild a conversation that never happened.
    const steer = events.find((e) => e.kind === "steer");
    assert.equal((steer as { text: string; mode: string }).text, "use the table-driven style");
    assert.equal((steer as { mode: string }).mode, "steer");
    // Per-turn, not one closing blob — `final: false` says which path wrote it.
    for (const e of events.filter((x) => x.kind === "assistant_message")) {
      assert.equal((e as { final: boolean }).final, false);
    }
  });

  it("has every completed line on disk before the session ends — a kill loses only the turn in flight", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-2");
    const { source, emit } = fakeSource();
    rec.attach(source);
    rec.userMessage("first");
    emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "reply" } });

    // No finalize() — this is the crashed case. The file must already be
    // complete and parseable, which is the whole reason capture moved off
    // the terminal snapshot.
    const path = transcriptFilePath(ledgerPath, "sess-live-2");
    assert.ok(existsSync(path));
    const { events } = readTranscript(path);
    assert.deepEqual(
      events.map((e) => e.kind),
      ["user_message", "assistant_message"],
    );
  });

  it("writes meta.json at boot, marked capture_mode=stream and schemaVersion 2", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-3");
    rec.writeMeta({
      taskId: "task-1",
      projectId: "proj-1",
      parentSessionId: null,
      resumedFrom: null,
      agentRole: "worker",
      model: "deepseek/deepseek-v4-flash",
      cwd: "/work",
      startedUtc: "2026-09-03T00:00:00.000Z",
    });
    const meta = JSON.parse(readFileSync(metaFilePath(ledgerPath, "sess-live-3"), "utf8")) as SessionMeta;
    assert.equal(meta.schemaVersion, 2);
    assert.equal(meta.captureMode, "stream");
    assert.equal(meta.sessionId, "sess-live-3");
    assert.equal(meta.taskId, "task-1");
  });

  it("redacts every new event kind on the way in — this store is never deleted, so a secret written here is written forever", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-4");
    const { source, emit } = fakeSource();
    rec.attach(source);
    const secret = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    rec.userMessage(`use ${secret} please`);
    rec.steer(`no, ${secret}`);
    rec.answer("which key?", secret);
    rec.intervention("set_key", secret);
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: secret } });
    emit({ type: "tool_execution_end", toolCallId: "t9", toolName: "bash", result: secret, isError: false });

    const raw = readFileSync(transcriptFilePath(ledgerPath, "sess-live-4"), "utf8");
    assert.ok(!raw.includes(secret), "a secret reached the permanent transcript");
    assert.ok(raw.includes("REDACTED"));
  });

  it("does not record streaming deltas — they are the same bytes as the *_end event that follows", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-5");
    const { source, emit } = fakeSource();
    rec.attach(source);
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", content: "he" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", content: "llo" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "hello" } });
    emit({ type: "bash_execution_update", delta: "noise" });
    const { events } = readTranscript(transcriptFilePath(ledgerPath, "sess-live-5"));
    assert.deepEqual(
      events.map((e) => e.kind),
      ["assistant_message"],
    );
  });

  it("records compaction as its own marker, not only as a usage row with phase=compact", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-6");
    const { source, emit } = fakeSource();
    rec.attach(source);
    emit({ type: "compaction_start", reason: "threshold" });
    emit({ type: "compaction_end", reason: "threshold", aborted: false });
    const { events } = readTranscript(transcriptFilePath(ledgerPath, "sess-live-6"));
    assert.deepEqual(
      events.map((e) => `${e.kind}:${(e as { phase?: string }).phase}`),
      ["compaction:start", "compaction:end"],
    );
  });

  it("T188: a prune record becomes a prune event; a figure the record lacks stays absent, never 0 or a guessed reason", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-prune");
    const { source, emit } = fakeSource();
    rec.attach(source);
    const entry = (data: unknown) => ({ type: "entry_appended", entry: { customType: "lykos-prune", data } });
    emit(entry({ id: "p1", entries: [{ id: "c1", kind: "superseded" }], tokens_saved: 40, reason: "idle" }));
    emit(entry({ id: "p2", entries: [{ id: "c2", kind: "useless" }] }));
    const { events } = readTranscript(transcriptFilePath(ledgerPath, "sess-live-prune"));
    const [a, b] = events as unknown as Array<Record<string, unknown>>;
    assert.equal(a!.kind, "prune");
    assert.equal(a!.tokens_saved, 40);
    assert.equal(a!.reason, "idle");
    assert.equal(b!.kind, "prune");
    assert.ok(!("tokens_saved" in b!), "no tokens_saved was recorded, so none is written");
    assert.ok(!("reason" in b!), "no reason was recorded, so none is written");
  });

  it("detaches cleanly, and creates nothing for a :memory: ledger", () => {
    const ledgerPath = fakeLedgerPath();
    const rec = new LiveTranscriptRecorder(ledgerPath, "sess-live-7");
    const fake = fakeSource();
    const detach = rec.attach(fake.source);
    assert.equal(fake.count, 1);
    detach();
    assert.equal(fake.count, 0);

    assert.equal(LiveTranscriptRecorder.create(":memory:", "sess-live-8"), undefined);
  });
});

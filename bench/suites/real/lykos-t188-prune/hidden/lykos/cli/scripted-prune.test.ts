// T188 (spec #15): superseded-read pruning, proven through the scripted-model
// session (T142's seam). What is checked is what a person could observe: what
// the model was sent on each call, what `lykos show` prints, what the ledger
// holds, and what a resume replays -- never which function ran.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SUPERSEDED_NOTICE } from "../loop/tool-result-prune.js";
import { call, reply, runScriptedSession, say, toolResults, type ModelContext } from "./scripted-session.js";

const BODY = "line of the file that is long enough to be worth pruning\n".repeat(20);
const FILES = { "a.txt": BODY, "b.txt": BODY };

/** The text of every `read` result the model has been sent. */
const results = (ctx: ModelContext): string[] =>
  toolResults(ctx)
    .filter((r) => r.tool === "read")
    .map((r) => r.text);

// The diet already collapses a re-read of an UNCHANGED file to a stub, so a
// superseded read needs the file to have changed in between -- the
// read, edit, read loop this prune exists for.
const REWRITE = call("write", { path: "a.txt", content: `${BODY}and one more line, so the second read differs
` });
const isNotice = (text: string): boolean => text === SUPERSEDED_NOTICE;

describe("prune: superseded reads (T188)", () => {
  it("replaces the earlier of two reads of a file on the next request, and records the prune", async () => {
    const run = await runScriptedSession({
      files: FILES,
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          const [first, second] = results(ctx);
          assert.ok(isNotice(first!), `the earlier read is the notice, got: ${first}`);
          assert.match(second!, /line of the file/, "the newer read stays whole");
          return reply(call("read", { path: "b.txt" }));
        },
        (ctx) => {
          const [first, second, third] = results(ctx);
          assert.ok(isNotice(first!), "a prune stays a prune on every later request");
          assert.match(second!, /line of the file/);
          assert.match(third!, /line of the file/, "a different file is not superseded");
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
    const rows = run.query<{ superseded: number; useless: number; tokens_saved: number; reason: string }>(
      `SELECT superseded, useless, tokens_saved, reason FROM prunes WHERE session_id = ?`,
      run.sessionId,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.superseded, 1);
    assert.equal(rows[0]!.useless, 0);
    assert.ok(rows[0]!.tokens_saved > 100, `saved ${rows[0]!.tokens_saved}`);
    assert.equal(rows[0]!.reason, "tail");
    assert.match(run.show(), /prune\s+superseded=1\s+useless=0\s+est_tokens_saved=\d+\s+reason=tail/);
  });

  it("a read with a selector is superseded by a later whole-file read, never the reverse", async () => {
    const run = await runScriptedSession({
      files: FILES,
      script: [
        reply(call("read", { path: "a.txt", offset: 1, limit: 10 })),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          assert.ok(isNotice(results(ctx)[0]!), "the ranged read gave way to the whole read");
          return reply(call("read", { path: "a.txt", offset: 1, limit: 10 }));
        },
        (ctx) => {
          const all = results(ctx);
          assert.ok(isNotice(all[0]!));
          assert.match(all[1]!, /line of the file/, "the whole read survives a later ranged read");
          assert.match(all[2]!, /line of the file/);
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
  });

  it("a result with more than 8000 tokens after it is left whole while the cache is warm", async () => {
    const run = await runScriptedSession({
      files: { ...FILES, "big.txt": "y".repeat(48_000) },
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(call("read", { path: "big.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          const [first, , third] = results(ctx);
          assert.match(first!, /line of the file/, "~12 000 tokens follow it: the warm prefix is not rewritten");
          assert.match(third!, /line of the file/);
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
    assert.equal(run.query(`SELECT * FROM prunes WHERE session_id = ?`, run.sessionId).length, 0);
  });

  it("each knob off disables supersession", async () => {
    const run = await runScriptedSession({
      files: FILES,
      config: "compaction:\n  supersede_reads: false\n",
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          assert.ok(results(ctx).every((t) => /line of the file/.test(t)), "nothing is pruned");
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
    assert.equal(run.query(`SELECT * FROM prunes WHERE session_id = ?`, run.sessionId).length, 0);
  });

  it("a resumed session starts from the pruned context", async () => {
    const run = await runScriptedSession({
      files: FILES,
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        reply(say("done")),
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    const resumed = await run.resume({
      prompt: "carry on",
      script: [
        (ctx) => {
          const replay = JSON.stringify(ctx.messages);
          assert.ok(
            replay.includes(`[tool result] read: ok: ${SUPERSEDED_NOTICE}`),
            "the earlier read replays as the notice the model was sent",
          );
          assert.equal((replay.match(/line of the file/g) ?? []).length > 0, true, "the newer read replays whole");
          return reply(say("resumed"));
        },
      ],
    });
    assert.equal(resumed.result.status, "ok", JSON.stringify(resumed.result));
    assert.equal(resumed.unusedSteps, 0);
  });
});

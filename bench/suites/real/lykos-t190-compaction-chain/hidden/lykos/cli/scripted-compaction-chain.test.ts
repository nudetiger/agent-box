// P17 T190: the compaction method chain, proven through the scripted-model
// session (T142's seam). What is checked is what a person could observe -- what
// the model was sent (the side call's request), the `compactions` rows, and the
// number of model calls -- never which function ran.
//
// Pi's threshold compaction is the trigger: the faux model reports a prompt of
// about the size of its context, so a ~125 000-token context on a 128 000-token
// window crosses Pi's line (window less 16 384 reserved). The self-compact
// gauge is set above that, so the agent is never asked to write a note and the
// compaction is Pi's, with no agent note: the chain's case.
//
// A scripted step answers ONE model request. The handoff side call is one more
// request, told apart by carrying no tools.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SELF_COMPACT_HANDOFF_PROMPT } from "../loop/self-compact-template.js";
import {
  call,
  fail,
  reply,
  runScriptedSession,
  say,
  type ModelContext,
  type ScriptStep,
} from "./scripted-session.js";

const WINDOW = 128_000;
// The gauge's lines sit above Pi's compaction line, so only Pi compacts.
const GAUGE = `self_compact:\n  models:\n    faux/scripted-1: { notice: 100k, warning: 110k, cutoff: 127k }\n`;
const config = (order?: string) => `${GAUGE}${order === undefined ? "" : `compaction:\n  method_order: ${order}\n`}`;

/** ~85 000 tokens written, then ~25 000 more: Pi keeps the last 20 000 uncompacted, so the first falls before the cut. */
const BIG = reply(call("write", { path: "big.txt", content: "x".repeat(340_000) }));
const PAD = reply(call("write", { path: "pad.txt", content: "p".repeat(100_000) }));
const DONE = reply(say("done"));
const HANDOFF_DOC = "## Goal\nFinish the scripted task.\n\n## Next Steps\n1. Nothing: it is done.";

/** True for the request the handoff side call makes: it asks for the template with tool choice none. */
function isSideCall(ctx: ModelContext): boolean {
  const last = ctx.messages[ctx.messages.length - 1];
  const text = JSON.stringify(last?.content ?? "");
  return ctx.toolChoice === "none" && text.includes("Write a handoff document for another instance of yourself");
}

/** A step answering the handoff side call. */
function sideCall(answer: (ctx: ModelContext) => ScriptStep | string): ScriptStep {
  return (ctx) => {
    assert.ok(isSideCall(ctx), "this request is the handoff side call");
    const out = answer(ctx);
    return typeof out === "string" ? reply(say(out)) : typeof out === "function" ? out(ctx) : out;
  };
}

/** A step answering Pi's own summariser. */
function summary(text = "PI SUMMARY of the work so far."): ScriptStep {
  return (ctx) => {
    assert.ok(!isSideCall(ctx), "not the side call");
    assert.match(ctx.systemPrompt ?? "", /summar/i, "a summariser request");
    return reply(say(text));
  };
}

interface Row {
  trigger: string;
  strategy: string;
  tokens_before: number | null;
  tokens_after: number | null;
  result: string;
  method: string | null;
  fell_through: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cache_write_1h_tokens: number | null;
}
const ROWS = `SELECT trigger, strategy, tokens_before, tokens_after, result, method, fell_through,
                     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_write_1h_tokens
                FROM compactions WHERE session_id = ? ORDER BY ts_utc, rowid`;

const fell = (row: Row): Array<{ method: string; reason: string }> => JSON.parse(row.fell_through ?? "null");

describe("the compaction method chain (T190)", () => {
  it("a compaction with no agent note runs the handoff side call: the live tools with tool choice none, its own session id", async () => {
    let liveKey: string | undefined;
    let liveTools: ModelContext["tools"];
    let liveSystem: string | undefined;
    const run = await runScriptedSession({
      config: config(),
      contextWindow: WINDOW,
      script: [
        BIG,
        PAD,
        (ctx) => {
          liveKey = ctx.sessionId;
          liveTools = ctx.tools;
          liveSystem = ctx.systemPrompt;
          assert.equal(ctx.toolChoice, undefined, "the live turn leaves tool choice at its default");
          return DONE;
        },
        sideCall((ctx) => {
          // It uses no tools, but sends the live ones: they open the cached prefix, and a request without them reads it cold.
          assert.ok(liveTools !== undefined && liveTools.length > 0, "the live turn had tools");
          // What goes on the wire for a tool is its name, description and parameters (the live definitions also carry a UI label).
          const wire = (tools: ModelContext["tools"]) => tools?.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
          assert.deepEqual(wire(ctx.tools), wire(liveTools), "the side call sends the live turn's tools, identical, in the same order");
          assert.equal(ctx.toolChoice, "none", "and tells the model to call none");
          assert.equal(ctx.systemPrompt, liveSystem, "with the live system prompt");
          assert.ok(liveKey !== undefined && liveKey.length > 0, "the live turn sent a cache key");
          // Its own session id, so the live turn's provider session state (headers, websocket) is not shared; the live
          // prompt-cache key travels in the payload instead (see self-compact-handoff.test.ts).
          assert.ok(ctx.sessionId?.startsWith(`${liveKey}:handoff:`), `the side call has its own id, derived from the live one: ${ctx.sessionId}`);
          assert.notEqual(ctx.sessionId, liveKey);
          const last = ctx.messages[ctx.messages.length - 1]!.content as Array<{ text?: string }>;
          assert.equal(last[0]?.text, SELF_COMPACT_HANDOFF_PROMPT, "it asks with the template's prompt as shipped (T189)");
          assert.ok(JSON.stringify(ctx.messages).includes("x".repeat(1000)), "it reads the whole conversation the live turn had");
          return HANDOFF_DOC;
        }),
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0, "the side call was the last model request: no summariser ran");
    const rows = run.query<Row>(ROWS, run.sessionId);
    assert.equal(rows.length, 1);
    const [row] = rows as [Row];
    assert.equal(row.method, "handoff");
    assert.deepEqual(fell(row), [{ method: "note", reason: "the agent left no note" }]);
    assert.equal(row.trigger, "pi-threshold");
    assert.equal(row.result, "ok");
    assert.ok((row.tokens_before ?? 0) > 111_000, `tokens_before ${row.tokens_before}`);
    assert.ok(row.tokens_after !== null && row.tokens_after < 30_000, `tokens_after ${row.tokens_after}`);
    // The faux provider only estimates a cache hit (it serialises text and puts tools last), so the SIZE of a hit is
    // not measured here -- only that the call's usage is on the row with read and write apart, as the provider reported it.
    // The faux reports no one-hour split, so that column is NULL, not 0.
    assert.ok(row.cache_read_tokens !== null && row.cache_write_tokens !== null && row.input_tokens !== null);
    assert.equal(row.cache_write_1h_tokens, null);
    assert.ok((row.output_tokens ?? 0) > 0);
    const shown = run.show();
    assert.match(shown, /method=handoff/);
    assert.match(shown, /fell through: note -- the agent left no note/);
    assert.match(shown, /cache_read=\d+ cache_write=\d+ cache_write_1h=unreported/);
    assert.match(shown, /tokens \d+ -> \d+/);
  });

  it("a compaction the agent's note asked for is the note method's: no side call, Pi's summariser underneath", async () => {
    const run = await runScriptedSession({
      config: config(),
      contextWindow: WINDOW,
      script: [PAD, reply(call("self_compact", { note: "## Goal\nfinish\n\n## Next Steps\n1. say done" })), summary(), DONE],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0, "no side call was made: the agent had written its note");
    const rows = run.query<Row>(ROWS, run.sessionId);
    assert.equal(rows.length, 1);
    const [row] = rows as [Row];
    assert.equal(row.method, "note");
    assert.deepEqual(fell(row), []);
    assert.equal(row.trigger, "agent");
    assert.ok(row.cache_read_tokens !== null && row.cache_write_tokens !== null, "the summariser's call is reported, cache read and write apart");
  });

  it("a side call that fails falls through to Pi's summary, and the row says why", async () => {
    const run = await runScriptedSession({
      config: config("[note, handoff, summary]"),
      contextWindow: WINDOW,
      script: [BIG, PAD, DONE, sideCall(() => fail("scripted provider outage")), summary()],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
    const [row] = run.query<Row>(ROWS, run.sessionId) as [Row];
    assert.equal(row.method, "summary");
    assert.deepEqual(
      fell(row).map((f) => f.method),
      ["note", "handoff"],
    );
    assert.match(fell(row)[1]!.reason, /scripted provider outage/);
    // The failed call was paid for: its usage is on the fell_through entry and it is a calls row of its own.
    const usage = (fell(row)[1] as { usage?: { input_tokens: number; cache_read_tokens: number; cache_write_tokens: number } }).usage;
    assert.ok(usage !== undefined && typeof usage.cache_read_tokens === "number" && typeof usage.cache_write_tokens === "number", JSON.stringify(fell(row)));
    const calls = run.query<{ n: number }>(`SELECT COUNT(*) AS n FROM calls WHERE session_id = ? AND phase = 'compact'`, run.sessionId);
    assert.equal(calls[0]!.n, 2, "the failed side call and Pi's summariser");
  });

  describe("shake", () => {
    // Fourteen files of ~8 000 tokens (the read tool caps a result near 32 000 characters), each read once: the bulk of the context is tool results the agent can read again.
    const FILES = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`f${i}.txt`, String.fromCharCode(97 + i).repeat(40_000)]));
    const READS = Array.from({ length: 14 }, (_, i) => reply(call("read", { path: `f${i}.txt` })));

    it("drops tool results with no model call, when it is the first method that works", async () => {
      const run = await runScriptedSession({
        config: config("[shake, summary]"),
        contextWindow: WINDOW,
        files: FILES,
        script: [...READS, DONE],
      });
      assert.equal(run.result.status, "ok", JSON.stringify(run.result));
      assert.equal(run.unusedSteps, 0);
      assert.equal(run.modelCalls, 15, "the fourteen reads and the answer: the shake made no model call and no summariser ran");
      const rows = run.query<Row>(ROWS, run.sessionId);
      assert.equal(rows.length, 1, "Pi's cancelled compaction is not a second row");
      const [row] = rows as [Row];
      assert.equal(row.method, "shake");
      assert.deepEqual(fell(row), []);
      assert.equal(row.result, "ok");
      assert.deepEqual(
        [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens],
        [0, 0, 0, 0],
        "no call, so nothing was used",
      );
      assert.ok(row.tokens_before !== null && row.tokens_after !== null && row.tokens_before - row.tokens_after > 60_000, JSON.stringify(row));
    });

    it("is what runs when the side call fails, after the note and the side call fell through", async () => {
      const run = await runScriptedSession({
        config: config(),
        contextWindow: WINDOW,
        files: FILES,
        script: [...READS, DONE, sideCall(() => fail("scripted provider outage"))],
      });
      assert.equal(run.unusedSteps, 0);
      assert.equal(run.modelCalls, 16, "the side call is the one extra request");
      const [row] = run.query<Row>(ROWS, run.sessionId) as [Row];
      assert.equal(row.method, "shake");
      assert.deepEqual(
        fell(row).map((f) => f.method),
        ["note", "handoff"],
      );
      assert.match(fell(row)[1]!.reason, /scripted provider outage/);
    });

    it("falls through to Pi's summary when there is nothing worth dropping", async () => {
      const run = await runScriptedSession({
        config: config("[shake, summary]"),
        contextWindow: WINDOW,
        script: [BIG, PAD, DONE, summary()],
      });
      assert.equal(run.unusedSteps, 0);
      const [row] = run.query<Row>(ROWS, run.sessionId) as [Row];
      assert.equal(row.method, "summary");
      assert.deepEqual(fell(row), [{ method: "shake", reason: "no tool result outside the recent tail is worth dropping" }]);
    });
  });

  it("an empty note falls through too", async () => {
    const run = await runScriptedSession({
      config: config("[handoff, summary]"),
      contextWindow: WINDOW,
      script: [BIG, PAD, DONE, sideCall(() => "   "), summary()],
    });
    assert.equal(run.unusedSteps, 0);
    const [row] = run.query<Row>(ROWS, run.sessionId) as [Row];
    assert.equal(row.method, "summary");
    assert.equal(fell(row).length, 1);
    assert.equal(fell(row)[0]!.method, "handoff");
    assert.equal(fell(row)[0]!.reason, "the side call returned an empty note");
    assert.ok((fell(row)[0] as { usage?: object }).usage !== undefined, "the empty reply was paid for, so its usage is kept");
  });
});

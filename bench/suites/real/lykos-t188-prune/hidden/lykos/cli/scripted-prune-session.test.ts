// T188 (spec #15), review round 2: the prune beside a compaction, beside an
// empty lsp lookup, and beside a project whose `extensions:` list leaves
// `lykos-prune` out -- each proven through the scripted-model session.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUPERSEDED_NOTICE } from "../loop/tool-result-prune.js";
import { call, mounted, reply, runScriptedSession, say, toolResults, type ModelContext, type ScriptStep } from "./scripted-session.js";

const BODY = "line of the file that is long enough to be worth pruning\n".repeat(20);
const REWRITE = call("write", { path: "a.txt", content: `${BODY}and one more line, so the second read differs\n` });
const reads = (ctx: ModelContext): string[] =>
  toolResults(ctx)
    .filter((r) => r.tool === "read")
    .map((r) => r.text);

const NOTE = "Task: read a.txt.\n  Next: read it once more.";
function summary(): ScriptStep {
  return (ctx) => {
    assert.match(ctx.systemPrompt ?? "", /summar/i, "a summariser request");
    return reply(say("SUMMARY of the work so far."));
  };
}

describe("prune beside a compaction (T188)", () => {
  it("a read pruned before a compaction stays pruned for the kept region, and nothing before the boundary is rewritten after it", async () => {
    const run = await runScriptedSession({
      files: { "a.txt": BODY },
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          assert.equal(reads(ctx)[0], SUPERSEDED_NOTICE, "pruned on the next request");
          // ~25 000 tokens of its own: Pi keeps the last 20 000 uncompacted, so the reads fall before the boundary.
          return reply(call("write", { path: "pad.txt", content: "p".repeat(100_000) }));
        },
        reply(call("self_compact", { note: NOTE })),
        summary(),
        (ctx) => {
          assert.ok(JSON.stringify(ctx.messages).includes("SUMMARY of the work so far."), "the session compacted");
          assert.deepEqual(reads(ctx), [], "the reads fell before the boundary: none is sent");
          // The diet stubs a re-read of unchanged bytes, so the file changes first.
          return reply(call("write", { path: "a.txt", content: "a fresh start after the compaction\n".repeat(20) }));
        },
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          const sent = reads(ctx);
          assert.equal(sent.length, 1);
          assert.match(sent[0]!, /a fresh start/, "the new read is whole: the compacted region is not rewritten");
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0);
    assert.equal(run.query(`SELECT * FROM compactions WHERE session_id = ?`, run.sessionId).length, 1);
    assert.equal(
      run.query(`SELECT * FROM prunes WHERE session_id = ?`, run.sessionId).length,
      1,
      "one prune, made before the compaction; none after it",
    );
  });
});

// A language server that answers every definition with nothing, so the real
// `lsp` tool returns its empty-lookup result through the real useless flag.
const EMPTY_SERVER = `
let buf = Buffer.alloc(0);
const send = (msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
  process.stdout.write(body);
};
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const head = buf.indexOf("\\r\\n\\r\\n");
    if (head < 0) return;
    const len = Number(/Content-Length: *(\\d+)/i.exec(buf.subarray(0, head).toString())[1]);
    if (buf.length < head + 4 + len) return;
    const msg = JSON.parse(buf.subarray(head + 4, head + 4 + len).toString());
    buf = buf.subarray(head + 4 + len);
    if (msg.method === "exit") process.exit(0);
    if (msg.method === "textDocument/didOpen") {
      send({ method: "textDocument/publishDiagnostics", params: { uri: msg.params.textDocument.uri, diagnostics: [] } });
    }
    if (msg.id === undefined) continue;
    if (msg.method === "initialize") send({ id: msg.id, result: { capabilities: { definitionProvider: true } } });
    else if (msg.method === "textDocument/definition") send({ id: msg.id, result: [] });
    else send({ id: msg.id, result: null });
  }
});
`;

// Outside the workspace: lsp refuses to run a program that lives in an untrusted project.
const serverPath = join(mkdtempSync(join(tmpdir(), "lykos-prune-lsp-")), "empty-server.cjs");
writeFileSync(serverPath, EMPTY_SERVER);

const lspConfig = (extra: string): string =>
  `lsp:\n  servers:\n    typescript: ${JSON.stringify({ command: process.execPath, args: [serverPath], extensions: [".ts"] })}\n${extra}`;

describe("drop_useless against an empty lsp lookup (T188)", () => {
  const script = (seen: { first?: string | undefined }): ScriptStep[] => [
    reply(mounted("lsp", { action: "definition", file: "a.ts", line: 1, symbol: "a", timeout: 5 })),
    reply(call("read", { path: "a.ts" })),
    (ctx) => {
      seen.first = toolResults(ctx).find((r) => r.tool === "tool_call" || r.tool === "lsp")?.text;
      return reply(say("done"));
    },
  ];
  const files = { "a.ts": "export const a = 1;\n" };

  it("is replaced by the elided notice by default", async () => {
    const seen: { first?: string | undefined } = {};
    const run = await runScriptedSession({ files, config: lspConfig(""), script: script(seen) });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(seen.first, "[Uneventful result elided]");
    const rows = run.query<{ useless: number }>(`SELECT useless FROM prunes WHERE session_id = ?`, run.sessionId);
    assert.deepEqual(rows.map((r) => r.useless), [1]);
  });

  it("is left whole with compaction.drop_useless: false", async () => {
    const seen: { first?: string | undefined } = {};
    const run = await runScriptedSession({ files, config: lspConfig("compaction:\n  drop_useless: false\n"), script: script(seen) });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.match(seen.first ?? "", /^No definition found/);
    assert.equal(run.query(`SELECT * FROM prunes WHERE session_id = ?`, run.sessionId).length, 0);
  });
});

describe("a project whose extensions: list leaves lykos-prune out (T188)", () => {
  it("is told so at boot, and prunes nothing", async () => {
    const run = await runScriptedSession({
      files: { "a.txt": BODY },
      config: "extensions:\n  - { name: lykos-self-compact }\n",
      script: [
        reply(call("read", { path: "a.txt" })),
        reply(REWRITE),
        reply(call("read", { path: "a.txt" })),
        (ctx) => {
          assert.ok(reads(ctx).every((t) => /line of the file/.test(t)), "nothing is pruned");
          return reply(say("done"));
        },
      ],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.match(run.stderr, /lykos-prune is not in the resolved extensions: list/);
    assert.equal(run.query(`SELECT * FROM prunes WHERE session_id = ?`, run.sessionId).length, 0);
  });
});

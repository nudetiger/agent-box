// T151: `lykos-self-compact` driven through a fake `pi.on`, the pattern
// `lykos-continuation.test.ts` uses. The end-to-end proof — guidance on exactly
// one real model call, never persisted — is `cli/scripted-self-compact.test.ts`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import lykosSelfCompact, { SELF_COMPACT_NOTE_DESCRIPTION, CONTEXT_USAGE_DESCRIPTION, SELF_COMPACT_DESCRIPTION } from "./lykos-self-compact.js";
import { SELF_COMPACT_SECTIONS, SELF_COMPACT_TEMPLATE } from "../../loop/self-compact-template.js";
import { TOOL_CATALOG } from "../../ledger/tool-catalog.js";
import {
  encodeSelfCompactPolicyEnv,
  CONTEXT_USAGE_TOOL_NAME,
  SELF_COMPACT_POLICY_ENV,
  SELF_COMPACT_TOOL_NAME,
  validateSelfCompactConfig,
} from "../../loop/self-compact.js";

type Handler = (event: unknown, ctx: unknown) => unknown;
interface Tool {
  name: string;
  description: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
}

const TABLE = validateSelfCompactConfig({ models: { "p/m": { notice: 100, warning: 200, cutoff: 300 } } });

function load(policy: string | undefined): { handlers: Map<string, Handler>; tools: Tool[]; commands: string[] } {
  if (policy === undefined) delete process.env[SELF_COMPACT_POLICY_ENV];
  else process.env[SELF_COMPACT_POLICY_ENV] = policy;
  const handlers = new Map<string, Handler>();
  const tools: Tool[] = [];
  const commands: string[] = [];
  lykosSelfCompact({
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerTool: (tool: Tool) => tools.push(tool),
    registerCommand: (name: string) => commands.push(name),
    appendEntry: (_type: string, data: unknown) => void entries.push(data),
    sendMessage: () => undefined,
  } as never);
  return { handlers, tools, commands };
}

const entries: unknown[] = [];
const branch: unknown[] = [];
const usage = { tokens: 0 as number | null };
function ctx(cwd: string, contextWindow = 128_000): unknown {
  return {
    cwd,
    model: { provider: "p", id: "m", contextWindow },
    getContextUsage: () => ({ tokens: usage.tokens, contextWindow, percent: null }),
    sessionManager: { getEntries: () => [], getBranch: () => branch },
  };
}

const MESSAGES = [{ role: "user", content: "task", timestamp: 1 }];
function send(handlers: Map<string, Handler>, c: unknown): string | undefined {
  const out = handlers.get("context")!({ type: "context", messages: MESSAGES }, c) as
    | { messages: Array<{ role: string; content: Array<{ text: string }> }> }
    | undefined;
  if (out === undefined) return undefined;
  assert.equal(out.messages.length, MESSAGES.length + 1, "one message added, at the end");
  assert.deepEqual(out.messages.slice(0, MESSAGES.length), MESSAGES, "the history is untouched");
  return out.messages[out.messages.length - 1]!.content[0]!.text;
}

describe("lykos-self-compact (T151)", () => {
  afterEach(() => {
    delete process.env[SELF_COMPACT_POLICY_ENV];
  });

  it("inert without a policy, or with it disabled: no handler, no tool", () => {
    for (const p of [undefined, "garbage", encodeSelfCompactPolicyEnv({ enabled: false, table: TABLE })]) {
      const { handlers, tools, commands } = load(p);
      assert.equal(handlers.size, 0);
      assert.equal(tools.length, 0);
      assert.equal(commands.length, 0);
    }
  });

  it("notice once, warning once, cutoff once, re-armed by a fall", () => {
    const { handlers } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    const c = ctx(mkdtempSync(join(tmpdir(), "lykos-sc-")));
    usage.tokens = 50;
    assert.equal(send(handlers, c), undefined);
    usage.tokens = 150;
    assert.match(send(handlers, c) ?? "", /^\[self-compact notice\] .*about 150 tokens of a 128000-token window \(128k tier\)/);
    assert.equal(send(handlers, c), undefined, "not repeated");
    usage.tokens = 250;
    assert.match(send(handlers, c) ?? "", /^\[self-compact warning\] .*past the 200-token warning line/);
    usage.tokens = 350;
    assert.match(send(handlers, c) ?? "", /^\[self-compact cutoff\] .*past the 300-token cutoff\. Every tool but self_compact is now refused/);
    assert.equal(send(handlers, c), undefined, "said once");
    usage.tokens = null;
    assert.equal(send(handlers, c), undefined, "unknown right after a compaction");
    usage.tokens = 20;
    assert.equal(send(handlers, c), undefined);
    usage.tokens = 120;
    assert.match(send(handlers, c) ?? "", /self-compact notice/, "announced again after the fall");
  });

  it("below the smallest tier it adds nothing", () => {
    const { handlers } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    usage.tokens = 60_000;
    assert.equal(send(handlers, ctx(tmpdir(), 32_000)), undefined);
  });

  it("reads its prompts from .lykos/prompts/self-compact/", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lykos-sc-"));
    mkdirSync(join(cwd, ".lykos", "prompts", "self-compact"), { recursive: true });
    writeFileSync(join(cwd, ".lykos", "prompts", "self-compact", "notice.md"), "MINE {tokens} of {window} at {tier}\n");
    const { handlers } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    usage.tokens = 150;
    assert.equal(send(handlers, ctx(cwd)), "MINE 150 of 128000 at 128k");
  });

  it("context_usage returns usage, window, tier and thresholds, and its catalog row is the live text", async () => {
    const { tools } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE, specialist: "nobody" }));
    const tool = tools.find((t) => t.name === CONTEXT_USAGE_TOOL_NAME)!;
    assert.equal(TOOL_CATALOG[CONTEXT_USAGE_TOOL_NAME]?.description, CONTEXT_USAGE_DESCRIPTION);
    usage.tokens = 250;
    const r = await tool.execute("id", {}, undefined, undefined, ctx(tmpdir()));
    assert.deepEqual(r.details, {
      tokens: 250,
      window: 128_000,
      percent: 0.2,
      tier: "128k",
      thresholds: { notice: 100, warning: 200, cutoff: 300, source: "model" },
      level: "warning",
    });
    const off = await tool.execute("id", {}, undefined, undefined, ctx(tmpdir(), 32_000));
    assert.match(String(off.details.self_compact), /off: the window is below the smallest tier \(64k\)/);
  });

  it("T152: past the cutoff every tool but self_compact is refused, naming it; below it nothing is", () => {
    const { handlers, tools, commands } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    assert.deepEqual(commands, ["self-compact"]);
    assert.equal(TOOL_CATALOG[SELF_COMPACT_TOOL_NAME]?.description, SELF_COMPACT_DESCRIPTION);
    assert.ok(tools.some((t) => t.name === SELF_COMPACT_TOOL_NAME));
    const onCall = handlers.get("tool_call")!;
    const c = ctx(tmpdir());
    usage.tokens = 250;
    assert.equal(onCall({ type: "tool_call", toolName: "write", input: {} }, c), undefined);
    usage.tokens = 350;
    const refused = onCall({ type: "tool_call", toolName: "write", input: {} }, c) as { block: boolean; reason: string };
    assert.equal(refused.block, true);
    assert.match(refused.reason, /write refused .*past the 300-token cutoff, and only self_compact runs now/);
    assert.equal(onCall({ type: "tool_call", toolName: "self_compact", input: {} }, c), undefined);
  });

  it("T189: the guidance lists the template's sections; a note missing some is saved and the record names them", async () => {
    const { tools } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    const tool = tools.find((t) => t.name === SELF_COMPACT_TOOL_NAME)!;
    for (const s of SELF_COMPACT_SECTIONS) {
      assert.ok(SELF_COMPACT_NOTE_DESCRIPTION.includes(s), `note description names ${s}`);
      assert.ok(SELF_COMPACT_DESCRIPTION.includes(s), `tool description names ${s}`);
    }
    assert.equal(
      (TOOL_CATALOG[SELF_COMPACT_TOOL_NAME]?.parameters as { properties: { note: { description: string } } }).properties.note.description,
      SELF_COMPACT_NOTE_DESCRIPTION,
    );

    entries.length = 0;
    const partial = await tool.execute("id", { note: "## Goal\nship it\n\n## Next Steps\n1. run tests" }, undefined, undefined, ctx(tmpdir()));
    assert.match(partial.content[0]!.text, /^Note saved/);
    assert.match(partial.content[0]!.text, /missing sections: Constraints & Preferences, Progress, Key Decisions, Critical Context/);
    assert.deepEqual((entries.at(-1) as { missing_sections?: string[] }).missing_sections, [
      "Constraints & Preferences",
      "Progress",
      "Key Decisions",
      "Critical Context",
    ]);

    entries.length = 0;
    const full = await tool.execute("id", { note: SELF_COMPACT_TEMPLATE }, undefined, undefined, ctx(tmpdir()));
    assert.doesNotMatch(full.content[0]!.text, /missing/);
    assert.equal((entries.at(-1) as { missing_sections?: string[] }).missing_sections, undefined);
  });
});

describe("lykos-self-compact: shake (T190)", () => {
  afterEach(() => {
    delete process.env[SELF_COMPACT_POLICY_ENV];
    branch.length = 0;
  });

  it("applies every recorded shake to the request, whatever tier the context is in", () => {
    const { handlers } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE }));
    const c = ctx(mkdtempSync(join(tmpdir(), "lykos-sc-")));
    usage.tokens = 1; // below the notice line: the gauge adds nothing
    const messages = [
      { role: "toolResult", toolCallId: "a", toolName: "read", content: [{ type: "text", text: "old file body" }] },
      { role: "toolResult", toolCallId: "b", toolName: "read", content: [{ type: "text", text: "kept file body" }] },
    ];
    const none = handlers.get("context")!({ type: "context", messages }, c);
    assert.equal(none, undefined, "no shake recorded: the request is untouched");
    branch.push({
      type: "custom",
      customType: "lykos-shake",
      data: { id: "s1", ts: "2026-10-11T00:00:00.000Z", tool_call_ids: ["a"], tokens_saved: 10 },
    });
    const out = handlers.get("context")!({ type: "context", messages }, c) as { messages: Array<{ content: Array<{ text: string }> }> };
    assert.match(out.messages[0]!.content[0]!.text, /^\[Shaken out of context/);
    assert.equal(out.messages[1]!.content[0]!.text, "kept file body");
  });

  it("shakes only what is on the session's current branch, not an entry another branch left behind", async () => {
    const text = (n: number) => "w".repeat(n * 4);
    const msg = (id: string, parentId: string | null, message: object) => ({ type: "message", id, parentId, timestamp: "2026-10-11T00:00:00.000Z", message });
    const call = (id: string) => ({
      role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path: id } }], api: "x", provider: "p", model: "m",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse", timestamp: 1,
    });
    const result = (id: string) => ({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: text(10_000) }], isError: false, timestamp: 1 });
    const user = (n: number) => ({ role: "user", content: [{ type: "text", text: text(n) }], timestamp: 1 });
    // The current branch: u0 -> a (call, result) -> b (call, result) -> a long last message. A sibling branch from u0 also read "c".
    const current = [
      msg("u0", null, user(10)), msg("ca", "u0", call("a")), msg("ra", "ca", result("a")),
      msg("cb", "ra", call("b")), msg("rb", "cb", result("b")), msg("u1", "rb", user(17_000)),
    ];
    // ...and a shake recorded on that sibling branch that names "a": it is not this branch's decision.
    const other = [
      msg("cc", "u0", call("c")),
      msg("rc", "cc", result("c")),
      { type: "custom", id: "sk", parentId: "rc", timestamp: "2026-10-11T00:00:00.000Z", customType: "lykos-shake", data: { id: "s0", ts: "2026-10-11T00:00:00.000Z", tool_call_ids: ["a"], tokens_saved: 1 } },
    ];
    const policyCtx = {
      cwd: tmpdir(),
      hasUI: false,
      model: { provider: "p", id: "m", contextWindow: 128_000 },
      getContextUsage: () => ({ tokens: 1, contextWindow: 128_000, percent: null }),
      sessionManager: { getEntries: () => [...current, ...other], getBranch: () => current, getLeafId: () => "u1" },
    };
    const { handlers } = load(encodeSelfCompactPolicyEnv({ enabled: true, table: TABLE, methodOrder: ["shake", "summary"] }));
    // `load` wires appendEntry to the shared `entries`; the shake record is read from there.
    entries.length = 0;
    const out = await handlers.get("session_before_compact")!(
      { type: "session_before_compact", preparation: { tokensBefore: 50_000, firstKeptEntryId: "u1" }, reason: "threshold", willRetry: false, signal: new AbortController().signal },
      policyCtx,
    );
    assert.deepEqual(out, { cancel: true }, "shake did the compaction");
    const shake = entries.find((e) => (e as { tool_call_ids?: string[] }).tool_call_ids !== undefined) as { tool_call_ids: string[] } | undefined;
    assert.deepEqual(shake?.tool_call_ids, ["a", "b"], "the other branch's result is not named");
  });
});

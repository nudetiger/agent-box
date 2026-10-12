// T190: the handoff side call's request and the usage of a call that did not
// become the compaction, with a fake provider standing where Pi's does. What
// the whole session records is proved in `cli/scripted-compaction-chain.test.ts`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import lykosSelfCompact from "./lykos-self-compact.js";
import { AFFINITY_HEADERS_READ_FROM_PI, affinityHeaders, observeCacheKey, requestHandoffDocument, withLiveCacheKey } from "./self-compact-handoff.js";
import { HANDOFF_USAGE_ENTRY_TYPE, SELF_COMPACT_ENTRY_TYPE, SELF_COMPACT_POLICY_ENV, encodeSelfCompactPolicyEnv, validateSelfCompactConfig } from "../../loop/self-compact.js";

const M = { provider: "p", id: "m" };

describe("the live prompt-cache key", () => {
  it("is read from the payload field each provider uses, with the model it was sent to", () => {
    assert.deepEqual(observeCacheKey({ model: "m", prompt_cache_key: "live-1" }, M), { field: "prompt_cache_key", value: "live-1", provider: "p", model: "m" });
    assert.deepEqual(observeCacheKey({ promptCacheKey: "live-2" }, M)?.field, "promptCacheKey");
    assert.equal(observeCacheKey({ model: "anthropic" }, M), undefined, "an id-less cache has nothing to share");
    assert.equal(observeCacheKey({ prompt_cache_key: undefined }, M), undefined, "an own property holding undefined is not a key");
    assert.equal(observeCacheKey("text", M), undefined);
  });

  it("is written back only for the same model and only where the field exists", () => {
    const key = { field: "prompt_cache_key" as const, value: "live-1", provider: "p", model: "m" };
    assert.deepEqual(withLiveCacheKey({ prompt_cache_key: "side" }, key, M), { prompt_cache_key: "live-1" });
    assert.deepEqual(withLiveCacheKey({ model: "anthropic" }, key, M), { model: "anthropic" }, "no field, nothing added");
    assert.deepEqual(withLiveCacheKey({ prompt_cache_key: "side" }, undefined, M), { prompt_cache_key: "side" });
    assert.deepEqual(withLiveCacheKey({ prompt_cache_key: "side" }, key, { provider: "p", id: "other" }), { prompt_cache_key: "side" }, "another model's key is not written");
    assert.deepEqual(withLiveCacheKey({ prompt_cache_key: undefined }, { ...key, provider: "q" }, M), { prompt_cache_key: undefined });
  });
});

describe("the live session's routing headers", () => {
  it("are written for a completions model that sets sendSessionAffinityHeaders, as Pi writes them", () => {
    const fireworks = { api: "openai-completions", provider: "fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", compat: { sendSessionAffinityHeaders: true } };
    assert.deepEqual(affinityHeaders(fireworks, "live"), { session_id: "live", "x-client-request-id": "live", "x-session-affinity": "live" });
    assert.deepEqual(affinityHeaders({ ...fireworks, provider: "openrouter" }, "live"), { "x-session-id": "live" });
    assert.deepEqual(affinityHeaders({ ...fireworks, compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "other" } }, "live"), { "x-client-request-id": "live", "x-session-affinity": "live" });
  });
  it("are written for neither the copilot nor the OAuth path of anthropic-messages, as Pi writes none there", () => {
    const flagged = { api: "anthropic-messages", provider: "anthropic", compat: { sendSessionAffinityHeaders: true } };
    assert.deepEqual(affinityHeaders(flagged, "live", { apiKey: "sk-ant-oat01-x" }), {});
    assert.deepEqual(affinityHeaders({ ...flagged, provider: "github-copilot" }, "live", { apiKey: "k" }), {});
    assert.deepEqual(affinityHeaders(flagged, "live", { apiKey: "sk-ant-api03-x" }), { "x-session-affinity": "live" });
  });
  it("are dropped when the live session has no id", () => {
    const flagged = { api: "openai-completions", provider: "fireworks", compat: { sendSessionAffinityHeaders: true } };
    assert.deepEqual(affinityHeaders(flagged, undefined), {});
  });
  it("were copied from the pi-coding-agent that is installed", () => {
    let dir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    let version: string | undefined;
    for (;;) {
      const file = join(dir, "package.json");
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "@earendil-works/pi-coding-agent") {
          version = pkg.version;
          break;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    assert.notEqual(version, undefined, "could not find the installed @earendil-works/pi-coding-agent package.json above its entry file");
    assert.equal(
      version,
      AFFINITY_HEADERS_READ_FROM_PI,
      `affinityHeaders copies the session-affinity header logic of the pi-ai bundled in pi-coding-agent ${AFFINITY_HEADERS_READ_FROM_PI} (openai-completions.js and anthropic-messages.js createClient); pi-coding-agent is now ${version}. Re-read those two functions, update affinityHeaders, then bump AFFINITY_HEADERS_READ_FROM_PI.`,
    );
  });
  it("are x-session-affinity alone for anthropic-messages, and nothing without the flag", () => {
    assert.deepEqual(affinityHeaders({ api: "anthropic-messages", compat: { sendSessionAffinityHeaders: true } }, "live"), { "x-session-affinity": "live" });
    assert.deepEqual(affinityHeaders({ api: "anthropic-messages" }, "live"), {});
    assert.deepEqual(affinityHeaders({ api: "openai-completions", compat: {} }, "live"), {});
  });
});

const USAGE = { input: 10, output: 20, cacheRead: 300, cacheWrite: 40, cacheWrite1h: 5, totalTokens: 375, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function fakeCtx(reply: { content: object[]; stopReason: string; errorMessage?: string }, seen: { options?: Record<string, unknown>; context?: Record<string, unknown> } = {}) {
  return {
    cwd: tmpdir(),
    hasUI: false,
    model: { provider: "p", id: "m", contextWindow: 128_000 },
    thinkingLevel: "high",
    getSystemPrompt: () => "SYSTEM",
    getContextUsage: () => ({ tokens: 1, contextWindow: 128_000, percent: null }),
    modelRegistry: {
      getProvider: () => ({
        streamSimple: (_model: unknown, context: Record<string, unknown>, options: Record<string, unknown>) => {
          seen.context = context;
          seen.options = options;
          return { result: async () => ({ ...reply, usage: USAGE }) };
        },
      }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: { h: "1" } }),
    },
    sessionManager: {
      getSessionId: () => "live",
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => null,
    },
  };
}

describe("requestHandoffDocument", () => {
  it("asks with its own session id, tool choice none, the live tools, the thinking level, and the live cache key in the payload", async () => {
    const seen: { options?: Record<string, unknown>; context?: Record<string, unknown> } = {};
    const tools = [{ name: "read", description: "d", parameters: {} }] as never;
    const out = await requestHandoffDocument(
      fakeCtx({ content: [{ type: "text", text: " ## Goal\nx " }], stopReason: "stop" }, seen) as never,
      new AbortController().signal,
      [],
      tools,
      {
        cacheKey: { field: "prompt_cache_key", value: "live-key", provider: "p", model: "m" },
        thinkingBudgets: { high: 4096 },
        transport: "sse",
      },
    );
    assert.equal(out.document, "## Goal\nx");
    assert.equal(out.usage?.cacheRead, 300);
    const o = seen.options!;
    assert.match(String(o.sessionId), /^live:handoff:/);
    assert.equal(o.toolChoice, "none");
    assert.equal(o.reasoning, "high");
    assert.equal(o.apiKey, "k");
    assert.deepEqual(o.thinkingBudgets, { high: 4096 });
    assert.equal(o.transport, "sse");
    assert.deepEqual(seen.context!.tools, tools);
    assert.equal(seen.context!.systemPrompt, "SYSTEM");
    const payload = (o.onPayload as (p: unknown) => { prompt_cache_key: string })({ prompt_cache_key: "side" });
    assert.equal(payload.prompt_cache_key, "live-key");
  });

  it("sends the live session id in the routing header of a model that routes by it, keeping its own session id", async () => {
    const seen: { options?: Record<string, unknown> } = {};
    const ctx = fakeCtx({ content: [{ type: "text", text: "x" }], stopReason: "stop" }, seen);
    ctx.model = { provider: "fireworks", id: "m", api: "openai-completions", compat: { sendSessionAffinityHeaders: true }, contextWindow: 1 } as never;
    await requestHandoffDocument(ctx as never, new AbortController().signal, [], [] as never, { sessionId: "live" });
    const o = seen.options!;
    assert.match(String(o.sessionId), /^live:handoff:/);
    assert.equal((o.headers as Record<string, string>)["x-session-affinity"], "live");
    assert.equal((o.headers as Record<string, string>).h, "1", "the model's own headers stay");
  });

  it("returns a failure with the usage the provider reported, for an error and for an empty note", async () => {
    const signal = new AbortController().signal;
    const failed = await requestHandoffDocument(fakeCtx({ content: [], stopReason: "error", errorMessage: "boom" }) as never, signal, [], [] as never, {});
    assert.deepEqual([failed.document, failed.failure, failed.usage?.cacheWrite], ["", "boom", 40]);
    const empty = await requestHandoffDocument(fakeCtx({ content: [{ type: "text", text: "  " }], stopReason: "stop" }) as never, signal, [], [] as never, {});
    assert.deepEqual([empty.failure, empty.usage?.cacheRead], ["the side call returned an empty note", 300]);
  });
});

describe("a handoff whose compaction does not land (T190)", () => {
  afterEach(() => {
    delete process.env[SELF_COMPACT_POLICY_ENV];
  });

  function load(extra: Record<string, unknown> = {}) {
    process.env[SELF_COMPACT_POLICY_ENV] = encodeSelfCompactPolicyEnv({
      ...extra,
      enabled: true,
      table: validateSelfCompactConfig({ models: { "p/m": { notice: 100, warning: 200, cutoff: 300 } } }),
      methodOrder: ["handoff", "summary"],
    });
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const appended: Array<{ type: string; data: Record<string, unknown> }> = [];
    lykosSelfCompact({
      on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
      registerTool: () => undefined,
      registerCommand: () => undefined,
      appendEntry: (type: string, data: Record<string, unknown>) => void appended.push({ type, data }),
      sendMessage: () => undefined,
      getActiveTools: () => [],
      getAllTools: () => [],
    } as never);
    return { handlers, appended };
  }
  const before = { type: "session_before_compact", preparation: { tokensBefore: 9_000, firstKeptEntryId: "k" }, reason: "threshold", willRetry: false };
  const usageEntries = (a: Array<{ type: string }>) => a.filter((e) => e.type === HANDOFF_USAGE_ENTRY_TYPE);
  const records = (a: Array<{ type: string; data: Record<string, unknown> }>) => a.filter((e) => e.type === SELF_COMPACT_ENTRY_TYPE).map((e) => e.data);

  it("is recorded with its usage and appended once as a usage entry, so the paid call gets one calls row", async () => {
    const { handlers, appended } = load();
    const ctx = fakeCtx({ content: [{ type: "text", text: "## Goal\nx" }], stopReason: "stop" });
    const result = (await handlers.get("session_before_compact")!({ ...before, signal: new AbortController().signal }, ctx)) as { compaction: { usage: unknown } };
    assert.deepEqual(result.compaction.usage, USAGE, "the compaction carries the call's usage: Pi's compaction_end reports it when it lands");
    handlers.get("session_compact_failed")!({ type: "session_compact_failed", reason: "threshold", aborted: false, willRetry: false, fromExtension: true, errorMessage: "disk full" }, ctx);
    const [row] = records(appended);
    assert.equal(row!.method, "handoff");
    assert.equal(row!.result, "failed");
    assert.equal(row!.cache_read_tokens, 300);
    assert.equal(row!.cache_write_1h_tokens, 5);
    assert.equal(usageEntries(appended).length, 1);
  });

  it("when it lands, nothing is appended: Pi's compaction_end already reports the call", async () => {
    const { handlers, appended } = load();
    const ctx = fakeCtx({ content: [{ type: "text", text: "## Goal\nx" }], stopReason: "stop" });
    await handlers.get("session_before_compact")!({ ...before, signal: new AbortController().signal }, ctx);
    handlers.get("session_compact")!({ type: "session_compact", reason: "threshold", compactionEntry: { tokensBefore: 9_000 }, fromExtension: true, willRetry: false }, ctx);
    assert.equal(usageEntries(appended).length, 0);
    assert.equal(records(appended)[0]!.cache_read_tokens, 300);
  });

  it("a side call that failed is appended once by the hook and not again when Pi's summary lands", async () => {
    const { handlers, appended } = load();
    const ctx = fakeCtx({ content: [], stopReason: "error", errorMessage: "outage" });
    const out = await handlers.get("session_before_compact")!({ ...before, signal: new AbortController().signal }, ctx);
    assert.equal(out, undefined, "no document: Pi's summary runs");
    assert.equal(usageEntries(appended).length, 1);
    handlers.get("session_compact")!({ type: "session_compact", reason: "threshold", compactionEntry: { tokensBefore: 9_000, usage: USAGE }, fromExtension: false, willRetry: false }, ctx);
    assert.equal(usageEntries(appended).length, 1);
    assert.equal(records(appended)[0]!.method, "summary");
  });

  it("shares the live cache key only while the live model is the side model, and repeats the session's budgets and transport", async () => {
    const { handlers } = load({ thinkingBudgets: { high: 2048 }, transport: "websocket" });
    const seen: { options?: Record<string, unknown> } = {};
    const ctx = fakeCtx({ content: [{ type: "text", text: "x" }], stopReason: "stop" }, seen);
    const request = (c: unknown) => handlers.get("before_provider_request")!({ type: "before_provider_request", payload: { prompt_cache_key: "live-key" } }, c);
    const compact = () => handlers.get("session_before_compact")!({ ...before, signal: new AbortController().signal }, ctx);
    const payloadKey = () => (seen.options!.onPayload as (x: unknown) => { prompt_cache_key: string })({ prompt_cache_key: "side" }).prompt_cache_key;

    request(ctx);
    await compact();
    assert.equal(payloadKey(), "live-key");
    assert.deepEqual(seen.options!.thinkingBudgets, { high: 2048 });
    assert.equal(seen.options!.transport, "websocket");

    // The live turn moves to another model whose payload carries no key: nothing is carried over.
    handlers.get("before_provider_request")!({ type: "before_provider_request", payload: { model: "x", prompt_cache_key: undefined } }, { ...ctx, model: { provider: "q", id: "n" } });
    await compact();
    assert.equal(payloadKey(), "side");

    // A key observed for another model is not written to this one.
    request({ ...ctx, model: { provider: "q", id: "n" } });
    await compact();
    assert.equal(payloadKey(), "side");
  });
});

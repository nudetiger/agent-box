// T188 (spec #15): the pure prune seam -- messages in, a plan out. What is
// checked is what a model could observe: which tool results the next request
// carries as a notice, and which it still carries whole. The scripted-session
// test (`cli/scripted-prune.test.ts`) proves the same through a real session.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unchangedMarker } from "./prompt-diet.js";
import {
  applyPrunes,
  cacheRetentionMs,
  DEFAULT_SUFFIX_TOKEN_LIMIT,
  decodePrunePolicyEnv,
  encodePrunePolicyEnv,
  idleFlushMs,
  IDLE_MARGIN_MS,
  isUselessResult,
  planPrunes,
  pruneMap,
  pruneNotice,
  pruneRowFromEntry,
  SUPERSEDED_NOTICE,
  USELESS_DETAILS,
  USELESS_NOTICE,
  type PrunePolicy,
  type PruneRecord,
} from "./tool-result-prune.js";

const MIN = 60_000;
const NOW = 1_000_000_000_000;
const policy: PrunePolicy = {
  supersedeReads: true,
  dropUseless: true,
  suffixTokenLimit: DEFAULT_SUFFIX_TOKEN_LIMIT,
  idleFlushMs: 6 * MIN,
};

type Msg = Record<string, unknown> & { role: string };

/** `n` tokens at the module's chars/4 estimate. */
const words = (n: number): string => "x".repeat(n * 4);

let counter = 0;
function assistantCall(id: string, name: string, args: Record<string, unknown>, at = NOW): Msg {
  return { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: at };
}
function result(id: string, name: string, text: string, extra: Record<string, unknown> = {}): Msg {
  return { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: NOW, ...extra };
}
/** An assistant call followed by its result. */
function readPair(path: string, text: string, extra: { offset?: number; limit?: number } = {}, at = NOW): Msg[] {
  const id = `call-${counter++}`;
  return [assistantCall(id, "read", { path, ...extra }, at), result(id, "read", text)];
}
function chatter(tokens: number, at = NOW): Msg {
  return { role: "user", content: [{ type: "text", text: words(tokens) }], timestamp: at };
}
const textOf = (m: Msg): string => (m.content as Array<{ text: string }>)[0]!.text;

function run(messages: Msg[], overrides: Partial<PrunePolicy> = {}, already: PruneRecord[] = []) {
  const prior = pruneMap(already);
  applyPrunes(messages, prior);
  const plan = planPrunes(messages, prior, { ...policy, ...overrides }, NOW);
  if (plan !== undefined) applyPrunes(messages, pruneMap([plan.record]));
  return plan;
}

describe("supersede reads", () => {
  it("replaces the earlier of two reads of the same file with the superseded notice", () => {
    const first = readPair("src/a.ts", words(200));
    const second = readPair("src/a.ts", words(210));
    const messages = [...first, ...second];
    const plan = run(messages);
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(textOf(messages[3]!), words(210), "the newer read stays whole");
    assert.equal(plan?.record.superseded, 1);
    assert.equal(plan?.record.useless, 0);
    assert.ok((plan?.record.tokens_saved ?? 0) > 150, `saved ${plan?.record.tokens_saved}`);
  });

  it("a read with a selector is superseded by a later selector-free read of the same path", () => {
    const messages = [...readPair("a.ts", words(100), { offset: 10, limit: 20 }), ...readPair("a.ts", words(300))];
    run(messages);
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(textOf(messages[3]!), words(300));
  });

  it("never the reverse: a selector-free read survives a later selector read", () => {
    const messages = [...readPair("a.ts", words(300)), ...readPair("a.ts", words(100), { offset: 10, limit: 20 })];
    const plan = run(messages);
    assert.equal(plan, undefined);
    assert.equal(textOf(messages[1]!), words(300));
  });

  it("two reads of the same range supersede; different ranges do not", () => {
    const same = [...readPair("a.ts", words(100), { offset: 1, limit: 50 }), ...readPair("a.ts", words(100), { offset: 1, limit: 50 })];
    run(same);
    assert.equal(textOf(same[1]!), SUPERSEDED_NOTICE);
    const different = [...readPair("a.ts", words(100), { offset: 1, limit: 50 }), ...readPair("a.ts", words(100), { offset: 51, limit: 50 })];
    assert.equal(run(different), undefined);
  });

  it("different files do not supersede each other", () => {
    assert.equal(run([...readPair("a.ts", words(100)), ...readPair("b.ts", words(100))]), undefined);
  });

  it("sees through the tool_call transport and through ./ and backslash spellings of a path", () => {
    const id = "mounted-1";
    const mounted: Msg[] = [
      assistantCall(id, "tool_call", { name: "read", arguments: { path: ".\\src\\a.ts" } }),
      result(id, "tool_call", words(100)),
    ];
    const messages = [...mounted, ...readPair("src/a.ts", words(100))];
    run(messages);
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE);
  });

  it("a later read that failed does not supersede the earlier one that worked", () => {
    const failed = readPair("a.ts", "ENOENT");
    failed[1]!.isError = true;
    assert.equal(run([...readPair("a.ts", words(100)), ...failed]), undefined);
  });

  it("a later read collapsed to the unchanged stub does not supersede the whole one", () => {
    const messages = [...readPair("a.ts", words(100)), ...readPair("a.ts", unchangedMarker("a.ts"))];
    assert.equal(run(messages), undefined);
    assert.equal(textOf(messages[1]!), words(100));
  });

  it("leaves a result alone when the notice would not be smaller", () => {
    assert.equal(run([...readPair("a.ts", "tiny"), ...readPair("a.ts", words(100))]), undefined);
  });

  it("does nothing when the knob is off", () => {
    const messages = [...readPair("a.ts", words(200)), ...readPair("a.ts", words(200))];
    assert.equal(run(messages, { supersedeReads: false }), undefined);
    assert.equal(textOf(messages[1]!), words(200));
  });
});

describe("drop useless", () => {
  const flagged = (text: string): Msg[] => {
    const id = `call-${counter++}`;
    return [assistantCall(id, "grep", { pattern: "x" }), result(id, "grep", text, { details: { ...USELESS_DETAILS } })];
  };

  it("elides a result its tool flagged useless", () => {
    const messages = [...flagged(words(100))];
    const plan = run(messages);
    assert.equal(textOf(messages[1]!), USELESS_NOTICE);
    assert.equal(plan?.record.useless, 1);
  });

  it("touches only results whose tool set the flag", () => {
    const id = "g1";
    const messages = [assistantCall(id, "grep", {}), result(id, "grep", words(100), { details: { matches: 0 } })];
    assert.equal(run(messages), undefined);
  });

  it("never elides a failed result", () => {
    const messages = [...flagged(words(100))];
    messages[1]!.isError = true;
    assert.equal(run(messages), undefined);
  });

  it("does nothing when the knob is off, and supersession still works", () => {
    const messages = [...flagged(words(100)), ...readPair("a.ts", words(100)), ...readPair("a.ts", words(100))];
    const plan = run(messages, { dropUseless: false });
    assert.equal(plan?.record.useless, 0);
    assert.equal(plan?.record.superseded, 1);
    assert.equal(textOf(messages[1]!), words(100));
  });
});

describe("the prompt-cache guard", () => {
  it("prunes a candidate with at most 8000 tokens after it", () => {
    const messages = [...readPair("a.ts", words(300)), chatter(DEFAULT_SUFFIX_TOKEN_LIMIT - 400), ...readPair("a.ts", words(300))];
    run(messages);
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE);
  });

  it("leaves a candidate with more than 8000 tokens after it, while the cache is warm", () => {
    const messages = [...readPair("a.ts", words(300)), chatter(DEFAULT_SUFFIX_TOKEN_LIMIT + 100), ...readPair("a.ts", words(300))];
    assert.equal(run(messages), undefined);
    assert.equal(textOf(messages[1]!), words(300));
  });

  it("prunes the deep candidate once the last model response is strictly older than the idle cutoff", () => {
    const old = NOW - 6 * MIN - 1;
    const messages = [...readPair("a.ts", words(300), {}, old), chatter(DEFAULT_SUFFIX_TOKEN_LIMIT + 100, old), ...readPair("a.ts", words(300), {}, old)];
    const plan = run(messages);
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(plan?.record.reason, "idle");
  });

  it("holds at exactly the cutoff: the cache must have expired, not be expiring", () => {
    const recent = NOW - 6 * MIN;
    const messages = [...readPair("a.ts", words(300), {}, recent), chatter(DEFAULT_SUFFIX_TOKEN_LIMIT + 100, recent), ...readPair("a.ts", words(300), {}, recent)];
    assert.equal(run(messages), undefined);
  });

  it("a result pruned before stays pruned however deep it has sunk", () => {
    const messages = [...readPair("a.ts", words(300)), chatter(20_000), ...readPair("a.ts", words(300))];
    const earlier: PruneRecord = {
      id: "r1",
      ts: "t",
      entries: [{ id: (messages[0]!.content as Array<{ id: string }>)[0]!.id, kind: "superseded" }],
      superseded: 1,
      useless: 0,
      tokens_saved: 1,
      reason: "tail",
    };
    const plan = run(messages, {}, [earlier]);
    assert.equal(plan, undefined, "nothing new to do");
    assert.equal(textOf(messages[1]!), SUPERSEDED_NOTICE, "the recorded prune is applied on every request");
  });

  it("ignores a recorded prune whose result is no longer in the messages (before a compaction boundary)", () => {
    const messages = [...readPair("a.ts", words(300))];
    const stale: PruneRecord = { id: "r0", ts: "t", entries: [{ id: "gone", kind: "useless" }], superseded: 0, useless: 1, tokens_saved: 9, reason: "tail" };
    assert.equal(run(messages, {}, [stale]), undefined);
    assert.equal(textOf(messages[1]!), words(300));
  });
});

describe("cacheRetentionMs", () => {
  // Pi's own code: `long` sends ttl "1h" on the anthropic-messages api and
  // prompt_cache_retention "24h" on the OpenAI apis; `short` names no figure.
  it("is five minutes on the Anthropic api by default, and an hour when Pi is set to long", () => {
    assert.equal(cacheRetentionMs({}, "anthropic-messages"), 5 * MIN);
    assert.equal(cacheRetentionMs({ PI_CACHE_RETENTION: "short" }, "anthropic-messages"), 5 * MIN);
    assert.equal(cacheRetentionMs({ PI_CACHE_RETENTION: "long" }, "anthropic-messages"), 60 * MIN);
  });
  it("Bedrock long is an hour too: Pi sends a one-hour cache point TTL on that api", () => {
    assert.equal(cacheRetentionMs({ PI_CACHE_RETENTION: "long" }, "bedrock-converse-stream"), 60 * MIN);
    assert.equal(cacheRetentionMs({}, "bedrock-converse-stream"), 60 * MIN, "short names no figure: conservative");
  });
  it("takes the conservative figure where Pi names none: an hour for short, a day for long", () => {
    assert.equal(cacheRetentionMs({}, "openai-responses"), 60 * MIN);
    assert.equal(cacheRetentionMs({}, undefined), 60 * MIN);
    assert.equal(cacheRetentionMs({ PI_CACHE_RETENTION: "long" }, "openai-responses"), 24 * 60 * MIN);
    assert.equal(cacheRetentionMs({ PI_CACHE_RETENTION: "long" }, undefined), 24 * 60 * MIN);
  });
  it("the idle cutoff is the retention plus a margin", () => {
    assert.equal(idleFlushMs({}, "anthropic-messages"), 5 * MIN + IDLE_MARGIN_MS);
  });
});

describe("the useless mark", () => {
  it("is one typed value, and only an explicit true counts", () => {
    assert.equal(isUselessResult(USELESS_DETAILS), true);
    assert.equal(isUselessResult({ ...USELESS_DETAILS, action: "references" }), true);
    assert.equal(isUselessResult({ useless: "yes" }), false);
    assert.equal(isUselessResult(undefined), false);
  });
});

describe("pruneNotice", () => {
  const ON = { supersedeReads: true, dropUseless: true };
  it("says so when a rule is on but lykos-prune is not in the resolved extension list", () => {
    const note = pruneNotice(ON, ["pi-cache-optimizer", "lykos-self-compact"]);
    assert.match(note ?? "", /lykos-prune/);
    assert.match(note ?? "", /extensions:/);
    assert.match(note ?? "", /no tool result will be pruned/);
  });
  it("is silent when it is listed, or when both rules are off", () => {
    assert.equal(pruneNotice(ON, ["lykos-prune"]), undefined);
    assert.equal(pruneNotice({ supersedeReads: false, dropUseless: false }, []), undefined);
  });
});

describe("pruneRowFromEntry", () => {
  const rec = { id: "p", ts: "t", entries: [], superseded: 1, useless: 0, tokens_saved: 5, reason: "tail" };
  it("takes a whole record as the ledger row", () => {
    assert.deepEqual(pruneRowFromEntry(rec), { id: "p", ts: "t", superseded: 1, useless: 0, tokens_saved: 5, reason: "tail" });
  });
  it("makes no row from a record missing a field, rather than guessing one", () => {
    assert.equal(pruneRowFromEntry({ ...rec, tokens_saved: undefined }), undefined);
    assert.equal(pruneRowFromEntry({ ...rec, reason: "soon" }), undefined);
    assert.equal(pruneRowFromEntry(undefined), undefined);
  });
});

describe("the prune policy env", () => {
  it("round-trips, and anything malformed decodes to nothing", () => {
    const p = { supersedeReads: true, dropUseless: false };
    assert.deepEqual(decodePrunePolicyEnv(encodePrunePolicyEnv(p)), p);
    assert.equal(decodePrunePolicyEnv(undefined), null);
    assert.equal(decodePrunePolicyEnv("{"), null);
    assert.equal(decodePrunePolicyEnv('{"supersedeReads":1}'), null);
  });
});

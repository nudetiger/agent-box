// T188: the extension's seam is Pi's `context` event. A fake `pi` hands it
// messages and a session manager, so what is checked is what the next model
// request carries and what is persisted -- the clock and the cache retention
// are the only things a real session cannot be made to wait for.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PRUNE_ENTRY_TYPE, PRUNE_POLICY_ENV, pruneRecordsFromEntries, SUPERSEDED_NOTICE } from "../../loop/tool-result-prune.js";
import lykosPrune, { installPrune } from "./lykos-prune.js";

const T0 = 1_000_000_000_000;
const MIN = 60_000;
const ON = { supersedeReads: true, dropUseless: true };

type Entry = { type: "custom"; customType: string; data: unknown };

function fakePi() {
  const entries: Entry[] = [];
  let handler: ((event: { messages: object[] }, ctx: unknown) => { messages: object[] } | undefined) | undefined;
  const pi = {
    on: (name: string, fn: typeof handler) => {
      if (name === "context") handler = fn;
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI;
  const ctx = { sessionManager: { getBranch: () => entries }, model: { api: "anthropic-messages" } };
  return { pi, entries, send: (messages: object[]) => handler?.({ messages }, ctx) };
}

function harness(opts: { now: () => number; env?: Record<string, string> }) {
  const h = fakePi();
  installPrune(h.pi, ON, opts);
  return h;
}

const read = (id: string, text: string, at: number): object[] => [
  { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path: "a.ts" } }], timestamp: at },
  { role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: at },
];
const filler = (tokens: number, at: number): object => ({ role: "user", content: [{ type: "text", text: "z".repeat(tokens * 4) }], timestamp: at });
const resultText = (m: object): string => ((m as { content: Array<{ text: string }> }).content[0]!.text);

describe("lykos-prune extension", () => {
  const body = "x".repeat(1_200);
  const deep = (at: number): object[] => [...read("r1", body, at), filler(9_000, at), ...read("r2", body, at)];

  it("persists a decision once and applies it to every later request", () => {
    const h = harness({ now: () => T0 });
    const first = h.send([...read("r1", body, T0), ...read("r2", body, T0)]);
    assert.equal(resultText(first!.messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(h.entries.length, 1);
    assert.equal(h.entries[0]!.customType, PRUNE_ENTRY_TYPE);

    // The request after: deeper now, but the recorded prune is applied and nothing new is recorded.
    const later = h.send([...read("r1", body, T0), filler(20_000, T0), ...read("r2", body, T0)]);
    assert.equal(resultText(later!.messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(h.entries.length, 1);
  });

  it("a session rebuilt from the same entries sends the same context", () => {
    const live = harness({ now: () => T0 });
    const sent = live.send([...read("r1", body, T0), ...read("r2", body, T0)]);
    const resumed = harness({ now: () => T0 });
    resumed.entries.push(...live.entries);
    const again = resumed.send([...read("r1", body, T0), ...read("r2", body, T0)]);
    assert.deepEqual(again!.messages, sent!.messages);
    assert.equal(resumed.entries.length, 1, "no second record for a prune already made");
  });

  it("holds a deep candidate while the cache is warm and flushes it only once the last response is past retention plus margin", () => {
    let now = T0 + 6 * MIN;
    const h = harness({ now: () => now });
    assert.equal(h.send(deep(T0)), undefined, "exactly at the cutoff: nothing to do");
    assert.equal(h.entries.length, 0);

    now = T0 + 6 * MIN + 1;
    const flushed = h.send(deep(T0));
    assert.equal(resultText(flushed!.messages[1]!), SUPERSEDED_NOTICE);
    assert.equal(pruneRecordsFromEntries(h.entries)[0]!.reason, "idle");
  });

  it("long cache retention moves the flush past an hour", () => {
    let now = T0 + 61 * MIN;
    const h = harness({ now: () => now, env: { PI_CACHE_RETENTION: "long" } });
    assert.equal(h.send(deep(T0)), undefined);
    now = T0 + 61 * MIN + 1;
    assert.ok(h.send(deep(T0)));
  });

  it("with both rules off it records nothing", () => {
    const h = fakePi();
    installPrune(h.pi, { supersedeReads: false, dropUseless: false }, { now: () => T0 });
    assert.equal(h.send([...read("r1", body, T0), ...read("r2", body, T0)]), undefined);
    assert.equal(h.entries.length, 0);
  });

  it("loaded with no policy in the environment (outside Lykos) it registers nothing", () => {
    const h = fakePi();
    const prior = process.env[PRUNE_POLICY_ENV];
    delete process.env[PRUNE_POLICY_ENV];
    try {
      lykosPrune(h.pi);
    } finally {
      if (prior !== undefined) process.env[PRUNE_POLICY_ENV] = prior;
    }
    assert.equal(h.send([]), undefined);
  });
});

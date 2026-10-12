// P17 T190: the chain's order and runner, at their own interface. The
// session-level behaviour (the side call's request, the ledger row) is proved
// through the scripted session in `cli/scripted-compaction-chain.test.ts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_METHOD_ORDER, parseMethodOrder, runChain } from "./compaction-chain.js";

describe("parseMethodOrder", () => {
  it("defaults to note, handoff, shake, summary", () => {
    assert.deepEqual(parseMethodOrder(undefined), { order: ["note", "handoff", "shake", "summary"], ignored: [] });
    assert.deepEqual([...DEFAULT_METHOD_ORDER], ["note", "handoff", "shake", "summary"]);
  });

  it("ignores unknown names and repeats, and says which", () => {
    const { order, ignored } = parseMethodOrder(["shake", "remote", "Handoff", "shake", 7, "snapcompact"]);
    assert.deepEqual(order, ["shake", "handoff"]);
    assert.deepEqual(ignored, ["remote", "shake", "7", "snapcompact"]);
  });

  it("an empty list stays empty: Pi's summary alone", () => {
    assert.deepEqual(parseMethodOrder([]), { order: [], ignored: [] });
  });

  it("a value that is not a list is ignored and the default stands", () => {
    const parsed = parseMethodOrder("shake");
    assert.deepEqual(parsed.order, ["note", "handoff", "shake", "summary"]);
    assert.deepEqual(parsed.ignored, ["shake"]);
  });
});

describe("runChain", () => {
  it("returns the first method that ran, with the ones before it and why they fell", async () => {
    const out = await runChain<number>(["note", "handoff", "shake", "summary"], {
      note: async () => ({ fell: "no agent note" }),
      handoff: async () => {
        throw new Error("provider outage");
      },
      shake: async () => ({ ran: 7 }),
    });
    assert.equal(out.method, "shake");
    assert.equal(out.value, 7);
    assert.deepEqual(out.tried, [
      { method: "note", reason: "no agent note" },
      { method: "handoff", reason: "provider outage" },
    ]);
  });

  it("ends at summary when every step falls through, and does not run the steps after summary", async () => {
    let ranAfter = false;
    const out = await runChain<number>(["handoff", "summary", "shake"], {
      handoff: async () => ({ fell: "empty" }),
      shake: async () => {
        ranAfter = true;
        return { ran: 1 };
      },
    });
    assert.equal(out.method, "summary");
    assert.equal(out.value, undefined);
    assert.deepEqual(out.tried, [{ method: "handoff", reason: "empty" }]);
    assert.equal(ranAfter, false);
  });

  it("an empty order is summary alone", async () => {
    assert.deepEqual(await runChain<number>([], { shake: async () => ({ ran: 1 }) }), { method: "summary", tried: [] });
  });

  it("stops trying methods once the compaction is aborted", async () => {
    let abort = false;
    let shakeRan = false;
    const out = await runChain<number>(
      ["handoff", "shake"],
      {
        handoff: async () => {
          abort = true;
          return { fell: "cancelled" };
        },
        shake: async () => {
          shakeRan = true;
          return { ran: 1 };
        },
      },
      () => abort,
    );
    assert.equal(out.method, "summary");
    assert.deepEqual(out.tried, [{ method: "handoff", reason: "cancelled" }]);
    assert.equal(shakeRan, false);
  });
});

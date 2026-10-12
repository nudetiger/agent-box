// P17 T190: shake's plan and application, at their own interface. That a shake
// is a compaction that makes no model call is proved through the scripted
// session in `cli/scripted-compaction-chain.test.ts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyShakes, planShake, SHAKE_NOTICE, shakeRecordsFromEntries, shakenIds, type ShakeConfig } from "./shake.js";

const CONFIG: ShakeConfig = { protectTokens: 1_000, minSavings: 500, protectedTools: ["self_compact"] };

/** A tool result of about `tokens` tokens (Pi's chars/4). */
function result(id: string, tokens: number, toolName = "read", extra: object[] = []) {
  return { role: "toolResult", toolCallId: id, toolName, isError: false, content: [{ type: "text", text: "x".repeat(tokens * 4) }, ...extra] };
}
const user = (tokens: number) => ({ role: "user", content: [{ type: "text", text: "u".repeat(tokens * 4) }] });

describe("planShake", () => {
  it("drops tool results outside the protected tail and names them oldest first", () => {
    const messages = [result("a", 800), user(100), result("b", 900), user(100), result("c", 700), user(1_200)];
    const plan = planShake(messages, new Set(), CONFIG);
    assert.deepEqual(plan?.tool_call_ids, ["a", "b", "c"]);
    assert.ok(plan !== undefined && plan.tokens_saved > 2_000 && plan.tokens_saved < 2_400, `saved ${plan?.tokens_saved}`);
  });

  it("keeps the most recent tokens whole", () => {
    const messages = [result("a", 800), result("b", 900), user(100)];
    const plan = planShake(messages, new Set(), { ...CONFIG, protectTokens: 500 });
    assert.deepEqual(plan?.tool_call_ids, ["a"], "b is within 500 tokens of the end");
  });

  it("does nothing when it would free less than minSavings", () => {
    assert.equal(planShake([result("a", 300), user(1_200)], new Set(), CONFIG), undefined);
  });

  it("skips protected tools and results already shaken", () => {
    const messages = [result("a", 900, "self_compact"), result("b", 900), result("c", 900), user(1_200)];
    const plan = planShake(messages, new Set(["b"]), CONFIG);
    assert.deepEqual(plan?.tool_call_ids, ["c"]);
  });
});

describe("applyShakes", () => {
  it("overwrites the text of the named results, keeps an image, and leaves the rest alone", () => {
    const image = { type: "image", data: "AAAA", mimeType: "image/png" };
    const messages = [result("a", 100, "read", [image]), result("b", 100), user(10)];
    applyShakes(messages, new Set(["a"]));
    assert.deepEqual(messages[0]!.content, [{ type: "text", text: SHAKE_NOTICE }, image]);
    assert.equal((messages[1]!.content as Array<{ text: string }>)[0]!.text.length, 400);
  });
});

describe("shake records", () => {
  it("are read back from a session's entries, malformed ones skipped", () => {
    const good = { id: "s1", ts: "2026-10-11T00:00:00.000Z", tool_call_ids: ["a", "b"], tokens_saved: 123 };
    const records = shakeRecordsFromEntries([
      { type: "custom", customType: "lykos-shake", data: good },
      { type: "custom", customType: "lykos-shake", data: { id: "bad" } },
      { type: "custom", customType: "other", data: good },
    ]);
    assert.deepEqual(records, [good]);
    assert.deepEqual([...shakenIds(records)], ["a", "b"]);
  });
});

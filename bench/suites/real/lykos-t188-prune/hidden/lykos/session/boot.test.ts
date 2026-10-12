// T33.3 (docs/15-phase3-tasks.md) — "one head, two injection sites, and a
// parity test that proves it." The container path's copy of the boot/diet/
// output-diet blocks lives in worker.js (hand-mirrored — it cannot import
// this package). This file asserts the SECOND injection site
// (`session/boot.ts`, this process) is built FROM the single-source functions
// rather than a reimplementation, and that its assembled output is
// byte-identical to what `HeadContract.boot()` would freeze for the same
// inputs — the same "read the file, assert structurally" style
// `head-contract.test.ts` already uses for the worker.js side of this same
// parity question.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  boot,
  buildAppendSystemPromptOverride,
  specialistGuardExtensionPath,
  startLiveCapture,
  type BootConfig,
  type BootedStandaloneSession,
} from "./boot.js";
import { assembleBootHead, assembleIdentityHead, fingerprintHead, HeadContract, type BootArtifacts } from "../session/head-contract.js";
import { assembleMountedCatalogHead } from "../session/mounted-catalog-head.js";
import { assembleDietHead, assembleOutputDietHead } from "../loop/prompt-diet.js";
import { assemblePonytailHead, PONYTAIL_REPLACE_MARKER, PONYTAIL_RULESET_TEXT } from "../session/ponytail-head.js";
import { applySpecialist } from "../session/specialist-apply.js";
import { SHIPPED_DEFAULTS } from "../config/defaults.js";
import { AutoApproveGate } from "../gate/approval.js";
import { withLedgerSync } from "../ledger/use.js";
import { createSpecialistGuardHandler } from "../tools/specialist-guard-extension.js";
import type { ModelRuntime, createAgentSession } from "@earendil-works/pi-coding-agent";

// Ticket 08: boot resolves Pi's agent dir through piHostDir(); keep it off the real ~/.lykos/pi-host.
process.env.LYKOS_PI_HOST_DIR = mkdtempSync(join(tmpdir(), "lykos-pi-host-"));

const FROZEN: BootArtifacts = {
  cwd: "/home/user/project",
  platform: "linux",
  project: "project",
  gitHeadAtBoot: "deadbeefcafebabe",
  toolNames: ["read", "bash", "edit", "write"],
};

const sessionSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "boot.ts"), "utf8");

/** T65: a stand-in for whatever `buildMemoryHead()` froze — the override only ever sees a string. */
const MEM_BLOCK = ["## lykos-memory", "- [aaaaaaaa] (gotcha) x"].join("\n");

describe("buildAppendSystemPromptOverride (T33.3 host injection site)", () => {
  it("imports the single-source head functions rather than reimplementing them", () => {
    // The guard against drift: if a future edit inlines its own boot-block
    // string instead of calling assembleBootHead(), this regexes still pass
    // syntactically but the import line disappears — catch that directly.
    assert.match(sessionSource, /import\s*\{[^}]*assembleBootHead[^}]*\}\s*from\s*"\.\/head-contract\.js"/);
    assert.match(sessionSource, /import\s*\{[^}]*assembleDietHead[^}]*assembleOutputDietHead[^}]*\}\s*from\s*"\.\.\/loop\/prompt-diet\.js"/s);
  });

  it("produces exactly [...base, bootHead, identityHead, ponytailHead] with both diet blocks off", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, { promptDietEnabled: false, outputDietEnabled: false });
    const result = append(["You are a coding agent."]);
    assert.deepEqual(result, [
      "You are a coding agent.",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      assemblePonytailHead(),
    ]);
  });

  it("appends identity unconditionally, then the diet and output-diet blocks, then ponytail, in that order, when enabled", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, { promptDietEnabled: true, outputDietEnabled: true });
    const result = append(["base"]);
    assert.deepEqual(result, [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleDietHead(),
      assembleOutputDietHead(),
      assembleMountedCatalogHead(),
      assemblePonytailHead(),
    ]);
  });

  it("is byte-identical to what HeadContract.boot() freezes for the same inputs", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, { promptDietEnabled: false, outputDietEnabled: false });
    const [, bootHead] = append(["base"]);
    const contract = new HeadContract();
    const boot = contract.boot(FROZEN);
    assert.equal(bootHead, boot.bootHead);
    assert.equal(fingerprintHead(bootHead!, FROZEN.toolNames), boot.fingerprint);
  });

  it("never touches process.stdout directly (T32 IO-mode discipline)", () => {
    assert.equal(/process\.stdout\.write/.test(sessionSource), false);
  });

  it("T65: appends the memory block after the rules, ponytail still after that", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: true,
      outputDietEnabled: true,
      memoryHead: MEM_BLOCK,
    });
    assert.deepEqual(append(["base"]), [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleDietHead(),
      assembleOutputDietHead(),
      assembleMountedCatalogHead(),
      MEM_BLOCK,
      assemblePonytailHead(),
    ]);
  });

  it("T65: appends nothing extra when no memory was injected — no empty heading, ponytail still present", () => {
    for (const memoryHead of [undefined, ""]) {
      const append = buildAppendSystemPromptOverride(FROZEN, {
        promptDietEnabled: false,
        outputDietEnabled: false,
        ...(memoryHead === undefined ? {} : { memoryHead }),
      });
      assert.deepEqual(append(["base"]), [
        "base",
        assembleBootHead(FROZEN),
        assembleIdentityHead(),
        assembleMountedCatalogHead(),
        assemblePonytailHead(),
      ]);
    }
  });

  it("T65: the memory block is frozen at build time, not re-read per call", () => {
    // The whole point of putting memory in the head rather than per turn
    // (problems/09's "cache invalidation" failure mode): two calls to the
    // same closure must produce byte-identical output.
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      memoryHead: MEM_BLOCK,
    });
    assert.deepEqual(append(["base"]), append(["base"]));
  });

  it("specialists ticket 01/03: appends ponytail then the specialist instructions block last, after memory (T148: the repo map is an extension now, not a head block)", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: true,
      outputDietEnabled: true,
      memoryHead: MEM_BLOCK,
      specialistInstructions: "Prefer the smallest correct change.",
    });
    assert.deepEqual(append(["base"]), [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleDietHead(),
      assembleOutputDietHead(),
      assembleMountedCatalogHead(),
      MEM_BLOCK,
      assemblePonytailHead(),
      "## lykos-specialist\nPrefer the smallest correct change.",
    ]);
  });

  it("specialists ticket 01: appends only ponytail — no empty specialist heading — when no specialist instructions were resolved", () => {
    for (const specialistInstructions of [undefined, ""]) {
      const append = buildAppendSystemPromptOverride(FROZEN, {
        promptDietEnabled: false,
        outputDietEnabled: false,
        ...(specialistInstructions === undefined ? {} : { specialistInstructions }),
      });
      assert.deepEqual(append(["base"]), [
        "base",
        assembleBootHead(FROZEN),
        assembleIdentityHead(),
        assembleMountedCatalogHead(),
        assemblePonytailHead(),
      ]);
    }
  });

  it("specialists ticket 01: two boots with the same specialist produce a byte-identical head", () => {
    const optsA = {
      promptDietEnabled: true,
      outputDietEnabled: true,
      specialistInstructions: "Prefer the smallest correct change.",
    };
    const optsB = { ...optsA };
    const a = buildAppendSystemPromptOverride(FROZEN, optsA)(["base"]);
    const b = buildAppendSystemPromptOverride(FROZEN, optsB)(["base"]);
    assert.deepEqual(a, b);
  });

  it("specialists ticket 03: every session gets the ponytail block by default, with no specialist at all", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, { promptDietEnabled: false, outputDietEnabled: false });
    const result = append(["base"]);
    assert.equal(result.includes(assemblePonytailHead()), true);
  });

  it("specialists ticket 03: a specialist appends its own instructions after the default ladder", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: "Prefer the smallest correct change.",
    });
    const result = append(["base"]);
    assert.deepEqual(result, [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      assemblePonytailHead(),
      "## lykos-specialist\nPrefer the smallest correct change.",
    ]);
  });

  it("specialists ticket 03: a specialist can replace the ponytail block entirely instead of appending", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: `${PONYTAIL_REPLACE_MARKER}\nDeliberate fully; weigh alternatives before committing.`,
    });
    const result = append(["base"]);
    assert.deepEqual(result, [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      "## lykos-ponytail\nDeliberate fully; weigh alternatives before committing.",
    ]);
    // No default ladder text, and no separate specialist block — fully replaced.
    assert.equal(result.some((b) => b.includes("Does this need to be built at all?")), false);
    assert.equal(result.some((b) => b.startsWith("## lykos-specialist")), false);
  });

  it("specialists ticket 06: appends the plan-against-skill block after ponytail and before the specialist block", () => {
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      planAgainstSkillHead: "## lykos-plan-against-skill\nname the skill and map to its steps",
      specialistInstructions: "Prefer the smallest correct change.",
    });
    assert.deepEqual(append(["base"]), [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      assemblePonytailHead(),
      "## lykos-plan-against-skill\nname the skill and map to its steps",
      "## lykos-specialist\nPrefer the smallest correct change.",
    ]);
  });

  it("specialists ticket 06: appends no plan block when no skills loaded — the head is byte-identical to today", () => {
    for (const planAgainstSkillHead of [undefined, ""]) {
      const append = buildAppendSystemPromptOverride(FROZEN, {
        promptDietEnabled: false,
        outputDietEnabled: false,
        ...(planAgainstSkillHead === undefined ? {} : { planAgainstSkillHead }),
      });
      assert.deepEqual(append(["base"]), [
        "base",
        assembleBootHead(FROZEN),
        assembleIdentityHead(),
        assembleMountedCatalogHead(),
        assemblePonytailHead(),
      ]);
    }
  });

  it("specialists band 2 ticket 01: specialist with prompt_mode: override produces prompt with instructions and without ponytail ruleset", () => {
    const instructions = "You are a code reviewer. Do not modify files.";
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: instructions,
      specialist: { prompt_mode: "override" },
    });
    const result = append(["base"]);
    const fullPrompt = result.join("\n\n");

    assert.equal(fullPrompt.includes(instructions), true);
    assert.equal(fullPrompt.includes(PONYTAIL_RULESET_TEXT), false);
    assert.deepEqual(result, [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      `## lykos-specialist\n${instructions}`,
    ]);
  });

  it("specialists band 2 ticket 01: specialist with prompt_mode: append and one omitting it produce byte-identical prompts", () => {
    const instructions = "Prefer the smallest correct change.";
    const appendExplicit = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: instructions,
      specialist: { prompt_mode: "append" },
    });
    const appendOmitted = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: instructions,
    });
    const expected = [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      assemblePonytailHead(),
      `## lykos-specialist\n${instructions}`,
    ];
    assert.deepEqual(appendExplicit(["base"]), expected);
    assert.deepEqual(appendOmitted(["base"]), expected);
    assert.deepEqual(appendExplicit(["base"]), appendOmitted(["base"]));
  });

  it("specialists band 2 ticket 01: the assembly delegates the mode decision to applySpecialist", () => {
    // D5: boot.ts must not decide what a specialist means. Proving that from the
    // outside means showing the assembly follows the seam's answer for the same
    // input rather than reading `prompt_mode` itself, in both directions.
    const instructions = "Review only.";
    const fields = [
      { prompt_mode: "override" as const, expectPonytail: false },
      { prompt_mode: "append" as const, expectPonytail: true },
    ];
    for (const { prompt_mode, expectPonytail } of fields) {
      const decided = applySpecialist({
        specialist: { instructions, prompt_mode },
        context: "session-start",
        defaultToolNames: [...FROZEN.toolNames],
      });
      assert.equal(decided.replacesDefaultHead, !expectPonytail);
      const assembled = buildAppendSystemPromptOverride(FROZEN, {
        promptDietEnabled: false,
        outputDietEnabled: false,
        specialistInstructions: instructions,
        specialist: { prompt_mode },
      })(["base"]);
      assert.equal(
        assembled.includes(assemblePonytailHead()),
        !decided.replacesDefaultHead,
        `assembly must follow applySpecialist for prompt_mode: ${prompt_mode}`,
      );
    }
  });

  it("specialists band 2 ticket 01: the specialist's other fields reach the seam intact", () => {
    // The regression this guards: a caller that forwards only the fields it uses
    // starves the seam. Nothing here reads `model` yet — ticket 05 does, and by
    // then a partial input would be a silent wrong answer rather than a failure.
    const decided = applySpecialist({
      specialist: { instructions: "x", provider: "deepseek", model: "deepseek-chat", tools_mode: "override" },
      context: "session-start",
      defaultToolNames: [...FROZEN.toolNames],
    });
    assert.equal(decided.model, "deepseek/deepseek-chat");
    assert.equal(decided.toolsMode, "override");
  });

  it("specialists band 2 ticket 01: specialist using PONYTAIL_REPLACE_MARKER produces byte-identical output", () => {
    const replacementText = `${PONYTAIL_REPLACE_MARKER}\nDeliberate fully; weigh alternatives before committing.`;
    const append = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialistInstructions: replacementText,
    });
    const result = append(["base"]);
    assert.deepEqual(result, [
      "base",
      assembleBootHead(FROZEN),
      assembleIdentityHead(),
      assembleMountedCatalogHead(),
      "## lykos-ponytail\nDeliberate fully; weigh alternatives before committing.",
    ]);
  });

  it("specialists ticket 02: offLimitsPromptPart is included under tools_mode append with off-limit tools", () => {
    const app = applySpecialist({
      name: "reviewer",
      specialist: { tools_mode: "append" },
      context: "session-start",
      defaultToolNames: ["read", "bash"],
      specialistToolNames: ["read"],
    });
    const appendWithApp = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      app,
    });
    const result = appendWithApp(["base"]);
    assert.ok(result.some((p) => p.includes("## lykos-off-limits") && p.includes("bash")));
  });

  it("specialists ticket 02: byte-identical prompt when no tools are off-limits", () => {
    const appendBase = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
    });
    const appendNoRestrictions = buildAppendSystemPromptOverride(FROZEN, {
      promptDietEnabled: false,
      outputDietEnabled: false,
      specialist: { tools_mode: "append" },
    });
    assert.deepEqual(appendBase(["base"]), appendNoRestrictions(["base"]));
  });
});

// 2026-09-03 regression. `lykos` (fullscreen interactive) died on boot with
// `TypeError: Cannot read properties of undefined (reading '_eventListeners')`
// thrown inside Pi's `AgentSession.subscribe`. The cause was in
// `startLiveCapture()` (T53): it lifted `subscribe` off the session object and
// called it bare, so `this` was undefined inside a PROTOTYPE METHOD. The
// existing T53 tests could not see it — their fake source is an object
// literal whose `subscribe` closes over its listener array and never touches
// `this`, which is exactly the shape the real session is not.
describe("startLiveCapture (2026-09-03 boot regression)", () => {
  it("calls a prototype-method subscribe with its session as the receiver", () => {
    class PiLikeSession {
      readonly sessionId = "sess-bind-1";
      private readonly _eventListeners: Array<(ev: unknown) => void> = [];
      subscribe(listener: (ev: unknown) => void): () => void {
        // Identical to Pi's: an unbound call throws on this property access.
        this._eventListeners.push(listener);
        return () => {
          const i = this._eventListeners.indexOf(listener);
          if (i >= 0) this._eventListeners.splice(i, 1);
        };
      }
      get listenerCount(): number {
        return this._eventListeners.length;
      }
    }

    const session = new PiLikeSession();
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "lykos-live-bind-")), "ledger.db");
    const booted = {
      bootArtifacts: FROZEN,
      bootFingerprint: "fp-boot",
      frozenContextFiles: [],
      promptDietEnabled: false,
      outputDietEnabled: false,
      // T97 added `hostExtensions` to the resume contract and read
      // `.loaded` off it unguarded, which made this fixture throw. Present
      // here as the empty resolution a host with nothing installed produces
      // — which is this machine's actual state.
      hostExtensions: { loaded: [], missing: [], paths: [] },
      // T98: the sink `startLiveCapture()` fills in so a changed list reaches
      // the session directory.
      taskListSink: {},
      // T103: the sink `startLiveCapture()` fills so an answered question
      // reaches the transcript.
      answerSink: {},
      startedAt: new Date().toISOString(),
    } as unknown as BootedStandaloneSession;

    const { recorder, detach } = startLiveCapture({ ledgerPath, booted, session, modelSpec: "deepseek/deepseek-chat" });

    assert.ok(recorder, "a real ledger path must produce a recorder");
    assert.equal(session.listenerCount, 1, "the recorder must be subscribed to the live session");
    detach();
    assert.equal(session.listenerCount, 0, "detach must remove exactly the listener it added");
  });
});

describe("startLiveCapture writes a prune's ledger row when the prune is made (T188)", () => {
  it("a session that never reaches its end still has its prunes rows", async () => {
    const listeners: Array<(ev: unknown) => void> = [];
    const session = {
      sessionId: "sess-prune-live",
      subscribe: (fn: (ev: unknown) => void) => {
        listeners.push(fn);
        return () => {};
      },
    };
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "lykos-live-prune-")), "ledger.db");
    const booted = {
      bootArtifacts: FROZEN,
      bootFingerprint: "fp-boot",
      frozenContextFiles: [],
      promptDietEnabled: false,
      outputDietEnabled: false,
      hostExtensions: { loaded: [], missing: [], paths: [] },
      taskListSink: {},
      answerSink: {},
      startedAt: new Date().toISOString(),
    } as unknown as BootedStandaloneSession;
    startLiveCapture({ ledgerPath, booted, session, modelSpec: "deepseek/deepseek-chat" });

    for (const fn of listeners) {
      fn({
        type: "entry_appended",
        entry: {
          customType: "lykos-prune",
          data: { id: "p-1", ts: "2026-10-11T00:00:00.000Z", entries: [{ id: "c1", kind: "superseded" }], superseded: 1, useless: 0, tokens_saved: 77, reason: "tail" },
        },
      });
    }
    // endExtensionSession is never called: the row must already be there.
    let rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = withLedgerSync(ledgerPath, (l) => l.prunes("sess-prune-live"));
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.tokens_saved, 77);
    assert.equal(rows[0]!.reason, "tail");
  });
});

describe("boot tools_mode and specialist guard enforcement (ticket 02)", () => {
  it("specialistGuardExtensionPath resolves to an existing file", () => {
    const p = specialistGuardExtensionPath();
    assert.ok(p.endsWith("specialist-guard-extension.ts") || p.endsWith("specialist-guard-extension.js"));
  });
  it("tools_mode: override removes disallowed tools from active tools (criterion 4)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lykos-boot-override-"));
    let captured: string[] = [];
    const stub = (async (opts: any = {}) => {
      captured = [...(opts.tools ?? [])];
      return { session: { sessionId: "s1", getActiveToolNames: () => captured, setActiveToolsByName: () => {}, abort: () => {} } };
    }) as unknown as typeof createAgentSession;
    await boot(
      {
        cwd,
        config: { ...SHIPPED_DEFAULTS, tools_mode: "override", tools_remove: ["bash"] },
        model: { provider: "test", id: "stub" } as BootConfig["model"],
        modelRuntime: {} as ModelRuntime,
        gate: new AutoApproveGate(),
        ledgerPath: ":memory:",
        modelSpec: "test/stub",
        specialistName: "reviewer",
      },
      { createSession: stub },
    );
    assert.ok(!captured.includes("bash"), "bash must be absent under override");
    assert.ok(captured.includes("read"), "read must remain resident");
  });
  it("tools_mode: append keeps disallowed tool and refuses at dispatch (criterion 1, 2, 7)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lykos-boot-app-"));
    let captured: string[] = [];
    const stub = (async (opts: any = {}) => {
      captured = [...(opts.tools ?? [])];
      return { session: { sessionId: "s2", getActiveToolNames: () => captured, setActiveToolsByName: () => {}, abort: () => {} } };
    }) as unknown as typeof createAgentSession;
    const booted = await boot(
      {
        cwd,
        config: { ...SHIPPED_DEFAULTS, tools_mode: "append", tools_remove: ["bash"] },
        model: { provider: "test", id: "stub" } as BootConfig["model"],
        modelRuntime: {} as ModelRuntime,
        gate: new AutoApproveGate(),
        ledgerPath: ":memory:",
        modelSpec: "test/stub",
        specialistName: "reviewer",
      },
      { createSession: stub },
    );
    assert.ok(captured.includes("bash"), "bash must remain in active tools under append");
    const guard = createSpecialistGuardHandler({ denials: booted.denials });
    const blocked = guard({ toolName: "bash" } as any);
    assert.ok(blocked?.block);
    assert.match(blocked?.reason ?? "", /reviewer/);
    assert.match(blocked?.reason ?? "", /bash/);
    assert.equal(guard({ toolName: "read" } as any), undefined);
    assert.equal(booted.denials.specialistRestricted, 1);
  });

});

describe("T154: PI_BASE_TOOL_NAMES is Pi's own list", () => {
  it("equals the keys of createAllToolDefinitions in the installed Pi", async () => {
    // Not exported from Pi's package entry, so read from its file, as rule 1 asks.
    // The entry resolves to dist/index.js; its tools module sits beside it.
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const toolsUrl = new URL("./core/tools/index.js", entry).href;
    const tools = (await import(toolsUrl)) as {
      createAllToolDefinitions: (cwd: string) => Record<string, unknown>;
    };
    const { PI_BASE_TOOL_NAMES } = await import("./boot.js");
    assert.deepEqual([...PI_BASE_TOOL_NAMES].sort(), Object.keys(tools.createAllToolDefinitions(process.cwd())).sort());
  });
});

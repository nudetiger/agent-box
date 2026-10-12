// P10.4 (ticket 15) — the `lsp` tool.
//
// **Every test here drives a REAL language server**, because the thing worth
// pinning is that the compiler's answer arrives — a fake server would only
// prove this file can parse JSON it wrote itself. Each one points the server
// at a temporary directory and kills it in a `finally`; a server pointed at
// this repository would index thousands of files to answer a question about
// four lines, and a leaked one is a process the user has to hunt down.
//
// The rename tests are the ones that matter most, and they follow
// `ast-edit.test.ts` deliberately: the assertions that end in "and nothing
// was written" read the working tree rather than the return value, because a
// tool that reports a refusal and writes anyway would pass every assertion
// about its own message.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  AutoApproveGate,
  DenialLog,
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalRequest,
} from "../gate/approval.js";
import { decideForMode, tierForAction } from "../gate/modes.js";
import { TOOL_CATALOG } from "../ledger/tool-catalog.js";
import { measureToolset } from "../ledger/tool-schema.js";
import { SHIPPED_DEFAULTS } from "../config/defaults.js";
import { DEFAULT_RESIDENT_TOOLS, MOUNTED_TOOLS, TOOL_REGISTRY } from "./tool-surface.js";
import { riskForTool, tierForTool } from "./tool-risk.js";
import { tierForToolCall } from "./tool-call.js";
import { DEFAULT_LSP_SERVERS, LspServerPool } from "./lsp-client.js";
import { shutdownAndAssertGone } from "./lsp-test-workspace.js";
import {
  LSP_ACTIONS,
  LSP_DESCRIPTION,
  LSP_PARAMETERS,
  LSP_TOOL_NAME,
  buildLspTool,
  collectWorkspaceEdits,
  extractHoverText,
  normalizeLocations,
} from "./lsp.js";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

interface TextResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
}

async function run(tool: unknown, params: unknown): Promise<TextResult> {
  const def = tool as { execute: (...args: unknown[]) => Promise<TextResult> };
  return await def.execute("call-1", params, undefined, undefined, undefined);
}

function textOf(result: TextResult): string {
  return result.content?.[0]?.text ?? "";
}

/** Every request the gate was asked, and a decision the test chooses per call. */
class RecordingGate implements ApprovalGate {
  readonly seen: ApprovalRequest[] = [];
  constructor(private readonly answer: (req: ApprovalRequest, index: number) => ApprovalDecision) {}
  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    this.seen.push(req);
    return this.answer(req, this.seen.length - 1);
  }
}

const A_TEXT = "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n";
const B_TEXT = 'import { greet } from "./a.js";\n\nexport const line = greet("world");\nexport const again = greet("x");\n';
const BROKEN_TEXT = 'export const n: number = "definitely not a number";\n';

/**
 * A workspace the TypeScript server can actually resolve across. The
 * `package.json` is load-bearing: under `moduleResolution: NodeNext` a
 * directory without `"type": "module"` resolves `./a.js` differently, and
 * without it a cross-file `references` answer quietly collapses to one hit.
 */
function writeWorkspace(dir: string): { a: string; b: string; broken: string } {
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true },
    }),
    "utf8",
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lykos-lsp-fixture", type: "module" }), "utf8");
  const a = join(dir, "a.ts");
  const b = join(dir, "b.ts");
  const broken = join(dir, "broken.ts");
  writeFileSync(a, A_TEXT, "utf8");
  writeFileSync(b, B_TEXT, "utf8");
  writeFileSync(broken, BROKEN_TEXT, "utf8");
  return { a, b, broken };
}

interface Harness {
  dir: string;
  files: { a: string; b: string; broken: string };
  pool: LspServerPool;
  tool: ReturnType<typeof buildLspTool>;
  gate: RecordingGate;
  dispose: () => Promise<void>;
}

function harness(answer: (req: ApprovalRequest, index: number) => ApprovalDecision = () => "allow"): Harness {
  const dir = tmp("lykos-p104-lsp-");
  const files = writeWorkspace(dir);
  const pool = new LspServerPool({ cwd: dir });
  const gate = new RecordingGate(answer);
  const tool = buildLspTool({ cwd: dir, gate, pool });
  return {
    dir,
    files,
    pool,
    tool,
    gate,
    dispose: async () => {
      await shutdownAndAssertGone(pool, dir);
    },
  };
}

// ---------------------------------------------------------------------------
// Everything that needs no server
// ---------------------------------------------------------------------------

describe("P10.4 D9: the catalog prices what lsp would send", () => {
  it("the row equals the live definition, description and parameters both", () => {
    const row = TOOL_CATALOG.lsp;
    assert.ok(row);
    assert.equal(row.name, LSP_TOOL_NAME);
    assert.equal(row.source, "lykos");
    assert.equal(row.description, LSP_DESCRIPTION);
    assert.deepEqual(row.parameters, asJson(LSP_PARAMETERS));
  });

  // Measured with `measureToolset` on SCHEMA_TOKENS_BASIS, 2026-09-21. The
  // last two assertions are the point of D9: a tool was added and the
  // resident surface did not move a single token, because it is mounted.
  it("costs 386 tokens if it ever goes resident, and 0 today", () => {
    const alone = measureToolset([LSP_TOOL_NAME]);
    assert.equal(alone.complete, true);
    assert.equal(alone.tokens, 386);
    assert.equal(alone.bytes, 1544);
    // P10.7 (ticket 12): 1423 until this line was last touched, and 2062 now.
    // The resident total MOVED for the first time since P10.4, because
    // `web_search` (314 alone) and `web_fetch` (326 alone) were made RESIDENT
    // rather than mounted — 639 together, since array wrapping means the pair
    // is not the sum of the two. Nothing about this file's tool moved; this
    // line prices the surface it is being compared against.
    assert.equal(measureToolset(DEFAULT_RESIDENT_TOOLS).tokens, 2255);
    assert.equal(DEFAULT_RESIDENT_TOOLS.includes(LSP_TOOL_NAME), false);
    // The mounted set is what moved: 3049 tokens before this ticket, 3434
    // after. None of it rides a request — `tool_call` fetches one schema at a
    // time — but an unpriced tool makes the whole toolset NULL rather than a
    // silent undercount, so it is measured either way.
    //
    // P10.5 (ticket 16) then mounted `hub` and the set moved again, 3434 to
    // 3788, ticket 17's mailbox ops on that same tool moved it once more to
    // 4065, P10.6's five memory tools took it to 5322, and ticket 19's `eval`
    // and `github` took it to 6430. The figure this
    // test owns is `lsp`'s own 386, asserted
    // above and unchanged; the mounted total is a shared number that every
    // mounted tool moves when it ships, so it is updated here rather than
    // pinned to a world that no longer exists. `hub.test.ts` records the same
    // steps from its own side.
    // P10.6 ticket 20 moved the mounted total again, 6430 -> 8605 tokens, and
    // P10.8's `security_scan` took it to 9027,
    // when the nine session and context tools shipped. `lsp`'s own 386 is
    // unchanged; this line is the shared total every mounted tool moves.
    assert.equal(measureToolset(MOUNTED_TOOLS).tokens, 9022);
    assert.equal(MOUNTED_TOOLS.includes(LSP_TOOL_NAME), true);
  });
});

describe("P10.4 D6: the declared tier is the ceiling, and rename is why", () => {
  it("is soft-write everywhere the question can be asked", () => {
    assert.equal(tierForTool(LSP_TOOL_NAME), "soft-write");
    assert.deepEqual(riskForTool(LSP_TOOL_NAME), {
      tier: "soft-write",
      idempotent: false,
      openWorld: false,
    });
    // The transport does not launder the tier: `tool_call` is `hard-write`
    // itself and is tiered on whatever it dispatches to.
    assert.equal(tierForToolCall("tool_call", { name: LSP_TOOL_NAME, arguments: {} }), "soft-write");
    // And a rename's own gate request is `kind: "edit"`, so the tier the
    // registry declares and the tier the gate computes agree rather than
    // being two opinions that can drift.
    assert.equal(tierForAction({ kind: "edit" }), "soft-write");
  });

  it("asks in Manual and is auto-allowed nowhere a soft write would not be", () => {
    const action = { kind: "edit" } as const;
    assert.equal(decideForMode("manual", action, new Set()).verdict, "ask");
    assert.equal(
      decideForMode("auto", action, new Set()).verdict,
      decideForMode("auto", { kind: "write" }, new Set()).verdict,
    );
  });

  it("is mounted and hidden, so its schema is off the wire", () => {
    const row = TOOL_REGISTRY.find((e) => e.name === LSP_TOOL_NAME);
    assert.ok(row);
    assert.equal(row.residency, "mounted");
    assert.equal(row.promptPresence, "hidden");
  });
});

describe("P10.4 D4: the server table is configuration with a shipped default", () => {
  it("ships one entry, for the languages this repository is written in", () => {
    assert.deepEqual(Object.keys(SHIPPED_DEFAULTS.lsp.servers), ["typescript"]);
    const decl = SHIPPED_DEFAULTS.lsp.servers.typescript!;
    assert.equal(decl.command, "typescript-language-server");
    assert.deepEqual(decl.args, ["--stdio"]);
    assert.deepEqual(decl.extensions, [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
    // The client reads the shipped table rather than keeping a copy of it.
    assert.equal(DEFAULT_LSP_SERVERS, SHIPPED_DEFAULTS.lsp.servers);
  });
});

describe("P10.4: protocol shapes are read defensively", () => {
  it("normalizes Location, Location[], LocationLink and LocationLink[] to one shape", () => {
    const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
    const one = normalizeLocations({ uri: "file:///x/a.ts", range });
    assert.equal(one.length, 1);
    assert.match(one[0]!.path.replace(/\\/g, "/"), /\/x\/a\.ts$/);
    // A LocationLink prefers targetSelectionRange, which is the identifier
    // rather than the whole declaration body.
    const link = normalizeLocations([
      { targetUri: "file:///x/b.ts", targetRange: range, targetSelectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } } },
    ]);
    assert.deepEqual(link[0]!.range.start, { line: 5, character: 0 });
    assert.deepEqual(normalizeLocations(null), []);
    assert.deepEqual(normalizeLocations([]), []);
  });

  it("flattens every hover-contents spelling", () => {
    assert.equal(extractHoverText("plain"), "plain");
    assert.equal(extractHoverText({ kind: "markdown", value: " x " }), "x");
    assert.equal(extractHoverText([{ value: "a" }, "b"]), "a\nb");
    assert.equal(extractHoverText(null), "");
  });

  it("reads both WorkspaceEdit spellings, so a second server is not a silent no-op", () => {
    const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "z" };
    const changes = collectWorkspaceEdits({ changes: { "file:///x/a.ts": [edit] } });
    assert.equal(changes.size, 1);
    const docChanges = collectWorkspaceEdits({
      documentChanges: [{ textDocument: { uri: "file:///x/a.ts" }, edits: [edit] }],
    });
    assert.equal(docChanges.size, 1);
    assert.deepEqual([...changes.keys()], [...docChanges.keys()]);
    assert.equal(collectWorkspaceEdits(null).size, 0);
  });
});

// ---------------------------------------------------------------------------
// Everything that needs a real server
// ---------------------------------------------------------------------------

describe("P10.4: definition, references, hover, symbols and diagnostics against a real server", () => {
  const h = harness();
  after(async () => {
    await h.dispose();
  });

  it("definition returns the declaration in the OTHER file, at a real position", async () => {
    const result = await run(h.tool, { action: "definition", file: "b.ts", line: 3, symbol: "greet" });
    assert.equal(result.details?.success, true);
    assert.equal(result.details?.count, 1);
    // `a.ts:1:17` is where `greet` is declared. A grep for "greet" would have
    // returned four lines across two files; this is the one that is the
    // declaration, and that difference is the whole reason this tool exists.
    assert.equal(result.details?.useless, undefined, "an answer is not a useless result");
    assert.match(textOf(result), /^1 definition:$/m);
    assert.match(textOf(result), /^ {2}a\.ts:1:17 {2}export function greet/m);
  });

  it("references crosses files and includes the declaration", async () => {
    const result = await run(h.tool, { action: "references", file: "a.ts", line: 1, symbol: "greet" });
    assert.equal(result.details?.count, 4);
    const out = textOf(result);
    assert.match(out, /^4 references:$/m);
    assert.match(out, /^ {2}a\.ts:1:17/m);
    assert.match(out, /^ {2}b\.ts:1:10/m);
    assert.match(out, /^ {2}b\.ts:3:21/m);
    assert.match(out, /^ {2}b\.ts:4:22/m);
  });

  it("hover returns the type, and symbols lists what the file declares", async () => {
    const hover = await run(h.tool, { action: "hover", file: "a.ts", line: 1, symbol: "greet" });
    assert.match(textOf(hover), /function greet\(name: string\): string/);

    const symbols = await run(h.tool, { action: "symbols", file: "a.ts" });
    assert.equal(symbols.details?.count, 1);
    assert.match(textOf(symbols), /^Symbols in a\.ts:$/m);
    assert.match(textOf(symbols), /function greet — line 1/);
  });

  it("diagnostics reports the error a broken file actually has, and says a clean file is clean", async () => {
    const broken = await run(h.tool, { action: "diagnostics", file: "broken.ts" });
    assert.equal(broken.details?.published, true, "the server published diagnostics for this file");
    const out = textOf(broken);
    assert.match(out, /^broken\.ts: 1 diagnostic\.$/m);
    // TS2322 is "Type 'string' is not assignable to type 'number'". The
    // assertion names the code AND the position, because "there is some
    // error" is exactly the answer a model cannot act on.
    assert.match(out, /^ {2}1:14 error \[2322\]: /m);
    assert.match(out, /not assignable to type 'number'/);

    const clean = await run(h.tool, { action: "diagnostics", file: "a.ts" });
    assert.equal(clean.details?.count, 0);
    assert.match(textOf(clean), /^a\.ts: no diagnostics\./m);
  });

  it("status names every configured server and whether it is running", async () => {
    const result = await run(h.tool, { action: "status" });
    const out = textOf(result);
    assert.match(out, /^Language servers:$/m);
    assert.match(out, /typescript: running \(pid \d+\)/);
    assert.match(out, /\[\.ts \.tsx/);
  });

  it("a symbol that is not on the named line says so, naming the line", async () => {
    await assert.rejects(
      () => run(h.tool, { action: "definition", file: "a.ts", line: 2, symbol: "greet" }),
      /"greet" is not on line 2/,
    );
  });

  it("an unknown action names the seven that exist", async () => {
    await assert.rejects(() => run(h.tool, { action: "code_actions", file: "a.ts" }), (err: unknown) => {
      assert.match(String(err), /unknown action "code_actions"/);
      for (const action of LSP_ACTIONS) assert.match(String(err), new RegExp(action));
      return true;
    });
  });

  // The ticket's checkbox for a slow server, at the tool's own seam: one
  // millisecond is a timeout no real answer beats, and the turn comes back
  // with a message instead of hanging.
  it("a request that outruns its timeout returns a message and leaves the server running", async () => {
    await assert.rejects(
      () => run(h.tool, { action: "definition", file: "b.ts", line: 3, symbol: "greet", timeout: 0.001 }),
      /did not answer textDocument\/definition within/,
    );
    assert.equal(h.pool.status()[0]!.running, true, "a timeout must not throw away the session's index");
    // And the session is still usable afterwards.
    const after = await run(h.tool, { action: "definition", file: "b.ts", line: 3, symbol: "greet" });
    assert.equal(after.details?.count, 1);
  });
});

describe("P10.4 D7: rename is one approval for the whole workspace edit", () => {
  it("shows a diff per file, approves every file before writing any, and names each changed file", async () => {
    const h = harness(() => "allow");
    try {
      const tool = buildLspTool({ cwd: h.dir, gate: h.gate, pool: h.pool });
      const result = await run(tool, {
        action: "rename",
        file: "a.ts",
        line: 1,
        symbol: "greet",
        new_name: "salute",
      });

      // Two files, two approvals, and the body is the DIFF rather than the
      // whole new file — the one thing this tool can show that a
      // `writeFile(path, content)` seam cannot.
      assert.equal(h.gate.seen.length, 2);
      assert.deepEqual(h.gate.seen.map((r) => r.kind), ["edit", "edit"]);
      assert.deepEqual(h.gate.seen.map((r) => r.detail), [h.files.a, h.files.b]);
      assert.match(h.gate.seen[0]!.body ?? "", /^--- a\.ts$/m);
      assert.match(h.gate.seen[0]!.body ?? "", /^-export function greet\(name: string\): string \{$/m);
      assert.match(h.gate.seen[0]!.body ?? "", /^\+export function salute\(name: string\): string \{$/m);
      assert.match(h.gate.seen[1]!.body ?? "", /^\+import \{ salute \} from "\.\/a\.js";$/m);

      assert.equal(readFileSync(h.files.a, "utf8"), A_TEXT.replace("greet", "salute"));
      assert.equal(
        readFileSync(h.files.b, "utf8"),
        'import { salute } from "./a.js";\n\nexport const line = salute("world");\nexport const again = salute("x");\n',
      );
      const out = textOf(result);
      assert.match(out, /^Renamed to salute: 4 edits across 2 files\.$/m);
      // T168: each changed file is named, and no tag is returned.
      assert.match(out, /^1 edit in a\.ts$/m);
      assert.match(out, /^3 edits in b\.ts$/m);
      assert.doesNotMatch(out, /#[0-9A-F]{4}\]/);
    } finally {
      await h.dispose();
    }
  });

  it("a refusal writes nothing, and the denial is recorded as a human intervention", async () => {
    const h = harness(() => "deny");
    try {
      const denials = new DenialLog();
      const tool = buildLspTool({ cwd: h.dir, gate: h.gate, pool: h.pool, denials });
      await assert.rejects(
        () => run(tool, { action: "rename", file: "a.ts", line: 1, symbol: "greet", new_name: "salute" }),
        /declined this edit/,
      );
      assert.equal(readFileSync(h.files.a, "utf8"), A_TEXT);
      assert.equal(readFileSync(h.files.b, "utf8"), B_TEXT);
      assert.equal(denials.userRejected, 1);
    } finally {
      await h.dispose();
    }
  });

  it("declining ONE file of the set writes nothing anywhere, including the file already approved", async () => {
    const h = harness((_req, i) => (i === 0 ? "allow" : "deny"));
    try {
      const tool = buildLspTool({ cwd: h.dir, gate: h.gate, pool: h.pool });
      await assert.rejects(
        () => run(tool, { action: "rename", file: "a.ts", line: 1, symbol: "greet", new_name: "salute" }),
        /all-or-nothing across 2 files/,
      );
      assert.equal(h.gate.seen.length, 2);
      // A symbol renamed in some of its files and not the others does not
      // compile, which is why declining the second one discards the first.
      assert.equal(readFileSync(h.files.a, "utf8"), A_TEXT);
      assert.equal(readFileSync(h.files.b, "utf8"), B_TEXT);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a rename with no new name, and one with no line, before any server is asked", async () => {
    const h = harness();
    try {
      const tool = buildLspTool({ cwd: h.dir, gate: h.gate, pool: h.pool });
      await assert.rejects(
        () => run(tool, { action: "rename", file: "a.ts", line: 1, symbol: "greet" }),
        /rename needs `new_name`/,
      );
      await assert.rejects(
        () => run(tool, { action: "rename", file: "a.ts", symbol: "greet", new_name: "x" }),
        /rename needs a line/,
      );
      assert.equal(h.gate.seen.length, 0);
      assert.equal(readFileSync(h.files.a, "utf8"), A_TEXT);
    } finally {
      await h.dispose();
    }
  });

  it("renaming a position that is not a symbol writes nothing and says why", async () => {
    const h = harness();
    try {
      const tool = buildLspTool({ cwd: h.dir, gate: new AutoApproveGate(), pool: h.pool });
      // Line 2 of a.ts is `  return \`hi ${name}\`;` — `hi` is inside a
      // template literal, so there is nothing to rename there.
      const result = await run(tool, { action: "rename", file: "a.ts", line: 2, symbol: "hi", new_name: "hey" });
      assert.equal(result.details?.applied, false);
      assert.match(textOf(result), /returned no edits, so nothing was written/);
      assert.equal(readFileSync(h.files.a, "utf8"), A_TEXT);
    } finally {
      await h.dispose();
    }
  });
});

describe("P10.4 D4: a missing server is an answer, not a throw", () => {
  it("a language with no configured server reports what would configure it", async () => {
    const dir = tmp("lykos-p104-lsp-noserver-");
    const pool = new LspServerPool({ cwd: dir });
    try {
      writeFileSync(join(dir, "main.rs"), "fn main() {}\n", "utf8");
      const tool = buildLspTool({ cwd: dir, gate: new AutoApproveGate(), pool });
      const result = await run(tool, { action: "definition", file: "main.rs", line: 1, symbol: "main" });
      assert.equal(result.isError, undefined, "this is an answer, not a failure");
      assert.equal(result.details?.configured, false);
      assert.match(textOf(result), /No language server is configured for \.rs files/);
      assert.match(textOf(result), /`lsp\.servers`/);
      assert.deepEqual(pool.pids(), [], "nothing was spawned");
    } finally {
      await shutdownAndAssertGone(pool, dir);
    }
  });

  it("a configured server whose executable is missing names the executable", async () => {
    const dir = tmp("lykos-p104-lsp-missing-");
    const pool = new LspServerPool({
      cwd: dir,
      servers: { ghost: { command: "lykos-no-such-language-server", args: ["--stdio"], extensions: [".ts"] } },
    });
    try {
      writeFileSync(join(dir, "a.ts"), "export const x = 1;\n", "utf8");
      const tool = buildLspTool({ cwd: dir, gate: new AutoApproveGate(), pool });
      const result = await run(tool, { action: "diagnostics", file: "a.ts" });
      assert.equal(result.isError, undefined);
      assert.equal(result.details?.configured, false);
      assert.match(textOf(result), /lykos-no-such-language-server/);
      assert.match(textOf(result), /not on PATH/);
      // `status` says the same thing, so the two answers cannot disagree.
      assert.match(textOf(await run(tool, { action: "status" })), /not found — `lykos-no-such-language-server`/);
      assert.deepEqual(pool.pids(), []);
    } finally {
      await shutdownAndAssertGone(pool, dir);
    }
  });

  it("a file that cannot be read is refused before any server is consulted", async () => {
    const dir = tmp("lykos-p104-lsp-nofile-");
    const pool = new LspServerPool({ cwd: dir });
    try {
      const tool = buildLspTool({ cwd: dir, gate: new AutoApproveGate(), pool });
      await assert.rejects(
        () => run(tool, { action: "symbols", file: "nope.ts" }),
        /nope\.ts cannot be read\. Nothing was asked of any server\./,
      );
      assert.deepEqual(pool.pids(), []);
    } finally {
      await shutdownAndAssertGone(pool, dir);
    }
  });
});

// ---------------------------------------------------------------------------
// T160: a server that has not finished loading says so
// ---------------------------------------------------------------------------

/**
 * A language server that answers every request and never publishes
 * diagnostics — so it never signals that it has loaded the project. Before
 * T160 every action waited out the load window and then asked it anyway.
 */
const NEVER_LOADS = `
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
    // With --publish-once, the first didOpen is answered with a publish (the
    // project "loaded") and no later one is: a server that stalled after loading.
    if (msg.method === "textDocument/didOpen" && process.argv.includes("--publish-once") && !globalThis.published) {
      globalThis.published = true;
      send({ method: "textDocument/publishDiagnostics", params: { uri: msg.params.textDocument.uri, diagnostics: [] } });
    }
    if (msg.id === undefined) continue;
    if (msg.method === "initialize") send({ id: msg.id, result: { capabilities: { definitionProvider: true, renameProvider: true } } });
    else if (msg.method === "textDocument/definition") send({ id: msg.id, result: [] });
    else send({ id: msg.id, result: null });
  }
});
`;

describe("T160: a language server that is not ready says so", () => {
  function stubHarness(...flags: string[]) {
    const dir = tmp("lykos-t160-lsp-");
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n", "utf8");
    const script = join(dir, "never-loads.cjs");
    writeFileSync(script, NEVER_LOADS, "utf8");
    // The stub lives in the workspace and is run by an outside `node`; this test is
    // about readiness, so the workspace is trusted (T171 refuses it otherwise).
    const pool = new LspServerPool({
      cwd: dir,
      workspaceTrusted: true,
      servers: { stub: { command: process.execPath, args: [script, ...flags], extensions: [".ts"] } },
    });
    const tool = buildLspTool({ cwd: dir, gate: new RecordingGate(() => "allow"), pool });
    return { dir, pool, tool, dispose: async () => {
      await shutdownAndAssertGone(pool, dir);
    } };
  }

  it("a request past the project-load wait is refused with the not-ready error, never answered", async () => {
    const h = stubHarness();
    try {
      await assert.rejects(
        () => run(h.tool, { action: "definition", file: "a.ts", line: 1, symbol: "a", timeout: 0.5 }),
        /lykos lsp: language server not ready — stub has not finished loading the project for a\.ts within 0\.5s, so nothing was answered/,
      );
      // Still not ready on the next call: one timed-out wait does not mark the document loaded.
      await assert.rejects(
        () => run(h.tool, { action: "definition", file: "a.ts", line: 1, symbol: "a", timeout: 0.5 }),
        /language server not ready/,
      );
    } finally {
      await h.dispose();
    }
  });

  it("T188: a bare empty lookup is flagged useless so lykos-prune may elide it; diagnostics never are", async () => {
    const h = stubHarness("--publish-once");
    try {
      const empty = await run(h.tool, { action: "definition", file: "a.ts", line: 1, symbol: "a", timeout: 2 });
      assert.match(textOf(empty), /^No definition found/);
      assert.equal(empty.details?.useless, true);
      const refs = await run(h.tool, { action: "references", file: "a.ts", line: 1, symbol: "a", timeout: 2 });
      assert.match(textOf(refs), /^No reference found/);
      assert.equal(refs.details?.useless, true);
      const hover = await run(h.tool, { action: "hover", file: "a.ts", line: 1, symbol: "a", timeout: 2 });
      assert.match(textOf(hover), /^No hover information/);
      assert.equal(hover.details?.useless, undefined, "oh-my-pi's lsp does not flag an empty hover");
    } finally {
      await h.dispose();
    }
  });

  it("diagnostics from a server that never publishes is the not-ready error, not an empty (clean) list", async () => {
    const h = stubHarness();
    try {
      await assert.rejects(
        () => run(h.tool, { action: "diagnostics", file: "a.ts", timeout: 0.5 }),
        (err: unknown) => {
          assert.match(String(err), /language server not ready/);
          assert.doesNotMatch(String(err), /no diagnostics/);
          return true;
        },
      );
    } finally {
      await h.dispose();
    }
  });

  it("a diagnostics check whose reopened document is never published for is not ready, not clean", async () => {
    // The first open loads (one publish), so the file is ready; the check's
    // own reopen then gets no publish at all within its wait.
    const h = stubHarness("--publish-once");
    try {
      const nav = await run(h.tool, { action: "definition", file: "a.ts", line: 1, symbol: "a", timeout: 2 });
      assert.notEqual(nav.isError, true);
      await assert.rejects(
        () => run(h.tool, { action: "diagnostics", file: "a.ts", timeout: 0.5 }),
        /lykos lsp: language server not ready — stub has not finished loading the project for a\.ts/,
      );
    } finally {
      await h.dispose();
    }
  });
});

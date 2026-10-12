// lib/stats.mjs against an empty ledger, the hand-counted fixture (fixtures/ledger.mjs), the headless
// TUI and the live view's fixture probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, NOW, G } from "./fixtures/ledger.mjs";
import { strw } from "../lib/stats/style.mjs";
import { OWNER, scope } from "../lib/stats/data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-box-stats-"));
const FX = path.join(tmp, "events.jsonl");
fs.writeFileSync(FX, fixture());
const EMPTY = path.join(tmp, "missing.jsonl");
const LIVE = path.join(tmp, "live.json");
fs.writeFileSync(LIVE, JSON.stringify([
  { name: "agent-box-lykos-impl-a", project: "lykos", run: "impl-a", created: (NOW - 400) * 1000,
    progress: { phase: "agent", started: (NOW - 372) * 1000, model: G, role: "implement", steps: 23, tools: 41,
      last: { tool: "edit", what: "src/ledger/write.ts", ts: (NOW - 3) * 1000 }, tokens: { input: 120000, output: 3400, cache_read: 880000 },
      questions_open: 0, blocked: false, autofix: 0 } },
  { name: "agent-box-rakun-quick-9", project: "rakun", run: "quick-9", created: (NOW - 90) * 1000,
    progress: { phase: "test", started: (NOW - 88) * 1000, model: "cu/composer-2.5-fast", role: "quick", steps: 9, tools: 14,
      last: { tool: "bash", what: "npm test", ts: (NOW - 12) * 1000 }, tokens: { input: 40000, output: 900, cache_read: 10000 },
      questions_open: 1, blocked: true, autofix: 1 } },
  { name: "agent-box-clikit-esc-2", project: "clikit", run: "esc-2", created: (NOW - 5) * 1000, progress: null },
]));

const ENV = { ...process.env, STATS_NOW: String(NOW), NO_COLOR: "", AGENT_BOX_LEDGER: FX, STATS_LIVE_FIXTURE: LIVE };
delete ENV.STATS_TUI_HEADLESS;
const stats = (args, env = {}) => execFileSync(process.execPath, [path.join(ROOT, "lib", "stats.mjs"), ...args], { env: { ...ENV, ...env }, encoding: "utf8" });
const json = (...args) => JSON.parse(stats(["json", ...args]));
const VIEWS = [["overview"], ["models"], ["runs"], ["run", "impl-b"], ["run", "impl-a"], ["flags"], ["flags", "MISREPORT"], ["causes"],
  ["causes", "spec_vague"], ["notes"], ["reviews"], ["bench"], ["compare"], ["unlabeled"], ["live"]];

test("a missing ledger renders every view without crashing", () => {
  for (const v of VIEWS) {
    const out = stats([...v, "--color", "never", "--width", "80"], { AGENT_BOX_LEDGER: EMPTY, STATS_LIVE_FIXTURE: EMPTY });
    for (const l of out.split("\n")) assert.ok(strw(l) <= 80, `${v} line too wide: ${l}`);
  }
  assert.match(stats(["runs", "--color", "never"], { AGENT_BOX_LEDGER: EMPTY }), /nothing recorded in this window/);
  assert.match(stats(["run", "nope", "--color", "never"], { AGENT_BOX_LEDGER: EMPTY }), /no run event for 'nope'/);
  const k = JSON.parse(stats(["json", "overview"], { AGENT_BOX_LEDGER: EMPTY })).header.kpis;
  assert.equal(k.runs, 0);
  assert.equal(k.passRate, null);   // no denominator: "–", never 0
  assert.equal(k.cacheHit, null);
  assert.equal(k.cost, null);
});

test("an empty ledger file is the same as a missing one", () => {
  const f = path.join(tmp, "empty.jsonl");
  fs.writeFileSync(f, "");
  assert.match(stats(["--color", "never", "--width", "100"], { AGENT_BOX_LEDGER: f }), /runs 0 {4}pass – {4}first try –/);
});

for (const width of [80, 140]) {
  test(`every static view fits ${width} columns`, () => {
    for (const v of VIEWS) {
      const out = stats([...v, "--color", "never", "--width", String(width)]);
      assert.ok(out.trim().length > 0, `${v} is empty`);
      assert.doesNotMatch(out, /\x1b/, `${v} has escape codes with --color never`);
      for (const l of out.split("\n")) assert.ok(strw(l) <= width, `${v.join(" ")} line ${strw(l)} > ${width}: ${l}`);
    }
  });
}

test("the views show the hand-counted numbers", () => {
  const o = stats(["--color", "never", "--width", "140"]);
  for (const s of ["runs 16", "pass 50% 7/14", "▼17pt", "first try 45% 5/11 tasks", "cache hit 77%", "unlabeled 5", "accepted 4 67% of 6", "rejected 1",
    "cost $0.42 1/16 runs priced", "reviews 3", "false positive 67% of 3 labeled", "attempts 4"]) assert.ok(o.includes(s), `overview lacks "${s}"`);
  const m = stats(["models", "--color", "never", "--width", "140"]);
  assert.match(m, /implement +│ gemini-3\.8-flash +│ +9 │ +38% │/);
  assert.match(m, /1\/2/);   // rescue: impl-b-r2 passed after an auto-fix, impl-b did not
  const r = stats(["run", "impl-b", "--color", "never", "--width", "120"]);
  for (const s of ["verdict fail", "worker_misreport (auto)", "worker_careless (orchestrator)", "review_false_positive", "rejected", "impl-b-r2"])
    assert.ok(r.includes(s), `run view lacks "${s}"`);
  assert.doesNotMatch(r, /NEEDS A REASON/);
  const a = stats(["run", "impl-a", "--color", "never", "--width", "120"]);
  assert.match(a, /CONTEXT GAPS/);
  assert.match(a, /docs\/ledger\.md was not in context/);
  assert.match(a, /delegate\.sh note lykos review-1 --refs [0-9a-f]{8}#3 --cause <cause> --why "\.\.\."/);
  assert.match(a, /steps 20\/25/);
  const u = stats(["unlabeled", "--color", "never", "--width", "140"]);
  assert.match(u, /5 items in 3 runs/);
  assert.match(u, /delegate\.sh note clikit bench-c1 --refs [0-9a-f]{8}#STAND-IN/);
  assert.match(u, /[0-9a-f]{8}#verdict/);
  assert.match(stats(["flags", "MISREPORT", "--color", "never"]), /impl-b/);
  assert.match(stats(["causes", "spec_vague", "--color", "never"]), /The task said nothing about retry\./);
  assert.match(stats(["bench", "--color", "never", "--width", "140"]), /core\/impossible \(blocked\)/);
  assert.match(stats(["compare", "--color", "never"]), /aaaa1111 → bbbb2222/);
});

test("json: rates computed by hand from the fixture", () => {
  const o = json("overview");
  const k = o.header.kpis;
  assert.equal(k.runs, 16);
  assert.equal(k.passRate, 7 / 14);            // review and explore runs are not graded
  assert.equal(k.firstTry, 5 / 11);            // tasks whose first run passed on its first test run
  assert.equal(k.cacheHit, 54000 / (16000 + 54000));
  assert.equal(k.unlabeled, 5);
  assert.equal(k.accepted, 4);                 // accepted + merged
  assert.equal(k.outcomes, 6);
  assert.equal(k.cost, 0.42);
  assert.equal(o.header.prev.passRate, 2 / 3);
  assert.equal(o.reviews.fpRate, 2 / 3);       // review_false_positive / labeled findings
  assert.equal(o.reviews.confirmedRate, 2 / 4);
  assert.equal(o.bench.rate, 2 / 4);
  const g = json("models").models.find((x) => x.role === "implement" && x.model === G);
  assert.equal(g.passRate, 3 / 8);
  assert.equal(g.rescueRate, 1 / 2);
  assert.equal(g.questions, 2);
  const c = Object.fromEntries(json("causes").causes.map((x) => [x.cause, x]));
  assert.equal(c.spec_vague.n, 2);
  assert.equal(c.spec_vague.agree, 0);         // worker said ctx_missing, orchestrator spec_vague
  assert.equal(c.worker_careless.agree, 1);
  assert.equal(c.worker_misreport.n, 2);       // the auto label and the rejected outcome's own cause
  assert.equal(c.ctx_missing, undefined);      // #context labels never count as a cause item
  assert.deepEqual(json("causes").context, [{ project: "lykos", runs: 1, gaps: 2, perRun: 1 / 7 }]);
  const b = json("bench").bench;
  const lead = Object.fromEntries(b.models.map((x) => [x.model, x]));
  assert.equal(lead[G].honesty, 1);
  assert.equal(lead["cu/composer-2.5-fast"].honesty, 0);
  const cmp = json("compare");
  assert.equal(cmp.a, "aaaa1111");
  assert.equal(cmp.A.passRate, 3 / 7);
  assert.equal(cmp.B.passRate, 6 / 10);
  assert.equal(cmp.A.misreport, null);         // no run of that version had a report
  assert.equal(json("runs").runs.length, 16);
  assert.equal(json("overview", "--since", "all").header.kpis.runs, 19);
  assert.equal(json("overview", "--project", "rakun").header.kpis.runs, 4);
  assert.equal(json("run", "impl-b").event.verdict, "fail");
});

test("an orchestrator label overrides a newer worker label", () => {
  const ev = (o) => { const e = { v: 1, project: "p", run: "r", ...o }; Object.defineProperty(e, "t", { value: Date.parse(o.ts) / 1000 }); return e; };
  const D = scope([
    ev({ id: "aaaaaaaa", ts: "2026-10-01T00:00:00Z", type: "run", mode: "implement", verdict: "fail", flags: [] }),
    ev({ id: "bbbbbbbb", ts: "2026-10-01T01:00:00Z", type: "label", refs: ["aaaaaaaa#verdict"], cause: "spec_vague", source: "orchestrator" }),
    ev({ id: "cccccccc", ts: "2026-10-01T02:00:00Z", type: "label", refs: ["aaaaaaaa#verdict"], cause: "env", source: "worker" }),
  ], { since: 0 }, NOW);
  assert.equal(D.items.length, 1);
  assert.equal(D.items[0].lab.eff.cause, "spec_vague");
});

test("the cause owners cover exactly the writer's causes", async () => {
  const { CAUSES } = await import("../lib/ledger.mjs");
  assert.deepEqual(Object.keys(OWNER).sort(), [...CAUSES].sort());
});

test("live view reads the injected probe", () => {
  const out = stats(["live", "--color", "never", "--width", "140"]);
  for (const s of ["3 running", "waiting on you 1", "impl-a", "6m12s", "cache 88%", "src/ledger/write.ts", "3s ago", "1 open question", "starting"])
    assert.ok(out.includes(s), `live lacks "${s}"`);
  const m = json("live");
  assert.equal(m.workers.length, 3);
  const a = m.workers.find((w) => w.run === "impl-a");
  assert.equal(a.elapsed, 372);
  assert.equal(a.cacheHit, 880000 / 1000000);
  assert.equal(m.workers.find((w) => w.run === "esc-2").phase, "starting");
  const none = path.join(tmp, "none.json");
  fs.writeFileSync(none, "[]");
  assert.match(stats(["live", "--color", "never"], { STATS_LIVE_FIXTURE: none }), /No worker is running/);
});

test("headless tui: 2, j, Enter, Esc, q", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "lib", "stats.mjs"), "tui", "--color", "never", "--width", "120"],
    { env: { ...ENV, STATS_TUI_HEADLESS: "1", LINES: "40" }, input: "2j\r\x1bq", encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith("\x1b[?1049h\x1b[?25l"), "enters the alternate screen and hides the cursor");
  assert.ok(r.stdout.endsWith("\x1b[?25h\x1b[?1049l"), "restores the screen on quit");
  const frames = r.stdout.split("\x1b[H").slice(1).map((f) => f.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
  assert.equal(frames.length, 5);   // start, then one frame per key before q
  const sel = (f) => f.split("\n").find((l) => l.includes("▌"));
  assert.match(frames[0], /\[1 overview\]/);
  assert.match(frames[1], /\[2 models\]/);
  assert.match(sel(frames[1]), /escalate/);
  assert.match(sel(frames[2]), /implement +│ gemini-3\.8-flash/);
  assert.match(frames[3], /\[3 runs\]/);
  assert.match(frames[3], /RUNS · ROLE IMPLEMENT · MODEL GEMINI-3\.8-FLASH +9 · newest first/);
  assert.match(frames[3], /models › runs implement gemini-3\.8-flash/);
  assert.match(frames[4], /\[2 models\]/);
  assert.match(sel(frames[4]), /implement +│ gemini-3\.8-flash/);   // back restores the selection
  for (const f of frames) for (const l of f.split("\n")) assert.ok(strw(l) <= 120, `tui line too wide: ${l}`);
  assert.equal(frames[0].split("\n").length, 40);
});

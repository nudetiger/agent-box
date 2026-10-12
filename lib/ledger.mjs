// The ledger: one JSON line per event in ledger/events.jsonl (schema: docs/ledger.md). Written by the
// harness from each run's files, never by a model.
//
//   node lib/ledger.mjs finish <repo> <run-dir> [--mode M] [--parent RUN] [--bench SUITE/TASK]
//                              [--feature F] [--ticket T] [--target BRANCH]
//        checks the run (lib/checks.mjs), adds flags/verdict/next to its summary.json, appends the run
//        event (+ review event, + automatic labels) and prints one verdict line
//   node lib/ledger.mjs note <project> <run> (--refs a,b | --all) --cause C --why MD [--source S]
//   node lib/ledger.mjs outcome <project> <run> --result accepted|rejected|merged|discarded [--cause C] --why MD
//   node lib/ledger.mjs refs <project> <run>     items of the run that need a reason, labelled or not
//   node lib/ledger.mjs append <type> <json> [--project P] [--run R] [--role R] [--model M]
//   node lib/ledger.mjs harness                  content hash of the worker-facing harness
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { checks, readJson } from "./checks.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER = process.env.AGENT_BOX_LEDGER || path.join(BOX, "ledger", "events.jsonl");
export const CAUSES = ["ctx_missing", "spec_vague", "scope_too_narrow", "worker_careless", "worker_scope_creep",
  "worker_misreport", "worker_ignored_rule", "model_limit", "seal_correct", "seal_too_tight", "review_false_positive", "env", "other"];
const RESULTS = ["accepted", "rejected", "merged", "discarded"];

// Secrets never reach the ledger, whatever field they hide in (pattern from AgentOrchestratingSkill).
const REDACT = /(authorization|x-api-key)\s*[:=]\s*\S+(\s+\S+)?|bearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*\S+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/gi;
const redact = (v) => (typeof v === "string" ? v.replace(REDACT, "[REDACTED]")
  : Array.isArray(v) ? v.map(redact) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)])) : v);
const clip = (v, n) => (typeof v === "string" ? (v.length > n ? v.slice(0, n) + "…" : v)
  : Array.isArray(v) ? v.map((x) => clip(x, n)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, n)])) : v);

export function harnessHash() {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(path.join(BOX, "image"));
  for (const f of ["lib/pack.mjs", "lib/checks.mjs"]) files.push(path.join(BOX, f));
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(path.relative(BOX, f).replace(/\\/g, "/")).update("\0").update(fs.readFileSync(f).toString("utf8").replace(/\r\n/g, "\n")).update("\0");
  return h.digest("hex").slice(0, 8);
}

function lock() {
  const dir = path.join(path.dirname(LEDGER), ".lock");
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  for (let i = 0; i < 200; i++) {
    try { fs.mkdirSync(dir); return () => fs.rmSync(dir, { recursive: true, force: true }); }
    catch { try { if (Date.now() - fs.statSync(dir).mtimeMs > 10000) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`ledger lock ${dir} is stuck`);
}

let HARNESS;
export function append(type, body, env = {}) {
  HARNESS ??= harnessHash();
  const ev = { v: 1, id: crypto.randomBytes(4).toString("hex"), ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"), type,
    project: env.project ?? null, run: env.run ?? null, role: env.role ?? null, model: env.model ?? null, harness: HARNESS,
    ...redact(body) };
  let line = JSON.stringify(ev);
  if (line.length > 8000) line = JSON.stringify({ ...clip(ev, 300), truncated: true });
  const unlock = lock();
  try { fs.appendFileSync(LEDGER, line + "\n"); } finally { unlock(); }
  return ev;
}

export function readAll() {
  let text = "";
  try { text = fs.readFileSync(LEDGER, "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).flatMap((l) => { try { const e = JSON.parse(l); return e && typeof e === "object" ? [e] : []; } catch { return []; } });
}

// KEY=value lines written with printf %q.
function readMeta(file) {
  const out = {};
  let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const l of text.split("\n")) {
    const m = l.match(/^([A-Z_]+)=(.*)$/); if (!m) continue;
    let v = m[2];
    if (v === "''") v = "";
    else if (v.startsWith("$'")) v = v.slice(2, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    else if (v.startsWith("'")) v = v.slice(1, -1);
    else v = v.replace(/\\(.)/g, "$1");
    out[m[1]] = v;
  }
  return out;
}

function agentMetrics(file) {
  const m = { steps: 0, tools: 0, tool_s: 0, tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }, cost: 0 };
  let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  for (const l of text.split("\n")) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    const p = e.part || {};
    if (e.type === "step_start") m.steps++;
    else if (e.type === "tool_use") { m.tools++; const t = p.state?.time; if (t?.end && t?.start) m.tool_s += (t.end - t.start) / 1000; }
    else if (e.type === "step_finish") {
      const t = p.tokens || {};
      m.tokens.input += t.input || 0; m.tokens.output += t.output || 0; m.tokens.reasoning += t.reasoning || 0;
      m.tokens.cache_read += t.cache?.read || 0; m.tokens.cache_write += t.cache?.write || 0;
      m.cost += p.cost || 0;
    }
  }
  m.tool_s = Math.round(m.tool_s);
  return m;
}

// A fenced ```<name> JSON block in the worker's final message, or null.
export function finalBlock(dir, name) {
  let t = ""; try { t = fs.readFileSync(path.join(dir, "final.md"), "utf8"); } catch { return null; }
  const b = t.match(new RegExp("```" + name + "[^\\n]*\\n([\\s\\S]*?)\\n\\s*```"));
  if (!b) return null;
  try { return JSON.parse(b[1]); } catch { return null; }
}

const ENV_ERR =/quota|rate.?limit|\b429\b|\b401\b|\b403\b|unauthori[sz]ed|invalid.*(token|key)|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|overloaded/i;
const AUTO = { "OUT-OF-SCOPE": ["worker_scope_creep", "Changed files outside `files:`, `scope:` and their tests."],
  MISREPORT: ["worker_misreport", "The worker's report claimed passing tests; the harness's own test run failed."],
  "SEALED-EDIT": ["worker_ignored_rule", "The worker edited a sealed file; the harness reverted it."],
  "WEAK-SPEC": ["spec_vague", "The sealed tests passed on the base, so they did not pin the change."] };

export function finish(repo, dir, opts = {}) {
  const sumFile = path.join(dir, "summary.json");
  const s = readJson(sumFile);
  if (!s) throw new Error(`no summary.json in ${dir}`);
  const meta = readMeta(path.join(dir, "meta.sh"));
  const pack = readJson(path.join(dir, "pack.json"), {});
  const run = path.basename(dir), project = path.basename(path.dirname(dir));
  const findings = readJson(path.join(dir, "findings.json"));
  s.mode = opts.mode || (meta.SKIP_AGENT === "1" ? "baseline" : s.review ? "review" : "implement");
  s.findings = Array.isArray(findings) ? findings.length : null;
  if (s.mode === "tests") s.tests_mode = finalBlock(dir, "agent-box-tests")?.mode ?? "red";
  const c = checks({ repo, summary: s, pack, branch: `agent/${run}` });
  Object.assign(s, { flags: c.flags, verdict: c.verdict, next: c.next, diff: c.diff });
  fs.writeFileSync(sumFile, JSON.stringify(s, null, 2));

  const body = fs.existsSync(path.join(dir, "task-body.md")) ? fs.readFileSync(path.join(dir, "task-body.md"), "utf8") : "";
  const msg = fs.existsSync(path.join(dir, "message.md")) ? fs.readFileSync(path.join(dir, "message.md"), "utf8") : "";
  const m = agentMetrics(path.join(dir, "events.jsonl"));
  const env = { project, run, role: meta.ROLE || null, model: s.model || meta.MODEL || null };
  const [bsuite, btask] = (opts.bench || "").split("/");
  const ev = append("run", {
    mode: s.mode, parent: opts.parent || null, round: s.round ?? 1,
    task: body ? crypto.createHash("sha1").update(body).digest("hex").slice(0, 8) : null,
    title: ((msg || body).split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 80) || null,
    feature: opts.feature || null, ticket: opts.ticket || null, bench: opts.bench ? { suite: bsuite, task: btask } : null,
    base: (s.base || "").slice(0, 10), head: (s.head || "").slice(0, 10), effort: meta.EFFORT || null,
    seconds: { total: s.seconds, setup: s.phase_seconds?.setup ?? null, agent: s.phase_seconds?.agent ?? null, test: s.phase_seconds?.test ?? null },
    exits: { setup: s.setup_exit, agent: s.agent_exit, test: s.test_exit, first_test: s.first_test_exit ?? s.test_exit },
    steps: m?.steps ?? null, tools: m?.tools ?? null, tool_s: m?.tool_s ?? null, tokens: m?.tokens ?? null, cost: m ? Math.round(m.cost * 1e6) / 1e6 : null,
    commits: s.commits, diff: c.diff, verdict: c.verdict, flags: c.flags, autofix: s.autofix ?? 0,
    questions: s.questions ?? { asked: 0, answered: 0 },
    report: s.report && typeof s.report === "object" && !s.report.parse_error ? { status: s.report.status ?? null, tests: s.report.tests ?? null,
      context_gaps: (s.report.context_gaps ?? []).slice(0, 8), decisions: (s.report.decisions ?? []).slice(0, 8) } : null,
    steps_budget: Number(pack.steps) || null,
  }, env);

  const labels = [];
  for (const f of c.flags) if (AUTO[f.flag]) labels.push([`${ev.id}#${f.flag}`, ...AUTO[f.flag]]);
  let log = ""; try { log = fs.readFileSync(path.join(dir, "opencode.log"), "utf8").slice(-20000); } catch { /* none */ }
  if (c.verdict === "setup_failed") labels.push([`${ev.id}#verdict`, "env", "Setup (dependencies) failed before the worker ran."]);
  else if (c.verdict === "error" && (s.agent_exit === -2 || ENV_ERR.test(log))) labels.push([`${ev.id}#verdict`, "env", "OmniRoute unreachable, quota, auth or network error."]);
  for (const [ref, cause, why] of labels) append("label", { refs: [ref], cause, source: "auto", why }, env);

  if (Array.isArray(findings)) {
    append("review", { target: opts.target || meta.REVIEW_TARGET || meta.RUN_BASE_REF || null,
      verdict: findings.length ? "issues" : "clean",
      findings: findings.slice(0, 20).map((x, i) => ({ n: i + 1, severity: x.severity ?? null, confidence: x.confidence ?? null,
        category: x.category ?? null, file: x.file ?? null, line: x.line ?? null, issue: String(x.issue ?? "").slice(0, 200) })) }, env);
  } else if (s.mode === "review") {
    append("review", { target: opts.target || meta.REVIEW_TARGET || meta.RUN_BASE_REF || null, verdict: "error", findings: [] }, env);
  }
  // Worker labels: its own account of what the task should have said.
  if (s.report?.context_gaps?.length) append("label", { refs: [`${ev.id}#context`], cause: "ctx_missing", source: "worker",
    why: s.report.context_gaps.map((g) => `- ${g}`).join("\n") }, env);
  return { s, ev };
}

// Items of a run that need a reason (docs/ledger.md "Needs a reason"), with their current label.
export function refsOf(events, project, run) {
  const runs = events.filter((e) => e.type === "run" && e.project === project && e.run === run);
  const reviews = events.filter((e) => e.type === "review" && e.project === project && e.run === run);
  const out = [];
  for (const r of runs) {
    for (const f of r.flags ?? []) if (!["SENSITIVE", "LEFTOVERS"].includes(f.flag)) out.push({ ref: `${r.id}#${f.flag}`, what: `${f.flag}: ${f.detail}` });
    if (["fail", "blocked", "error", "timeout"].includes(r.verdict)) out.push({ ref: `${r.id}#verdict`, what: `verdict ${r.verdict}` });
  }
  for (const v of reviews) for (const f of v.findings ?? []) out.push({ ref: `${v.id}#${f.n}`, what: `finding ${f.n} (${f.severity}, ${f.confidence}): ${f.issue}` });
  for (const o of events.filter((e) => e.type === "outcome" && e.project === project && e.target_run === run && e.result === "rejected"))
    out.push({ ref: o.id, what: `rejected: ${String(o.why ?? "").slice(0, 100)}`, own: o.cause });
  const labels = events.filter((e) => e.type === "label");
  for (const o of out) {
    const mine = labels.filter((l) => (l.refs ?? []).includes(o.ref));
    const eff = mine.filter((l) => l.source === "orchestrator").at(-1) ?? mine.at(-1);
    o.cause = eff?.cause ?? o.own ?? null; o.source = eff?.source ?? (o.own ? "orchestrator" : null);
    delete o.own;
  }
  return out;
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const k = argv[i].slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; } }
    else o._.push(argv[i]);
  }
  return o;
}
const die = (m) => { console.error(`ledger: ${m}`); process.exit(1); };
const why = (o) => (o["why-file"] ? fs.readFileSync(o["why-file"], "utf8") : o.why === "-" ? fs.readFileSync(0, "utf8") : o.why);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (cmd === "harness") console.log(harnessHash());
  else if (cmd === "finish") {
    const [repo, dir] = o._;
    const { s, ev } = finish(repo, dir, o);
    const fl = s.flags.map((f) => f.flag).join(",");
    console.log(`verdict ${s.verdict}${fl ? `  flags ${fl}` : ""}  next ${s.next}  (ledger ${ev.id})`);
  } else if (cmd === "append") {
    const [type, json] = o._;
    console.log(append(type, JSON.parse(json || "{}"), { project: o.project, run: o.run, role: o.role, model: o.model }).id);
  } else if (cmd === "refs") {
    const [project, run] = o._;
    const r = refsOf(readAll(), project, run);
    if (!r.length) console.log("nothing needs a reason");
    for (const x of r) console.log(`${x.ref.padEnd(22)} ${(x.cause ? `${x.cause} (${x.source})` : "UNLABELED").padEnd(34)} ${x.what.slice(0, 120)}`);
  } else if (cmd === "note") {
    const [project, run] = o._;
    if (!CAUSES.includes(o.cause)) die(`--cause must be one of: ${CAUSES.join(", ")}`);
    const text = why(o);
    if (!text?.trim()) die("--why is required: what happened, the evidence, the fix (markdown)");
    const known = refsOf(readAll(), project, run);
    const refs = o.all ? known.filter((x) => !x.cause || x.source !== "orchestrator").map((x) => x.ref) : String(o.refs || "").split(",").filter(Boolean);
    if (!refs.length) die("give --refs a,b or --all (ledger.mjs refs <project> <run> lists them)");
    const bad = refs.filter((r) => !known.some((k) => k.ref === r));
    if (bad.length) die(`unknown refs for ${project}/${run}: ${bad.join(", ")}`);
    const run1 = readAll().filter((e) => e.type === "run" && e.project === project && e.run === run).at(-1);
    append("label", { refs, cause: o.cause, source: o.source || "orchestrator", why: text.slice(0, 3000) }, { project, run, role: run1?.role, model: run1?.model });
    console.log(`labelled ${refs.length} item(s) of ${run}: ${o.cause}`);
  } else if (cmd === "outcome") {
    const [project, run] = o._;
    if (!RESULTS.includes(o.result)) die(`--result must be one of: ${RESULTS.join(", ")}`);
    if (o.cause && !CAUSES.includes(o.cause)) die(`--cause must be one of: ${CAUSES.join(", ")}`);
    const text = why(o) || "";
    if (o.result === "rejected" && !text.trim()) die("a rejection needs --why");
    const run1 = readAll().filter((e) => e.type === "run" && e.project === project && e.run === run).at(-1);
    if (!run1) die(`no run ${project}/${run} in the ledger`);
    append("outcome", { target_run: run, result: o.result, cause: o.cause || null, why: text.slice(0, 3000) }, { project, run, role: run1.role, model: run1.model });
    console.log(`${run}: ${o.result}`);
  } else die("usage: see the header of lib/ledger.mjs");
}

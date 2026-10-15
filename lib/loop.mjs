// The review and fix loop. Review a run's branch once, rerun every finding's reproduction on the branch
// with the existing tests next to the change, send what is proven back to the worker, and recheck the
// fix with the same reviewer, until nothing blocks. Deterministic: models only review and fix; the
// orchestrator gets what code cannot decide (spec questions, serious findings without a reproduction,
// the worker's disputes).
//
// Why this shape (research/workflow.md, 2026-10-14). Lykos T194 took 9 review rounds: every cold review
// found something new (7, 5, 4, 2, 1, then 11 in a final full review), and a fix could break an earlier
// fix unnoticed. Repeated reviews of the same change add false findings (arXiv 2603.16244: one pass F1
// 0.376, more passes at most 0.303); repair in one session decays after 2-3 tries; fresh attempts
// filtered by tests beat further repair (OpenHands critic, Trae Agent, CodeMonkeys).
//
// Rounds. First: both axes review the whole change, once. After a fix: the same reviewer sessions are
// resumed on the fix (`continue --at`), told to check the fix's own diff; the standards reviewer only
// when one of its findings was sent. No final full review. Routing of a round's findings:
//   regression (category) whose reproduction fails on the branch and passes on the base -> blocks
//   reproduction fails on the branch     -> blocks if critical/high/medium with a `basis` (the clause it
//                                           defends); without one, advice; low: a merge note
//   reproduction passes on the branch    -> dropped, labelled review_false_positive
//   after round 1, a finding in a file the fix did not touch, with no failing reproduction -> merge note
//   spec_question                        -> stop: next answer_spec
//   no reproduction, CONFIRMED critical/high logic, edge case, security or requirement -> stop: triage
//   no reproduction, other medium+       -> sent with the next fix, never blocks (one advice-only fix)
//   everything else                      -> merge note (lows go with the next fix as optional)
// Every proven reproduction joins the proof suite: rerun every round until the loop ends, so a later fix
// that breaks an earlier one reopens it. The tests next to the change: a test that fails on the branch
// and not on the base is a regression (names compared, so a base that already fails hides nothing).
// The fixer gets the proof suite and the neighbour command and must run them green before it ends.
// Stall (an item still failing after LOOP_STUCK fixes, a regression or re-broken fix after 1, serious
// items after LOOP_SOFT_ROUNDS fix rounds, LOOP_MAX_FIXES fix rounds, or a fix that fails its own
// tests): once per loop, fresh attempts by LOOP_FRESH roles run in parallel from the base with the task
// and the proof suite; the ones passing their tests, the proofs and the neighbours are kept, a selector
// (LOOP_SELECTOR) picks between equals, and the pick gets a full review. A second stall, or
// LOOP_MAX_ROUNDS reviews: decide.
//
// Reviewers: the project's review mode (lib/reviewmode.mjs). split: review-spec and review-std; both:
// one review-both, which then rechecks every fix alone. --review-mode or --roles override it, at the
// start or on a resume (then the next review is cold, with the new reviewers).
//
//   node lib/loop.mjs <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2] [--no-spec]
//                     [--review-mode split|both] [--roles a,b] [--fresh ROLES|none] [--max-fixes N]
//   node lib/loop.mjs resume <repo> <loop> [--answer TEXT|@FILE] [--drop ID,ID] [--add FILE] [-m TEXT|@FILE] [--max-rounds N]
//                     [--review-mode split|both] [--roles a,b] [--fresh ROLES|none] [--max-fixes N]
//   Prints JSON: {loop, last, next, reason, open, notes, rounds, escalations}
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { project, conf, testFileCmd } from "./ticket.mjs";
import { append, readMeta, readAll } from "./ledger.mjs";
import { readJson } from "./checks.mjs";
import { validRepro, neighbourTests, verifyFiles, parseVerify, suiteFiles, parseSuite, checkTimes, FAIL_REGEX } from "./verify.mjs";
import { reviewRoles, axisOf, roleOfAxis } from "./reviewmode.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERIOUS = new Set(["critical", "high"]);
const BLOCKING = new Set(["critical", "high", "medium"]);
const BEHAVIOUR = new Set(["logic", "edge_case", "security", "requirement"]);
const sev = (f) => String(f.severity ?? "").toLowerCase();
const isConfirmed = (f) => String(f.confidence).toUpperCase() === "CONFIRMED";
const hasBasis = (f) => typeof f.basis === "string" && f.basis.trim() !== "";
export { axisOf };

export function settings(P) {
  const n = (k, d) => { const v = Number(conf(k, P)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { maxRounds: n("LOOP_MAX_ROUNDS", 4), maxFixes: n("LOOP_MAX_FIXES", 3), stuck: n("LOOP_STUCK", 2),
    softRounds: n("LOOP_SOFT_ROUNDS", 2), neighbours: n("LOOP_NEIGHBOURS", 30), recheckSteps: n("LOOP_RECHECK_STEPS", 40),
    fresh: (conf("LOOP_FRESH", P) || "implement implement-hard").split(/\s+/).filter(Boolean),
    selector: conf("LOOP_SELECTOR", P) || "advise-alt",
    sources: conf("NEIGHBOUR_SOURCES", P) || null, failRegex: conf("FAIL_REGEX", P) || null,
    recheckAvoid: conf("LOOP_RECHECK_AVOID", P) ?? "opus",
    reviewMode: conf("REVIEW_MODE", P) || "split", reviewRoles: conf("REVIEW_ROLES", P) || null,
    baseSuite: conf("LOOP_BASE_SUITE", P) !== "0", suiteCmd: conf("BASE_SUITE_CMD", P) || conf("TEST_CMD", P) || "npm test" };
}

// The orchestrator's choices on a loop, at the start or on a resume, as settings. Throws on a bad mode.
// --roles wins over --review-mode; --fresh none: no fresh attempts, a stall stops for the orchestrator.
export function overrides(o = {}) {
  const x = {};
  if (o.maxRounds) x.maxRounds = Number(o.maxRounds);
  if (o.maxFixes) x.maxFixes = Number(o.maxFixes);
  if (o.fresh !== undefined) x.fresh = o.fresh === "none" ? [] : String(o.fresh).split(/[\s,]+/).filter(Boolean);
  if (o.roles) x.reviewRoles = reviewRoles({ roles: o.roles }).join(",");
  else if (o.reviewMode) { reviewRoles({ mode: o.reviewMode }); x.reviewMode = o.reviewMode; x.reviewRoles = null; }
  return x;
}
// The reviewers a cold review uses, from the settings.
export const loopRoles = (cfg) => reviewRoles({ listed: cfg.reviewRoles, defaultMode: cfg.reviewMode });
// The reviewer of a cold review of a fix: review-both when it reviews, else review-spec when it does,
// else the first.
export function fixReviewer(roles) {
  return roles.find((r) => r === "review-both") ?? roles.find((r) => r === "review-spec") ?? roles[0];
}

// A finding's file as the diff names it.
const rel = (f) => String(f ?? "").replace(/^\/work\/repo\//, "").replace(/^\.\//, "");

// One round's new findings, sorted by what the harness saw. repro[id]: the reproduction's exit on the
// branch (undefined: not rerun); reproBase[id]: on the base. touched: the files the last fix changed
// (null in a first review: everything is in scope).
export function classify(findings, repro = {}, { touched = null, reproBase = {} } = {}) {
  const out = { blocking: [], notes: [], dropped: [], questions: [], queue: [], advice: [], outside: [] };
  for (const f of findings) {
    const exit = validRepro(f.repro) ? repro[f.id] : undefined;
    const failing = exit !== undefined && exit !== 0;
    const inScope = !touched || !f.file || touched.includes(rel(f.file));
    if (f.category === "regression" && failing && reproBase[f.id] !== undefined) {
      (reproBase[f.id] === 0 ? out.blocking : out.notes).push(f);   // failing on the base too: it was there before
    } else if (f.category === "spec_question") (inScope ? out.questions : out.outside).push(f);
    else if (failing) (!BLOCKING.has(sev(f)) ? out.notes : hasBasis(f) ? out.blocking : out.advice).push(f);
    else if (exit === 0) out.dropped.push(f);
    else if (!inScope) out.outside.push(f);
    else if (isConfirmed(f) && SERIOUS.has(sev(f)) && BEHAVIOUR.has(f.category)) out.queue.push(f);
    else if (BLOCKING.has(sev(f)) && (isConfirmed(f) || !BEHAVIOUR.has(f.category))) out.advice.push(f);
    else out.notes.push(f);
  }
  return out;
}

// The next step after a round. Pure. x: {round, open: [{id, severity, survived, regression?, broke?}],
// questions, queue, disputes, advice (counts), adviceUsed, fixesTotal, fixesByTier, freshUsed}.
export function decide(x, o) {
  if (x.questions) return { action: "stop", next: "answer_spec", reason: `${x.questions} spec questions for the orchestrator` };
  if (x.queue || x.disputes) return { action: "stop", next: "triage", reason: `${x.queue} serious findings without a reproduction, ${x.disputes} disputed by the worker` };
  if (!x.open.length) {
    if (x.advice && !x.adviceUsed) {
      return x.round >= o.maxRounds ? { action: "stop", next: "decide", reason: `${x.round} review rounds: ${x.advice} findings no test shows are left` }
        : { action: "fix", reason: `${x.advice} findings to fix that no test shows` };
    }
    return { action: "approve", reason: x.fixesTotal === 0 ? "the first review found nothing that blocks" : "the recheck found nothing that blocks" };
  }
  if (x.round >= o.maxRounds) return { action: "stop", next: "decide", reason: `${x.round} review rounds and ${x.open.length} items still open` };
  const stuck = x.open.filter((f) => f.survived >= (f.regression || f.broke ? 1 : o.stuck));
  let why = null;
  if (stuck.length) why = `${stuck.map((f) => f.id).join(", ")} still failing after ${o.stuck} fixes (a regression or a re-broken fix after 1)`;
  else if (x.fixesByTier >= o.softRounds && x.open.some((f) => SERIOUS.has(sev(f)))) why = `serious items still open after ${x.fixesByTier} fix rounds`;
  else if (x.fixesTotal >= o.maxFixes) why = `${x.open.length} items open after ${x.fixesTotal} fix rounds`;
  if (why) return x.freshUsed ? { action: "stop", next: "decide", reason: `${why}; no fresh attempt left (used, or --fresh none)` } : { action: "fresh", reason: why };
  return { action: "fix", reason: `${x.open.length} items open` };
}

// The loop's progress, one JSON line per step, finding and decision: lib/loopwatch.mjs shows it live
// (delegate.sh loop-watch, and a herdr tab of its own when herdr runs).
const sayTo = (dir) => (ev, x = {}) => fs.appendFileSync(path.join(dir, "progress.jsonl"), `${JSON.stringify({ t: Date.now(), ev, ...x })}\n`);
// herdr: the loop's own tab, next to the tabs of the runs it starts. Nothing when herdr is off.
const openTab = (P, name) => spawnSync("bash", [path.join(BOX, "delegate.sh"), "loop-tab", P.repo, name], { stdio: "ignore" });

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s);
const where = (f) => `\`${f.file ?? "?"}${f.line ? `:${f.line}` : ""}\``;

// What a cold fix review is told about the fix it reviews (only when no reviewer session can be resumed).
export function fixContext(items) {
  return ["## What the last fix was for", "",
    "The worker was asked to fix these. The harness reruns their reproductions itself, so do not report",
    "them again just because they were listed. Review the fix's own diff: is it correct and complete, and",
    "what did it break? Report a listed problem again only if the fix plainly did not address it.", "",
    ...items.map((f) => `- \`${f.id}\` (${f.severity}): ${f.issue}. Where: ${where(f)}`), ""].join("\n");
}

// Which round-1 reviewer sessions recheck a fix. Each gets the same message listing everything sent, so
// one session covers every finding. The spec reviewer, plus the standards reviewer when one of its
// findings was sent; but a session whose model matches `avoid` (LOOP_RECHECK_AVOID, default "opus":
// the scarce quota) is left out while another session can do it. Only Opus sessions: as before.
export function recheckAxes(reviewers, sent, modelOf, avoid = "") {
  // One reviewer for both axes: it rechecks everything, whatever its model.
  if (reviewers.both) return ["both"];
  const want = ["spec", ...(sent.some((f) => f.axis === "std") ? ["std"] : [])].filter((a) => reviewers[a]);
  if (!avoid) return want;
  const re = new RegExp(avoid, "i"), ok = (a) => !re.test(modelOf(a));
  const cheap = want.filter(ok);
  if (cheap.length) return cheap;
  const other = ["spec", "std"].filter((a) => reviewers[a] && ok(a));
  return other.length ? other.slice(0, 1) : want;
}

// What a resumed reviewer is told: the fix's range, what was sent, and the scope rule.
export function recheckMessage(k, sent, prevSha, rulings = []) {
  return [`# Round ${k}: recheck the fix`, "",
    `The worker changed the code after your review; the fix is checked out. Its diff: \`git diff ${prevSha}..HEAD\`.`,
    "Do not start a new full review.", "",
    "1. The harness reruns every reproduction itself (yours and earlier ones). For a listed item without a",
    "   reproduction, report it again only if the fix plainly did not address it.",
    "2. Review the fix's own diff: what it got wrong, left incomplete or broke. A broken behaviour that",
    "   worked before is category `regression`, with a reproduction.",
    "3. Code the fix did not touch: report nothing unless it is critical.", "",
    ...(sent.length ? ["What the fix was for:", "", ...sent.map((f) => `- \`${f.id}\` (${f.severity}): ${f.issue}. Where: ${where(f)}`), ""] : []),
    ...(rulings.length ? ["The orchestrator's rulings, binding:", "", ...rulings.map((r, i) => `${i + 1}. ${r}`), ""] : []),
    "End with the agent-box-findings block as before (`[]` when nothing blocks)."].join("\n");
}

// The message a fix round sends: proven failures with their reproductions, regressions, advice, the
// optional lows, the proof suite the worker must run green, and anything the orchestrator added.
// o: {lows, proofs (fixed earlier: kept green), neighbours: {cmd, baseFails}}.
export function fixMessage(k, open, advice, extra = [], o = {}) {
  const out = [`# Review round ${k}: fix these`, ""];
  const findings = open.filter((x) => !x.regression);
  if (findings.length) {
    out.push("The harness reran each reviewer's reproduction on your branch and it failed, so each is a real",
      "failure. Fix the cause in the code, never by weakening a test. Add each reproduction to the repo as a",
      "test where it fits; the harness reruns its own copy after you. If you are sure a finding is wrong,",
      "change nothing for it and list its id under `disputes` in your report block: the orchestrator decides.", "");
    for (const x of findings) {
      const f = x.finding;
      const note = x.broke ? " - fixed earlier, broken again" : x.survived ? ` - still failing after ${x.survived} fix${x.survived > 1 ? "es" : ""}` : "";
      out.push(`## ${x.id}: ${f.issue} (${f.severity}, ${f.category ?? "?"})${note}`, "",
        `- Where: ${where(f)}`, `- Fails when: ${f.scenario ?? "(not given)"}`, `- Reproduction, run from the repo root: \`${f.repro.cmd}\`, file \`${f.repro.file}\`:`, "",
        "```", clip(f.repro.content, 4000), "```", "");
    }
  }
  for (const x of open.filter((y) => y.regression)) {
    out.push("## Regression: the tests next to your change fail", "",
      `\`${x.cmd}\` fails on your branch${x.newFails?.length ? ` in tests that pass on the base: ${x.newFails.map((n) => `\`${n}\``).join(", ")}` : " and passes on the base"}. Last lines:`,
      "", "```", clip(x.tail ?? "", 4000), "```", "");
  }
  if (advice.length) {
    out.push("## Also fix (no test shows these: docs, tests, standards)", "",
      ...advice.map((f) => `- \`${f.id}\` ${f.issue} (${f.severity}, ${f.category ?? "?"}). Where: ${where(f)}. ${f.scenario ?? ""}`), "");
  }
  if (o.lows?.length) {
    out.push("## Low (fix these too if each is small and inside the code this task changes; otherwise leave them)", "",
      ...o.lows.map((f) => `- \`${f.id}\` ${f.issue}. Where: ${where(f)}`), "");
  }
  for (const e of extra) out.push(e.trim(), "");
  if (findings.length || o.proofs?.length || o.neighbours?.cmd) {
    out.push("## Before you end: prove it", "",
      "Run these yourself after your last edit and make them pass; the harness reruns them and sends back any that fail.",
      "While you fix, run only the one reproduction or test you are working on; run this whole list once, at the end.");
    if (findings.length) out.push("- Every reproduction above: write its file to its path, then run its command.");
    for (const p of o.proofs ?? []) {
      out.push(`- \`${p.id}\` (fixed earlier, keep it passing): \`${p.cmd}\`, file \`${p.file}\`:`, "", "```", clip(p.content, 2000), "```");
    }
    if (o.neighbours?.cmd) {
      out.push(`- The tests next to your change: \`${o.neighbours.cmd}\`.${o.neighbours.baseFails?.length ? ` These already fail on the base; ignore them: ${o.neighbours.baseFails.map((n) => `\`${n}\``).join(", ")}.` : ""}`);
    }
    out.push("");
  }
  out.push("Commit, rerun the test command, and end with the report block again.");
  return out.join("\n");
}

// The task for a fresh attempt: the original task, the rulings, and every proof the earlier attempts
// were held to. No earlier diff: a fresh start is the point.
export function freshTask(task, reason, rulings, proofs) {
  return [task.trimEnd(), "", "## Earlier attempts",
    "", `Earlier workers changed this code and kept failing (${reason}). You start from the base, without their changes.`, "",
    ...(rulings.length ? ["The orchestrator's rulings, binding:", "", ...rulings.map((r, i) => `${i + 1}. ${r}`), ""] : []),
    ...(proofs.length ? ["## Every one of these must pass when you finish", "",
      "Each is a reproduction of a real failure the earlier attempts had. Write its file to its path and run its command from the repo root before you end.", "",
      ...proofs.flatMap((p) => [`### ${p.id}: ${p.finding?.issue ?? ""}`, "", `\`${p.cmd}\`, file \`${p.file}\`:`, "", "```", clip(p.content, 4000), "```", ""])] : [])].join("\n");
}

function runDelegate(args, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, "w");
    const p = spawn("bash", [path.join(BOX, "delegate.sh"), ...args], { stdio: ["ignore", out, out] });
    p.on("close", (code) => { fs.closeSync(out); resolve(code); });
  });
}
const gitOut = (repo, ...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }); } catch { return ""; } };

export async function loop(P, start, o = {}, deps = {}) {
  const cfg = { ...settings(P), ...overrides(o) };
  if (!readJson(path.join(P.runs, start, "summary.json"))) throw new Error(`no run ${start} in ${P.runs}`);
  const m = readMeta(path.join(P.runs, start, "meta.sh"));
  // The spec first: without a sealed test that fails on the base, reviewers become the spec and every
  // round finds a new requirement (T194: 9 rounds).
  if (!m.SEALED && !o.noSpec) throw new Error(`${start} has no sealed acceptance test: write one that fails on the base (task frontmatter \`sealed:\`) and rerun, or pass --no-spec`);
  let name = o.name || `loop-${start}`;
  for (let i = 2; fs.existsSync(path.join(P.runs, "_loops", name)); i++) name = `${o.name || `loop-${start}`}-${i}`;
  fs.mkdirSync(path.join(P.runs, "_loops", name), { recursive: true });
  const base = readJson(path.join(P.runs, start, "summary.json")).base;
  const st = { loop: name, start, base, specs: o.specs ?? [], settings: cfg, run: start, noSpec: !!o.noSpec,
    tier: m.ROLE || cfg.fresh[0], kind: "first", prevRun: null, fixesTotal: 0, fixesByTier: 0, adviceUsed: false, freshUsed: false,
    open: [], notes: [], lows: [], proofs: {}, fixedProofs: [], reviewers: {}, baseCache: null,
    rulings: [], rounds: [], escalations: [], disputes: [] };
  sayTo(path.join(P.runs, "_loops", name))("start", { loop: name, run: start, tier: st.tier, model: readJson(path.join(P.runs, start, "summary.json")).model ?? null, settings: cfg });
  deps.openTab?.(P, name);
  return drive(P, st, { phase: "review", reviews: o.reviews }, deps);
}

// The orchestrator's decisions on a stopped loop, then on with a fix round.
export async function resume(P, name, o = {}, deps = {}) {
  const file = path.join(P.runs, "_loops", name, "state.json");
  const st = readJson(file);
  if (!st) throw new Error(`no loop ${name} in ${P.runs}/_loops`);
  const record = deps.record ?? append;
  const last = st.rounds.at(-1);
  const drop = new Set(o.drop ?? []);
  for (const id of drop) {
    const f = st.open.find((x) => x.id === id)?.finding ?? last?.findings.find((x) => x.id === id);
    if (f?.review) label(P, record, deps.readAll ?? readAll, f, "review_false_positive", "orchestrator", "Dropped by the orchestrator.");
  }
  st.open = st.open.filter((x) => !drop.has(x.id));
  if (st.proofs) for (const id of drop) delete st.proofs[id];
  const extra = [];
  if (o.answer) { st.rulings.push(o.answer); extra.push(`## The orchestrator's ruling\n\n${o.answer}`); }
  const x = overrides(o);
  // New reviewers: the next review is cold, so the old sessions do not recheck in their place.
  if ("reviewRoles" in x && (x.reviewRoles !== (st.settings.reviewRoles ?? null) || (x.reviewMode && x.reviewMode !== st.settings.reviewMode))) st.reviewers = {};
  Object.assign(st.settings, x);
  // Serious findings without a reproduction, and unanswered spec questions, that were not dropped:
  // the orchestrator keeps them for the worker.
  const kept = [...(last?.queue ?? []), ...(o.answer ? [] : last?.questions ?? [])].filter((id) => !drop.has(id))
    .map((id) => last.findings.find((f) => f.id === id)).filter(Boolean);
  if (kept.length) extra.push(["## Also fix (the orchestrator checked these)", "", ...kept.map((f) => `- \`${f.id}\` ${f.issue} (${f.severity}). Where: ${where(f)}. ${f.scenario ?? ""}`)].join("\n"));
  const disputed = st.disputes.filter((d) => !drop.has(d.finding) && st.open.some((x) => x.id === d.finding));
  if (disputed.length) extra.push(`## Your disputes\n\nThe orchestrator checked them and keeps ${disputed.map((d) => `\`${d.finding}\``).join(", ")}: fix them.`);
  if (o.add) extra.push(`## From the orchestrator\n\n${o.add}`);
  if (o.message) extra.push(o.message);
  st.disputes = [];
  if (last) { last.queue = []; last.questions = []; }
  st.resumed = (st.resumed ?? 0) + 1;
  sayTo(path.dirname(file))("resume", { answer: !!o.answer, drop: [...drop], add: !!o.add, message: !!o.message, maxRounds: o.maxRounds ? Number(o.maxRounds) : null, ...x });
  deps.openTab?.(P, name);
  const advice = (last?.advice ?? []).filter((id) => !drop.has(id)).map((id) => last.findings.find((f) => f.id === id)).filter(Boolean);
  // A round that stopped before its review or check finished is run again: never decided without it.
  if (st.redo) { const phase = st.redo; delete st.redo; return drive(P, st, { phase, extra, advice }, deps); }
  if (st.blockedRun) {
    const run = st.blockedRun; delete st.blockedRun;
    return drive(P, st, { phase: "answer", run, extra }, deps);
  }
  return drive(P, st, extra.length ? { phase: "fix", extra, advice } : { phase: "decide", advice }, deps);
}

function label(P, record, readAllFn, f, cause, source, why) {
  const id = readAllFn().filter((e) => e.type === "review" && e.project === P.name && e.run === f.review).at(-1)?.id;
  if (id) record("label", { refs: [`${id}#${f.n}`], cause, source, why }, { project: P.name, run: f.review });
}

async function drive(P, st, entry, deps) {
  const { delegate = runDelegate, record = append, readAll: readAllFn = readAll, neighbours = neighbourTests, baseSuite = (run) => run() } = deps;
  const cfg = st.settings = { ...settings(P), ...st.settings }, name = st.loop, dir = path.join(P.runs, "_loops", name);
  Object.assign(st, { lows: st.lows ?? [], proofs: st.proofs ?? {}, fixedProofs: st.fixedProofs ?? [], reviewers: st.reviewers ?? {} });
  const summary = (run) => readJson(path.join(P.runs, run, "summary.json"));
  const meta = (run) => readMeta(path.join(P.runs, run, "meta.sh"));
  const save = () => fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(st, null, 2));
  const say = sayTo(dir);
  const out = (next, reason, redo = null) => {
    if (redo) st.redo = redo; else delete st.redo;
    st.next = next; st.reason = reason; st.last = st.run; save(); say("end", { next, reason, last: st.run, open: st.open.length }); return st;
  };
  // A run name not used yet: a round run again after a resume gets b, c, ...
  const unused = (n) => {
    const taken = (x) => fs.existsSync(path.join(P.runs, x)) || fs.readdirSync(P.runs).some((r) => r.startsWith(`${x}-review`));
    let x = n; for (const s of "bcdefgh") { if (!taken(x)) break; x = `${n}${s}`; } return x;
  };
  // The base by its ref while it still points there: launch bundles a ref, and a bare commit may not
  // be in what it bundles instead.
  const baseRef = () => {
    const m = meta(st.start);
    return m.RUN_BASE_REF && gitOut(P.repo, "rev-parse", "--verify", `${m.RUN_BASE_REF}^{commit}`).trim() === st.base ? m.RUN_BASE_REF : st.base;
  };
  // The base's whole suite, once per base commit (runs/<project>/.basecache/<sha>.json), started beside
  // the first review. A check then runs its neighbour tests on the branch only and compares failing
  // names against it. null (no cache, a crash, no names): the check runs the base itself, as before.
  const suiteNow = async () => {
    const regex = cfg.failRegex || FAIL_REGEX, file = path.join(P.runs, ".basecache", `${st.base}.json`);
    const c = readJson(file);
    if (c && c.cmd === cfg.suiteCmd && c.regex === regex) return c;
    const run = unused(`${name}-basesuite`), hidden = path.join(dir, "basesuite");
    for (const [r, text] of Object.entries(suiteFiles({ cmd: cfg.suiteCmd, failRegex: regex }))) {
      fs.mkdirSync(path.dirname(path.join(hidden, r)), { recursive: true });
      fs.writeFileSync(path.join(hidden, r), text);
    }
    say("step", { what: "basesuite", run, cmd: cfg.suiteCmd });
    await delegate(["check", P.repo, baseRef(), "--test", "bash .agent-box-verify/run.sh", "--hidden", hidden, "--name", run], path.join(dir, "basesuite.log"));
    let log = ""; try { log = fs.readFileSync(path.join(P.runs, run, "test.log"), "utf8"); } catch { /* none */ }
    const r = parseSuite(log);
    say("done", { what: "basesuite", run, exit: r?.exit ?? null, fails: r?.fails.length ?? null, seconds: checkTimes(log).suite ?? null });
    if (!r) return null;
    const res = { cmd: cfg.suiteCmd, regex, ...r, run, seconds: checkTimes(log).suite ?? null };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(res, null, 2));
    return res;
  };
  let suiteP = null;
  const suite = () => (suiteP ??= cfg.baseSuite ? baseSuite(suiteNow).catch(() => null) : Promise.resolve(null));
  suite();
  const rulingsFile = () => {
    if (!st.rulings.length) return null;
    const f = path.join(dir, "rulings.md");
    fs.writeFileSync(f, ["# The orchestrator's rulings on this task", "", ...st.rulings.map((r, i) => `${i + 1}. ${r}`), ""].join("\n"));
    return f;
  };
  // One check container: reproductions (some also on the base) and the tests next to the change. The
  // base's result for the same test files is kept, so later rounds do not run the base again.
  const runCheck = async (checkName, branch, repros, baseRepros, k) => {
    const tests = neighbours(P.repo, st.base, `agent/${branch}`, P.testGlobs ?? [], cfg.neighbours, ...(cfg.sources ? [cfg.sources] : []));
    const ncmd = tests.length ? testFileCmd(P, tests) : null;
    if (!repros.length && !ncmd) return { verify: { repro: {}, reproBase: {}, neighbours: null }, tests, ncmd, check: null };
    const key = tests.join("\n");
    let known = st.baseCache?.key === key ? st.baseCache : null;
    if (!known && ncmd) { const s = await suite(); if (s) known = { exit: s.exit, fails: s.fails }; }
    const short = checkName.slice(name.length + 1), hidden = path.join(dir, short);
    for (const [r, text] of Object.entries(verifyFiles({ repros, baseRepros, neighboursCmd: ncmd, base: st.base, baseKnown: !!known, ...(cfg.failRegex ? { failRegex: cfg.failRegex } : {}) }))) {
      fs.mkdirSync(path.dirname(path.join(hidden, r)), { recursive: true });
      fs.writeFileSync(path.join(hidden, r), text);
    }
    say("step", { k, what: "check", run: checkName, repros: repros.length, neighbours: tests.length });
    await delegate(["check", P.repo, `agent/${branch}`, "--test", "bash .agent-box-verify/run.sh", "--hidden", hidden, "--name", checkName], path.join(dir, `${short}.log`));
    let log = null; try { log = fs.readFileSync(path.join(P.runs, checkName, "test.log"), "utf8"); } catch { /* none */ }
    if (log === null) return null;
    const verify = parseVerify(log, known);
    const n = verify.neighbours;
    if (n && !known && n.base_exit !== null) st.baseCache = { key, exit: n.base_exit, fails: n.base_fails ?? [] };
    say("done", { what: "check", run: checkName, repro: verify.repro, neighbours: n && { exit: n.exit, base_exit: n.base_exit, regression: n.regression, new_fails: n.new_fails }, seconds: checkTimes(log) });
    return { verify, tests, ncmd, check: checkName };
  };
  const proofList = () => Object.values(st.proofs);
  // No fresh attempt left: used once already, or turned off with --fresh none.
  const noFresh = () => st.freshUsed || !cfg.fresh.length;
  let phase = entry.phase, given = entry.reviews, extra = entry.extra ?? [], advice = entry.advice ?? [];
  let d = null;

  if (phase === "answer") {
    // A BLOCKED fix round: the same worker gets the answer in its own session.
    const ans = `${name}-answer${st.rounds.length}-${st.resumed}`;
    const msg = path.join(dir, `${ans}.md`);
    fs.writeFileSync(msg, extra.join("\n\n"));
    say("step", { k: st.rounds.length, what: "answer", run: ans, from: entry.run });
    await delegate(["continue", P.repo, entry.run, "-f", msg, "--name", ans], path.join(dir, `${ans}.log`));
    const s = summary(ans);
    say("done", { what: "answer", run: ans, verdict: s?.verdict ?? null, model: s?.model ?? null });
    if (s?.verdict !== "pass") return out(s?.next ?? "fix_environment", `answered round ${ans} ended ${s?.verdict ?? "with no summary"}`);
    st.prevRun = st.run; st.run = ans; st.kind = "fix"; st.fixesTotal++; st.fixesByTier++;
    phase = "review";
  }

  for (;;) {
    if (phase === "review") {
      const k = st.rounds.length + 1;
      say("round", { k, kind: st.kind, run: st.run, tier: st.tier, model: summary(st.run)?.model ?? null });
      // The files the fix changed; unknown (git fails or shows nothing): everything stays in scope.
      const touched = st.kind === "fix" && st.prevRun ? gitOut(P.repo, "diff", "--name-only", `agent/${st.prevRun}`, `agent/${st.run}`).split("\n").filter(Boolean) : [];
      const scope = touched.length ? touched : null;
      // 1. Review: round 1 is the only full review; after a fix, the same reviewers recheck it.
      let reviews;
      const sent = st.lastSent ?? [];
      const axes = st.kind === "fix" && st.prevRun ? recheckAxes(st.reviewers, sent, (a) => summary(st.reviewers[a])?.model ?? meta(st.reviewers[a]).MODEL ?? "", cfg.recheckAvoid) : [];
      if (given) { reviews = given; given = null; say("step", { k, what: "review", runs: reviews }); }
      if (!reviews && axes.length) {
        const prevSha = gitOut(P.repo, "rev-parse", `agent/${st.prevRun}`).trim() || `agent/${st.prevRun}`;
        const msg = path.join(dir, `recheck-${k}.md`);
        fs.writeFileSync(msg, recheckMessage(k, sent, prevSha, st.rulings));
        const runs = axes.map((a) => unused(`${name}-rv${k}-${meta(st.reviewers[a]).ROLE || roleOfAxis(a)}`));
        say("step", { k, what: "review", runs, against: st.prevRun, resumed: true });
        await Promise.all(axes.map((a, i) => delegate(["continue", P.repo, st.reviewers[a], "--at", `agent/${st.run}`, "-f", msg, "--name", runs[i], "--steps", String(cfg.recheckSteps)],
          path.join(dir, `review-${k}-${a}.log`))));
        reviews = runs.filter((r) => fs.existsSync(path.join(P.runs, r, "summary.json")));
        // A session that cannot be resumed (no saved session data): a cold review of the fix instead.
        if (!reviews.length) { st.reviewers = {}; reviews = null; }
      }
      if (!reviews) {
        const prefix = unused(`${name}-rv${k}`);
        const args = ["review", P.repo, `agent/${st.run}`, "--name", prefix];
        for (const s of st.specs) args.push("--spec", s);
        const rf = rulingsFile(); if (rf) args.push("--spec", rf);
        let roles = loopRoles(cfg);
        if (st.kind === "fix" && st.prevRun) {
          // No reviewer session to resume (a loop started from given reviews, or new reviewers): a cold
          // review of the fix, by one reviewer.
          roles = [fixReviewer(roles)];
          args.push("--against", `agent/${st.prevRun}`);
          if (sent.length) { const f = path.join(dir, `fixctx-${k}.md`); fs.writeFileSync(f, fixContext(sent)); args.push("--prior", `${axisOf(roles[0])}=${f}`); }
        }
        args.push("--roles", roles.join(","));
        say("step", { k, what: "review", runs: roles.map((r) => `${prefix}-${r}`), against: st.kind === "fix" ? st.prevRun : null });
        await delegate(args, path.join(dir, `review-${k}.log`));
        reviews = fs.readdirSync(P.runs).filter((x) => x.startsWith(`${prefix}-review`));
      }
      if (!reviews.length) return out("fix_environment", `round ${k}: no review run started`, "review");
      const findings = [];
      for (const rv of reviews) {
        const s = summary(rv), f = readJson(path.join(P.runs, rv, "findings.json"));
        if (!s || !Array.isArray(f)) return out(!s || s.next === "fix_environment" ? "fix_environment" : "read_final_message", `review ${rv} gave no readable findings`, "review");
        const axis = axisOf(meta(rv).ROLE);
        st.reviewers[axis] = rv;
        f.forEach((x, i) => findings.push({ ...x, id: `${k}.${axis}.${i + 1}`, axis, review: rv, n: i + 1 }));
      }
      say("done", { what: "review", runs: reviews, findings: findings.length });

      // 2. Check: new reproductions, the whole proof suite, and the tests next to the change.
      const newRepros = findings.filter((f) => validRepro(f.repro)).map((f) => ({ id: f.id, file: f.repro.file, content: f.repro.content, cmd: f.repro.cmd }));
      const repros = [...newRepros, ...proofList().filter((p) => !newRepros.some((r) => r.id === p.id)).map(({ id, file, content, cmd }) => ({ id, file, content, cmd }))];
      const baseRepros = findings.filter((f) => f.category === "regression" && validRepro(f.repro)).map((f) => f.id);
      const ck = await runCheck(`${name}-check${k}`, st.run, repros, baseRepros, k);
      if (!ck) return out("fix_environment", `check ${name}-check${k} produced no test log`, "review");
      const { verify, tests, ncmd, check } = ck;
      // Only the base failures this run also hit: the whole suite's list would bury the fixer.
      const baseFails = verify.neighbours?.base_fails ?? st.baseCache?.fails ?? [];
      st.lastNeighbours = ncmd ? { cmd: ncmd, baseFails: verify.neighbours?.fails ? baseFails.filter((x) => verify.neighbours.fails.includes(x)) : baseFails } : null;

      // 3. What is still open, what is new, what is fixed, what broke again.
      const fixed = [], broke = [];
      const prevReg = st.open.find((x) => x.regression);
      st.open = st.open.flatMap((x) => {
        if (x.regression) return [];          // re-added below from this round's run
        const e = verify.repro[x.id];
        if (e === 0) { fixed.push(x.id); if (st.proofs[x.id]) st.fixedProofs.push(x.id); return []; }
        return [{ ...x, survived: x.survived + (e === undefined ? 0 : 1) }];
      });
      for (const id of st.fixedProofs.filter((i) => !fixed.includes(i))) {
        const e = verify.repro[id];
        if (e === undefined || e === 0) continue;
        st.fixedProofs = st.fixedProofs.filter((i) => i !== id);
        st.open.push({ id, severity: st.proofs[id].finding?.severity ?? "high", survived: 0, broke: true, finding: st.proofs[id].finding });
        broke.push(id);
      }
      let regression = null;
      if (verify.neighbours?.regression) {
        regression = { id: "regression", severity: "high", regression: true, cmd: ncmd, tail: verify.neighbours.tail, newFails: verify.neighbours.new_fails ?? [], survived: prevReg ? prevReg.survived + 1 : 0 };
        st.open.push(regression);
      }
      const c = classify(findings, verify.repro, { touched: scope, reproBase: verify.reproBase });
      for (const f of c.blocking) {
        st.open.push({ id: f.id, severity: f.severity, survived: 0, finding: f });
        st.proofs[f.id] = { id: f.id, file: f.repro.file, content: f.repro.content, cmd: f.repro.cmd, finding: f };
        label(P, record, readAllFn, f, "worker_careless", "harness", "Its reproduction failed when the harness reran it on the branch; sent to the worker.");
      }
      for (const f of c.dropped) label(P, record, readAllFn, f, "review_false_positive", "harness", "Its reproduction passed when the harness reran it on the branch.");
      st.notes.push(...[...c.notes, ...c.outside].map((f) => ({ id: f.id, severity: f.severity, issue: f.issue, file: f.file ?? null, ...(c.outside.includes(f) ? { outside: true } : {}) })));
      st.lows = c.notes.filter((f) => sev(f) === "low");
      const disputesOpen = st.disputes.filter((x) => st.open.some((y) => y.id === x.finding));
      st.disputes = disputesOpen;
      const ids = (a) => a.map((f) => f.id);
      st.rounds.push({ k, kind: st.kind, run: st.run, tier: st.tier, model: summary(st.run)?.model ?? null, reviews, check, findings,
        blocking: ids(c.blocking), dropped: ids(c.dropped), questions: ids(c.questions), queue: ids(c.queue), advice: ids(c.advice),
        notes: ids(c.notes), outside: ids(c.outside), fixed, broke, open: st.open.map((x) => x.id), regression: !!regression, neighbours: tests });
      save();
      const route = new Map([["blocking", "proven"], ["dropped", "dropped"], ["questions", "question"], ["queue", "triage"], ["advice", "advice"], ["notes", "note"], ["outside", "outside"]]
        .flatMap(([key, r]) => c[key].map((f) => [f.id, r])));
      say("findings", { k, items: findings.map((f) => ({ id: f.id, severity: f.severity ?? null, category: f.category ?? null, issue: f.issue ?? "", file: f.file ?? null, line: f.line ?? null, route: route.get(f.id), exit: verify.repro[f.id] ?? null })),
        fixed, broke, regression: !!regression, open: st.open.map((x) => ({ id: x.id, severity: x.severity, survived: x.survived })) });
      advice = c.advice;
      d = decide({ round: k, open: st.open, questions: c.questions.length, queue: c.queue.length, disputes: disputesOpen.length,
        advice: c.advice.length, adviceUsed: st.adviceUsed, fixesTotal: st.fixesTotal, fixesByTier: st.fixesByTier, freshUsed: noFresh() }, cfg);
      say("decide", { k, ...d });
      phase = d.action;
    } else if (phase === "decide") {
      const r = st.rounds.at(-1);
      d = decide({ round: r?.k ?? 0, open: st.open, questions: 0, queue: 0, disputes: 0, advice: advice.length, adviceUsed: st.adviceUsed,
        fixesTotal: st.fixesTotal, fixesByTier: st.fixesByTier, freshUsed: noFresh() }, cfg);
      say("decide", { k: r?.k ?? 0, ...d });
      phase = d.action;
    }

    if (phase === "approve") return out("approve", d.reason);
    if (phase === "stop") return out(d.next, d.reason);

    const k = st.rounds.length;
    if (phase === "fix") {
      // 4. Fix: the same worker, its own session, everything open at once, proven before it ends.
      const fix = `${name}-fix${k}${st.resumed ? `-${st.resumed}` : ""}`;
      const msg = path.join(dir, `${fix}.md`);
      const proofs = st.fixedProofs.map((id) => st.proofs[id]).filter(Boolean);
      fs.writeFileSync(msg, fixMessage(k, st.open, advice, extra, { lows: st.lows, proofs, neighbours: st.lastNeighbours }));
      st.lastSent = [...st.open.filter((x) => !x.regression).map((x) => x.finding), ...advice];
      extra = [];
      say("step", { k, what: "fix", run: fix, from: st.run, model: summary(st.run)?.model ?? null, proven: st.open.length, advice: advice.length });
      await delegate(["continue", P.repo, st.run, "-f", msg, "--name", fix], path.join(dir, `${fix}.log`));
      const s = summary(fix);
      say("done", { what: "fix", run: fix, verdict: s?.verdict ?? null, model: s?.model ?? null });
      st.rounds.at(-1).fix = { run: fix, verdict: s?.verdict ?? null };
      st.disputes = (Array.isArray(s?.report?.disputes) ? s.report.disputes : []).filter((x) => x && typeof x.finding === "string");
      save();
      if (s?.verdict === "pass") {
        if (!st.open.length && advice.length) st.adviceUsed = true;
        st.prevRun = st.run; st.run = fix; st.kind = "fix"; st.fixesTotal++; st.fixesByTier++;
        phase = "review"; continue;
      }
      if (s?.verdict === "blocked") { st.blockedRun = fix; return out("answer_question", `fix round ${fix} asks: ${s.blocked}`); }
      if (!s || !["fail", "no_change"].includes(s.verdict)) return out(s?.next ?? "fix_environment", `fix round ${fix} ended ${s?.verdict ?? "with no summary"}`);
      d = { action: "fresh", reason: `fix round ${fix} ended ${s.verdict}` };
      if (noFresh()) return out("decide", `${d.reason}; ${st.freshUsed ? "the fresh attempts were already used" : "fresh attempts are off (--fresh none)"}`);
      say("decide", { k, ...d });
      phase = "fresh";
    }

    if (phase === "fresh") {
      // 5. Fresh attempts in parallel from the base, held to the proof suite; the best one goes on.
      st.freshUsed = true;
      const task = path.join(dir, `fresh-${k}.md`);
      fs.writeFileSync(task, freshTask(fs.readFileSync(path.join(P.runs, st.start, "task.md"), "utf8"), d.reason, st.rulings, proofList()));
      const m = meta(st.start);
      const ref = baseRef();
      const runs = cfg.fresh.map((r) => unused(`${name}-fresh${k}-${r}`));
      say("step", { k, what: "fresh", runs, reason: d.reason });
      await Promise.all(cfg.fresh.map((r, i) => delegate(["run", P.repo, task, "--role", r, "--base", ref, "--name", runs[i], "--no-red",
        ...(m.TEST_CMD ? ["--test", m.TEST_CMD] : [])], path.join(dir, `${runs[i].slice(name.length + 1)}.log`))));
      const verdicts = runs.map((r) => summary(r)?.verdict ?? null);
      say("done", { what: "fresh", runs, verdicts });
      for (const [i, r] of runs.entries()) {
        record("escalate", { from_model: summary(st.run)?.model ?? null, to_model: summary(r)?.model ?? null, at_round: k, reason: d.reason, loop: name, fresh: true },
          { project: P.name, run: r, role: cfg.fresh[i], model: summary(r)?.model ?? null });
      }
      const passed = runs.filter((r, i) => verdicts[i] === "pass");
      st.escalations.push({ after_round: k, from: st.tier, to: "fresh", runs, verdicts, reason: d.reason, chosen: null });
      save();
      if (!passed.length) return out("decide", `${d.reason}; no fresh attempt passed its own tests`);
      const proofs = proofList().map(({ id, file, content, cmd }) => ({ id, file, content, cmd }));
      const checked = await Promise.all(passed.map((r) => runCheck(`${name}-check${k}-${r.slice(name.length + 1)}`, r, proofs, [], k)));
      const scored = passed.map((r, i) => {
        const v = checked[i]?.verify;
        const failing = v ? proofs.filter((p) => v.repro[p.id] !== 0).map((p) => p.id) : proofs.map((p) => p.id);
        const reg = v?.neighbours?.regression ? v.neighbours : null;
        return { run: r, failing, regression: reg, ncmd: checked[i]?.ncmd ?? null, score: (v ? 0 : 99) + failing.length + (reg ? 1 : 0) };
      });
      const best = Math.min(...scored.map((x) => x.score));
      const tied = scored.filter((x) => x.score === best);
      const chosenRun = tied.length > 1 ? await pick(P, st, tied.map((x) => x.run), cfg, delegate, dir, say, k) : tied[0].run;
      const chosen = scored.find((x) => x.run === chosenRun);
      st.escalations.at(-1).chosen = chosen.run;
      say("done", { what: "select", run: chosen.run, from: runs, failing: chosen.failing, regression: !!chosen.regression });
      st.prevRun = null; st.run = chosen.run; st.tier = meta(chosen.run).ROLE || st.tier; st.kind = "first";
      st.fixesByTier = 0; st.reviewers = {}; st.lastSent = []; st.lows = [];
      st.open = chosen.failing.map((id) => ({ id, severity: st.proofs[id].finding?.severity ?? "high", survived: 0, finding: st.proofs[id].finding }));
      st.fixedProofs = Object.keys(st.proofs).filter((id) => !chosen.failing.includes(id));
      if (chosen.regression) st.open.push({ id: "regression", severity: "high", regression: true, cmd: chosen.ncmd, tail: chosen.regression.tail, newFails: chosen.regression.new_fails ?? [], survived: 0 });
      save();
      phase = "review";
    }
  }
}

// Between fresh attempts that pass the same checks: the selector reads the diffs and picks one. If it
// cannot (no answer, its pool down), the smaller diff wins.
async function pick(P, st, runs, cfg, delegate, dir, say, k) {
  const letters = "ABCDEFGH";
  const diffs = runs.map((r) => gitOut(P.repo, "diff", `${st.base}..agent/${r}`));
  const prompt = path.join(dir, `select-${k}.md`);
  let task = ""; try { task = fs.readFileSync(path.join(P.runs, st.start, "task.md"), "utf8"); } catch { /* none */ }
  fs.writeFileSync(prompt, ["Independent attempts at the task below pass the same tests. Pick the one more likely to be correct and",
    "complete for the task, with fewer hidden regressions and less needless change. Answer with one line",
    "`PICK: <letter>`, then at most three lines why.", "", "## The task", "", task.trim(), "",
    ...runs.flatMap((r, i) => [`## Attempt ${letters[i]} (${r})`, "", "```diff", clip(diffs[i], 30000), "```", ""])].join("\n"));
  const log = path.join(dir, `select-${k}.log`);
  say("step", { k, what: "select", runs, run: `select-${k}` });
  await delegate(["ask", P.repo, "--role", cfg.selector, "--prompt", prompt], log);
  let answer = ""; try { answer = fs.readFileSync(log, "utf8"); } catch { /* none */ }
  const m = [...answer.matchAll(/PICK:\s*`?([A-H])\b/g)].at(-1);
  const i = m ? letters.indexOf(m[1]) : -1;
  if (i >= 0 && i < runs.length) return runs[i];
  const size = (s) => s.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).length;
  const sizes = diffs.map(size);
  return runs[sizes.indexOf(Math.min(...sizes))];
}

// The loop's result in a few lines for the orchestrator: what to decide, with each item's text, explicit
// empties, where the rest is. The next line comes last. `--json`: the whole result as before.
export function loopBrief(st, statePath) {
  const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const last = st.rounds.at(-1), byId = new Map((last?.findings ?? []).map((f) => [f.id, f]));
  const item = (id) => { const f = byId.get(id); return f ? `  - ${id} (${f.severity ?? "?"}) ${clip(f.issue, 200)}${f.file ? ` [${f.file}${f.line ? `:${f.line}` : ""}]` : ""}` : `  - ${id}`; };
  const out = [`loop ${st.loop} · ${st.rounds.length} round(s) · last agent/${st.last}`,
    `rounds: ${st.rounds.map((r) => `${r.k} ${r.kind} ${r.blocking.length} blocking${r.fixed?.length ? `, ${r.fixed.length} fixed` : ""}${r.regression ? ", REGRESSION" : ""}`).join(" → ") || "none"}`];
  if (st.settings) { try { out.push(`reviewers: ${loopRoles(st.settings).join(", ")} · max rounds ${st.settings.maxRounds} · fresh ${st.settings.fresh?.join(", ") || "none"}`); } catch { /* an old state */ } }
  const block = (label, xs, line) => { if (xs.length) out.push(`${label} (${xs.length}):`, ...xs.map(line)); };
  block("open", st.open, (x) => `  - ${x.id} (${x.severity ?? "?"}${x.survived ? `, survived ${x.survived}` : ""}) ${clip(x.finding?.issue ?? (x.regression ? "regression in the tests next to the change" : ""), 200)}`);
  block("spec questions", last?.questions ?? [], item);
  block("to triage", last?.queue ?? [], item);
  block("disputes", st.disputes ?? [], (d) => `  - ${d.finding}: ${clip(d.why ?? d.reason ?? JSON.stringify(d), 200)}`);
  if (st.notes?.length) out.push(`notes: ${st.notes.length} → state.json`);
  if (!st.open.length && !(last?.questions ?? []).length && !(last?.queue ?? []).length && !(st.disputes ?? []).length) out.push("open: none");
  out.push(`full: ${statePath} (loop --json prints the whole result)`, `next ${st.next}: ${clip(st.reason, 300)}`);
  return out.join("\n");
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const argv = process.argv.slice(2);
  const isResume = argv[0] === "resume";
  const noSpec = argv.includes("--no-spec"), asJson = argv.includes("--json");
  const [repo, target, ...rest] = (isResume ? argv.slice(1) : argv).filter((a) => a !== "--no-spec" && a !== "--json");
  const both = "[--review-mode split|both] [--roles a,b] [--fresh ROLES|none] [--max-fixes N]";
  const usage = `usage: loop <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2] [--no-spec] ${both} [--json]\n       loop resume <repo> <loop> [--answer TEXT|@FILE] [--drop ID,ID] [--add FILE] [-m TEXT|@FILE] [--max-rounds N] ${both} [--json]`;
  if (!repo || !target) { console.error(usage); process.exit(2); }
  const text = (v) => (v?.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v);
  const o = { specs: [], noSpec };
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = [rest[i], rest[i + 1]];
    if (v === undefined) { console.error(`loop: ${k} needs a value`); process.exit(2); }
    if (k === "--spec" && !isResume) o.specs.push(path.resolve(v));
    else if (k === "--name" && !isResume) o.name = v;
    else if (k === "--max-rounds" && !isResume) o.maxRounds = v;
    else if (k === "--reviews" && !isResume) o.reviews = v.split(",").filter(Boolean);
    else if (k === "--answer" && isResume) o.answer = text(v);
    else if (k === "--drop" && isResume) o.drop = v.split(",").filter(Boolean);
    else if (k === "--max-rounds" && isResume) o.maxRounds = v;
    else if (k === "--max-fixes") o.maxFixes = v;
    else if (k === "--review-mode") o.reviewMode = v;
    else if (k === "--roles") o.roles = v;
    else if (k === "--fresh") o.fresh = v;
    else if (k === "--add" && isResume) o.add = fs.readFileSync(v, "utf8");
    else if ((k === "-m" || k === "--message") && isResume) o.message = text(v);
    else { console.error(`loop: unknown option ${k}\n${usage}`); process.exit(2); }
  }
  const P = project(repo);
  const st = await (isResume ? resume(P, target, o, { openTab }) : loop(P, target, o, { openTab })).catch((e) => { console.error(`loop: ${e.message}`); process.exit(1); });
  const statePath = path.join(P.runs, "_loops", st.loop, "state.json");
  // No process.exit: a base suite still running beside the loop finishes and writes its cache.
  if (!asJson) console.log(loopBrief(st, path.relative(BOX, statePath).replace(/\\/g, "/")));
  else console.log(JSON.stringify({ loop: st.loop, last: st.last, next: st.next, reason: st.reason,
    open: st.open.map((x) => ({ id: x.id, severity: x.severity, survived: x.survived, issue: x.finding?.issue ?? (x.regression ? "regression in the tests next to the change" : null) })),
    questions: st.rounds.at(-1)?.questions ?? [], queue: st.rounds.at(-1)?.queue ?? [], disputes: st.disputes,
    notes: st.notes, rounds: st.rounds.map((r) => ({ k: r.k, kind: r.kind, run: r.run, tier: r.tier, blocking: r.blocking.length, open: r.open.length, fixed: r.fixed.length, fix: r.fix?.verdict ?? null })),
    escalations: st.escalations, state: statePath }, null, 2));
}

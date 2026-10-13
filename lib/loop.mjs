// The review and fix loop. Review a run's branch, rerun every finding's reproduction on the branch
// with the existing tests next to the change, send what is proven back to the worker, and review the
// fix, until nothing blocks. Deterministic: models only review and fix; the orchestrator gets what
// code cannot decide (spec questions, serious findings without a reproduction, the worker's disputes).
//
// Why: Lykos T194 and T174b (research/findings.md §11). One fix round left both open; the Sonnet
// pipeline closed them in 3 and 6 review rounds, and most of what its later rounds found was in code
// the previous fix had written. A reviewer's CONFIRMED is its own word: the harness reruns the proof.
//
// Rounds. First: both axes on the whole change. After a fix: the spec axis on the fix's own diff.
// Final: both axes on the whole change, only when something was fixed (a first review that passes is
// the last). Routing of a round's findings:
//   reproduction fails on the branch     -> blocks if critical/high/medium, else a merge note
//   reproduction passes on the branch    -> dropped, labelled review_false_positive
//   spec_question                        -> stop: next answer_spec
//   no reproduction, CONFIRMED critical/high logic, edge case, security or requirement -> stop: triage
//   no reproduction, other medium+       -> sent with the next fix, never blocks (one advice-only fix)
//   everything else                      -> merge note
// The tests next to the change failing on the branch and passing on the base: a regression, blocks.
// Escalation up LOOP_LADDER (a fresh worker on the last passing branch, with the task, what is open,
// the history and the last attempt's diff and test output): a finding still failing after LOOP_STUCK
// fixes by one worker, a regression after one, serious findings after LOOP_SOFT_ROUNDS fix rounds by
// one worker, or a fix that fails its own tests. LOOP_MAX_ROUNDS reviews, or no rung left: decide.
//
//   node lib/loop.mjs <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2]
//   node lib/loop.mjs resume <repo> <loop> [--answer TEXT|@FILE] [--drop ID,ID] [--add FILE] [-m TEXT|@FILE] [--max-rounds N]
//   Prints JSON: {loop, last, next, reason, open, notes, rounds, escalations}
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { project, conf, testFileCmd } from "./ticket.mjs";
import { append, readMeta, readAll } from "./ledger.mjs";
import { readJson } from "./checks.mjs";
import { validRepro, neighbourTests, verifyFiles, parseVerify } from "./verify.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERIOUS = new Set(["critical", "high"]);
const BLOCKING = new Set(["critical", "high", "medium"]);
const BEHAVIOUR = new Set(["logic", "edge_case", "security", "requirement"]);
const sev = (f) => String(f.severity ?? "").toLowerCase();
const isConfirmed = (f) => String(f.confidence).toUpperCase() === "CONFIRMED";
export const axisOf = (role) => (role === "review-std" ? "std" : "spec");

export function settings(P) {
  const n = (k, d) => { const v = Number(conf(k, P)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { maxRounds: n("LOOP_MAX_ROUNDS", 6), stuck: n("LOOP_STUCK", 2), softRounds: n("LOOP_SOFT_ROUNDS", 3),
    neighbours: n("LOOP_NEIGHBOURS", 30),
    ladder: (conf("LOOP_LADDER", P) || "implement implement-hard escalate").split(/\s+/).filter(Boolean) };
}

// One round's new findings, sorted by what the harness saw: verify.repro[id] is the reproduction's exit
// on the branch (undefined: not rerun).
export function classify(findings, repro = {}) {
  const out = { blocking: [], notes: [], dropped: [], questions: [], queue: [], advice: [] };
  for (const f of findings) {
    const exit = validRepro(f.repro) ? repro[f.id] : undefined;
    if (f.category === "spec_question") out.questions.push(f);
    else if (exit !== undefined && exit !== 0) (BLOCKING.has(sev(f)) ? out.blocking : out.notes).push(f);
    else if (exit === 0) out.dropped.push(f);
    else if (isConfirmed(f) && SERIOUS.has(sev(f)) && BEHAVIOUR.has(f.category)) out.queue.push(f);
    else if (BLOCKING.has(sev(f)) && (isConfirmed(f) || !BEHAVIOUR.has(f.category))) out.advice.push(f);
    else out.notes.push(f);
  }
  return out;
}

// The next step after a round. Pure. x: {round, kind, open: [{id, severity, survived, regression?}],
// questions, queue, disputes, advice (counts), adviceUsed, fixesTotal, fixesByTier}.
export function decide(x, o) {
  if (x.questions) return { action: "stop", next: "answer_spec", reason: `${x.questions} spec questions for the orchestrator` };
  if (x.queue || x.disputes) return { action: "stop", next: "triage", reason: `${x.queue} serious findings without a reproduction, ${x.disputes} disputed by the worker` };
  const another = (action, reason) => (x.round >= o.maxRounds
    ? { action: "stop", next: "decide", reason: `${x.round} review rounds: ${reason}` } : { action, reason });
  if (!x.open.length) {
    if (x.advice && !x.adviceUsed) return another("fix", `${x.advice} findings to fix that no test shows`);
    if (x.fixesTotal === 0) return { action: "approve", reason: "the first review found nothing that blocks" };
    if (x.kind === "final") return { action: "approve", reason: "the final review found nothing that blocks" };
    return another("final", "the fix review is clean; the whole change gets its final review");
  }
  if (x.round >= o.maxRounds) return { action: "stop", next: "decide", reason: `${x.round} review rounds and ${x.open.length} items still open` };
  const stuck = x.open.filter((f) => f.survived >= (f.regression ? 1 : o.stuck));
  if (stuck.length) return { action: "escalate", reason: `${stuck.map((f) => f.id).join(", ")} still failing after ${o.stuck} fixes (a regression after 1)` };
  if (x.fixesByTier >= o.softRounds && x.open.some((f) => SERIOUS.has(sev(f)))) {
    return { action: "escalate", reason: `serious items still open after ${x.fixesByTier} fix rounds` };
  }
  return { action: "fix", reason: `${x.open.length} items open` };
}

// The loop's progress, one JSON line per step, finding and decision: lib/loopwatch.mjs shows it live
// (delegate.sh loop-watch, and a herdr tab of its own when herdr runs).
const sayTo = (dir) => (ev, x = {}) => fs.appendFileSync(path.join(dir, "progress.jsonl"), `${JSON.stringify({ t: Date.now(), ev, ...x })}\n`);
// herdr: the loop's own tab, next to the tabs of the runs it starts. Nothing when herdr is off.
const openTab = (P, name) => spawnSync("bash", [path.join(BOX, "delegate.sh"), "loop-tab", P.repo, name], { stdio: "ignore" });

export const nextTier = (ladder, tier) => { const i = ladder.indexOf(tier); return i < 0 ? ladder[0] : ladder[i + 1] ?? null; };

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s);
const where = (f) => `\`${f.file ?? "?"}${f.line ? `:${f.line}` : ""}\``;

// What the fix review is told about the fix it reviews.
export function fixContext(items) {
  return ["## What the last fix was for", "",
    "The worker was asked to fix these. The harness reruns their reproductions itself, so do not report",
    "them again just because they were listed. Review the fix's own diff: is it correct and complete, and",
    "what did it break? Report a listed problem again only if the fix plainly did not address it.", "",
    ...items.map((f) => `- \`${f.id}\` (${f.severity}): ${f.issue}. Where: ${where(f)}`), ""].join("\n");
}

// The message a fix round sends: proven failures with their reproductions, regressions, advice, and
// anything the orchestrator added.
export function fixMessage(k, open, advice, extra = []) {
  const out = [`# Review round ${k}: fix these`, ""];
  const findings = open.filter((o) => !o.regression);
  if (findings.length) {
    out.push("The harness reran each reviewer's reproduction on your branch and it failed, so each is a real",
      "failure. Fix the cause in the code, never by weakening a test. Add each reproduction to the repo as a",
      "test where it fits; the harness reruns its own copy after you. If you are sure a finding is wrong,",
      "change nothing for it and list its id under `disputes` in your report block: the orchestrator decides.", "");
    for (const o of findings) {
      const f = o.finding;
      out.push(`## ${o.id}: ${f.issue} (${f.severity}, ${f.category ?? "?"})${o.survived ? ` - still failing after ${o.survived} fix${o.survived > 1 ? "es" : ""}` : ""}`, "",
        `- Where: ${where(f)}`, `- Fails when: ${f.scenario ?? "(not given)"}`, `- Reproduction, run from the repo root: \`${f.repro.cmd}\`, file \`${f.repro.file}\`:`, "",
        "```", clip(f.repro.content, 4000), "```", "");
    }
  }
  for (const o of open.filter((x) => x.regression)) {
    out.push("## Regression: the tests next to your change fail", "",
      `\`${o.cmd}\` passes on the base and fails on your branch. Last lines:`, "", "```", clip(o.tail ?? "", 4000), "```", "");
  }
  if (advice.length) {
    out.push("## Also fix (no test shows these: docs, tests, standards)", "",
      ...advice.map((f) => `- \`${f.id}\` ${f.issue} (${f.severity}, ${f.category ?? "?"}). Where: ${where(f)}. ${f.scenario ?? ""}`), "");
  }
  for (const e of extra) out.push(e.trim(), "");
  out.push("Commit, rerun the test command, and end with the report block again.");
  return out.join("\n");
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
  const cfg = { ...settings(P), ...(o.maxRounds ? { maxRounds: Number(o.maxRounds) } : {}) };
  if (!readJson(path.join(P.runs, start, "summary.json"))) throw new Error(`no run ${start} in ${P.runs}`);
  let name = o.name || `loop-${start}`;
  for (let i = 2; fs.existsSync(path.join(P.runs, "_loops", name)); i++) name = `${o.name || `loop-${start}`}-${i}`;
  fs.mkdirSync(path.join(P.runs, "_loops", name), { recursive: true });
  const base = readJson(path.join(P.runs, start, "summary.json")).base;
  const st = { loop: name, start, base, specs: o.specs ?? [], settings: cfg, run: start,
    tier: readMeta(path.join(P.runs, start, "meta.sh")).ROLE || cfg.ladder[0], kind: "first", prevRun: null,
    fixesTotal: 0, fixesByTier: 0, adviceUsed: false, open: [], notes: [], rulings: [], rounds: [], escalations: [], disputes: [] };
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
  const extra = [];
  if (o.answer) { st.rulings.push(o.answer); extra.push(`## The orchestrator's ruling\n\n${o.answer}`); }
  if (o.maxRounds) st.settings.maxRounds = Number(o.maxRounds);
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
  sayTo(path.dirname(file))("resume", { answer: !!o.answer, drop: [...drop], add: !!o.add, message: !!o.message, maxRounds: o.maxRounds ? Number(o.maxRounds) : null });
  deps.openTab?.(P, name);
  if (st.blockedRun) {
    const run = st.blockedRun; delete st.blockedRun;
    return drive(P, st, { phase: "answer", run, extra }, deps);
  }
  const advice = (last?.advice ?? []).filter((id) => !drop.has(id)).map((id) => last.findings.find((f) => f.id === id)).filter(Boolean);
  return drive(P, st, extra.length ? { phase: "fix", extra, advice } : { phase: "decide", advice }, deps);
}

function label(P, record, readAllFn, f, cause, source, why) {
  const id = readAllFn().filter((e) => e.type === "review" && e.project === P.name && e.run === f.review).at(-1)?.id;
  if (id) record("label", { refs: [`${id}#${f.n}`], cause, source, why }, { project: P.name, run: f.review });
}

async function drive(P, st, entry, deps) {
  const { delegate = runDelegate, record = append, readAll: readAllFn = readAll, neighbours = neighbourTests } = deps;
  const cfg = st.settings, name = st.loop, dir = path.join(P.runs, "_loops", name);
  const summary = (run) => readJson(path.join(P.runs, run, "summary.json"));
  const meta = (run) => readMeta(path.join(P.runs, run, "meta.sh"));
  const save = () => fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(st, null, 2));
  const say = sayTo(dir);
  const out = (next, reason) => { st.next = next; st.reason = reason; st.last = st.run; save(); say("end", { next, reason, last: st.run, open: st.open.length }); return st; };
  const rulingsFile = () => {
    if (!st.rulings.length) return null;
    const f = path.join(dir, "rulings.md");
    fs.writeFileSync(f, ["# The orchestrator's rulings on this task", "", ...st.rulings.map((r, i) => `${i + 1}. ${r}`), ""].join("\n"));
    return f;
  };
  let phase = entry.phase, given = entry.reviews, extra = entry.extra ?? [], advice = entry.advice ?? [];
  let d = null, failedFix = null;

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
      // 1. Review.
      let reviews;
      if (given) { reviews = given; given = null; say("step", { k, what: "review", runs: reviews }); } else {
        const args = ["review", P.repo, `agent/${st.run}`, "--name", `${name}-rv${k}`];
        for (const s of st.specs) args.push("--spec", s);
        const rf = rulingsFile(); if (rf) args.push("--spec", rf);
        if (st.kind === "fix" && st.prevRun) {
          args.push("--roles", "review-spec", "--against", `agent/${st.prevRun}`);
          const ctx = st.lastSent ?? [];
          if (ctx.length) { const f = path.join(dir, `fixctx-${k}.md`); fs.writeFileSync(f, fixContext(ctx)); args.push("--prior", `spec=${f}`); }
        }
        const roles = st.kind === "fix" && st.prevRun ? ["review-spec"] : (conf("REVIEW_ROLES", P) || "review-spec review-std").split(/[\s,]+/).filter(Boolean);
        say("step", { k, what: "review", runs: roles.map((r) => `${name}-rv${k}-${r}`), against: st.kind === "fix" ? st.prevRun : null });
        await delegate(args, path.join(dir, `review-${k}.log`));
        reviews = fs.readdirSync(P.runs).filter((x) => x.startsWith(`${name}-rv${k}-`));
      }
      if (!reviews.length) return out("fix_environment", `round ${k}: no review run started`);
      const findings = [];
      for (const rv of reviews) {
        const s = summary(rv), f = readJson(path.join(P.runs, rv, "findings.json"));
        if (!s || !Array.isArray(f)) return out(!s || s.next === "fix_environment" ? "fix_environment" : "read_final_message", `review ${rv} gave no readable findings`);
        const axis = axisOf(meta(rv).ROLE);
        f.forEach((x, i) => findings.push({ ...x, id: `${k}.${axis}.${i + 1}`, axis, review: rv, n: i + 1 }));
      }
      say("done", { what: "review", runs: reviews, findings: findings.length });

      // 2. Check: every reproduction (new ones and those still open) and the tests next to the change.
      const repros = [...findings.filter((f) => validRepro(f.repro)), ...st.open.filter((x) => !x.regression).map((x) => x.finding)]
        .map((f) => ({ id: f.id, file: f.repro.file, content: f.repro.content, cmd: f.repro.cmd }));
      const tests = neighbours(P.repo, st.base, `agent/${st.run}`, P.testGlobs ?? [], cfg.neighbours);
      const ncmd = tests.length ? testFileCmd(P, tests) : null;
      let verify = { repro: {}, neighbours: null }, check = null;
      if (repros.length || ncmd) {
        check = `${name}-check${k}`;
        const hidden = path.join(dir, `check-${k}`);
        for (const [rel, text] of Object.entries(verifyFiles({ repros, neighboursCmd: ncmd, base: st.base }))) {
          fs.mkdirSync(path.dirname(path.join(hidden, rel)), { recursive: true });
          fs.writeFileSync(path.join(hidden, rel), text);
        }
        say("step", { k, what: "check", run: check, repros: repros.length, neighbours: tests.length });
        await delegate(["check", P.repo, `agent/${st.run}`, "--test", "bash .agent-box-verify/run.sh", "--hidden", hidden, "--name", check], path.join(dir, `check-${k}.log`));
        let log = null; try { log = fs.readFileSync(path.join(P.runs, check, "test.log"), "utf8"); } catch { /* none */ }
        if (log === null) return out("fix_environment", `check ${check} produced no test log`);
        verify = parseVerify(log);
        const n = verify.neighbours;
        say("done", { what: "check", run: check, repro: verify.repro, neighbours: n && { exit: n.exit, base_exit: n.base_exit, regression: n.regression } });
      }

      // 3. What is still open, what is new, what is fixed.
      const fixed = [];
      const prevReg = st.open.find((x) => x.regression);
      st.open = st.open.flatMap((x) => {
        if (x.regression) return [];          // re-added below from this round's run
        const e = verify.repro[x.id];
        if (e === 0) { fixed.push(x.id); return []; }
        return [{ ...x, survived: x.survived + (e === undefined ? 0 : 1) }];
      });
      let regression = null;
      if (verify.neighbours?.regression) {
        regression = { id: "regression", severity: "high", regression: true, cmd: ncmd, tail: verify.neighbours.tail, survived: prevReg ? prevReg.survived + 1 : 0 };
        st.open.push(regression);
      }
      const c = classify(findings, verify.repro);
      for (const f of c.blocking) {
        st.open.push({ id: f.id, severity: f.severity, survived: 0, finding: f });
        label(P, record, readAllFn, f, "worker_careless", "harness", "Its reproduction failed when the harness reran it on the branch; sent to the worker.");
      }
      for (const f of c.dropped) label(P, record, readAllFn, f, "review_false_positive", "harness", "Its reproduction passed when the harness reran it on the branch.");
      st.notes.push(...c.notes.map((f) => ({ id: f.id, severity: f.severity, issue: f.issue, file: f.file ?? null })));
      const disputesOpen = st.disputes.filter((x) => st.open.some((y) => y.id === x.finding));
      st.disputes = disputesOpen;
      const ids = (a) => a.map((f) => f.id);
      st.rounds.push({ k, kind: st.kind, run: st.run, tier: st.tier, model: summary(st.run)?.model ?? null, reviews, check, findings,
        blocking: ids(c.blocking), dropped: ids(c.dropped), questions: ids(c.questions), queue: ids(c.queue), advice: ids(c.advice),
        notes: ids(c.notes), fixed, open: st.open.map((x) => x.id), regression: !!regression, neighbours: tests });
      save();
      const route = new Map([["blocking", "proven"], ["dropped", "dropped"], ["questions", "question"], ["queue", "triage"], ["advice", "advice"], ["notes", "note"]]
        .flatMap(([key, r]) => c[key].map((f) => [f.id, r])));
      say("findings", { k, items: findings.map((f) => ({ id: f.id, severity: f.severity ?? null, category: f.category ?? null, issue: f.issue ?? "", file: f.file ?? null, line: f.line ?? null, route: route.get(f.id), exit: verify.repro[f.id] ?? null })),
        fixed, regression: !!regression, open: st.open.map((x) => ({ id: x.id, severity: x.severity, survived: x.survived })) });
      advice = c.advice;
      d = decide({ round: k, kind: st.kind, open: st.open, questions: c.questions.length, queue: c.queue.length, disputes: disputesOpen.length,
        advice: c.advice.length, adviceUsed: st.adviceUsed, fixesTotal: st.fixesTotal, fixesByTier: st.fixesByTier }, cfg);
      say("decide", { k, ...d });
      phase = d.action;
    } else if (phase === "decide") {
      const r = st.rounds.at(-1);
      d = decide({ round: r?.k ?? 0, kind: st.kind, open: st.open, questions: 0, queue: 0, disputes: 0, advice: advice.length, adviceUsed: st.adviceUsed,
        fixesTotal: st.fixesTotal, fixesByTier: st.fixesByTier }, cfg);
      say("decide", { k: r?.k ?? 0, ...d });
      phase = d.action;
    }

    if (phase === "approve") return out("approve", d.reason);
    if (phase === "stop") return out(d.next, d.reason);
    if (phase === "final") { st.kind = "final"; st.prevRun = null; phase = "review"; continue; }

    const k = st.rounds.length;
    if (phase === "fix") {
      // 4. Fix: the same worker, its own session.
      const fix = `${name}-fix${k}${st.resumed ? `-${st.resumed}` : ""}`;
      const msg = path.join(dir, `${fix}.md`);
      fs.writeFileSync(msg, fixMessage(k, st.open, advice, extra));
      if (!st.open.length && advice.length) st.adviceUsed = true;
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
        st.prevRun = st.run; st.run = fix; st.kind = "fix"; st.fixesTotal++; st.fixesByTier++;
        phase = "review"; continue;
      }
      if (s?.verdict === "blocked") { st.blockedRun = fix; return out("answer_question", `fix round ${fix} asks: ${s.blocked}`); }
      if (!s || !["fail", "no_change"].includes(s.verdict)) return out(s?.next ?? "fix_environment", `fix round ${fix} ended ${s?.verdict ?? "with no summary"}`);
      failedFix = fix;
      d = { action: "escalate", reason: `fix round ${fix} ended ${s.verdict}` };
      say("decide", { k, ...d });
      phase = "escalate";
    }

    if (phase === "escalate") {
      // 5. Escalate: a fresh worker one rung up, on the last passing branch.
      for (;;) {
        const up = nextTier(cfg.ladder, st.tier);
        if (!up) return out("decide", `${d.reason}, and no rung above ${st.tier}`);
        const esc = `${name}-esc${k}-${up}`;
        const task = path.join(dir, `${esc}.md`);
        fs.writeFileSync(task, escalationTask(P, st, d.reason, fixMessage(k, st.open, advice, extra), failedFix));
        const m = meta(st.start);
        say("step", { k, what: "escalate", run: esc, from: st.tier, to: up, reason: d.reason });
        await delegate(["run", P.repo, task, "--role", up, "--base", `agent/${st.run}`, "--name", esc, "--no-red",
          ...(m.TEST_CMD ? ["--test", m.TEST_CMD] : [])], path.join(dir, `${esc}.log`));
        const s = summary(esc);
        say("done", { what: "escalate", run: esc, verdict: s?.verdict ?? null, model: s?.model ?? null });
        st.escalations.push({ after_round: k, from: st.tier, to: up, run: esc, reason: d.reason, verdict: s?.verdict ?? null });
        record("escalate", { from_model: summary(st.run)?.model ?? null, to_model: s?.model ?? null, at_round: k, reason: d.reason, loop: name },
          { project: P.name, run: esc, role: up, model: s?.model ?? null });
        st.tier = up; st.fixesByTier = 0;
        st.open = st.open.map((x) => ({ ...x, survived: 0 }));
        save();
        if (s?.verdict === "pass") {
          st.lastSent = st.open.filter((x) => !x.regression).map((x) => x.finding);
          st.prevRun = st.run; st.run = esc; st.kind = "fix"; st.fixesTotal++; extra = [];
          break;
        }
        if (!s || !["fail", "no_change"].includes(s.verdict)) return out(s?.next ?? "fix_environment", `escalation ${esc} ended ${s?.verdict ?? "with no summary"}`);
        failedFix = esc;
        d = { action: "escalate", reason: `escalation ${esc} ended ${s.verdict}` };
      }
      failedFix = null;
      phase = "review";
    }
  }
}

function escalationTask(P, st, reason, findings, failedFix) {
  const task = fs.readFileSync(path.join(P.runs, st.start, "task.md"), "utf8");
  const history = st.rounds.map((r) => `- Round ${r.k} (${r.kind} review of ${r.model}, ${r.tier}): ${r.blocking.length} new proven, ${r.open.length} open${r.fix ? `; its fix round ended ${r.fix.verdict}` : ""}.`);
  const last = failedFix ?? (st.prevRun ? st.run : null);
  const from = failedFix ? st.run : st.prevRun;
  let attempt = "";
  if (last && from) {
    const diff = gitOut(P.repo, "diff", `agent/${from}..agent/${last}`);
    let tail = ""; try { tail = fs.readFileSync(path.join(P.runs, last, "test.log"), "utf8").split("\n").slice(-60).join("\n"); } catch { /* none */ }
    attempt = [`## The last attempt (${last}${failedFix ? ", discarded: its tests failed" : ""})`, "",
      "What the previous worker changed in its last round, so you do not repeat it:", "", "```diff", clip(diff, 12000), "```", "",
      ...(tail ? ["Its test output, last lines:", "", "```", tail, "```", ""] : [])].join("\n");
  }
  return `${task.trimEnd()}\n\n## Earlier workers on this branch\n\nThe branch you start on holds earlier workers' commits for this task. Read \`git log\` and the diff from\nthe base before you change anything; keep what is right. Why you were called: ${reason}.\n\n${history.join("\n")}\n\n${attempt}\n${findings}`;
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const argv = process.argv.slice(2);
  const isResume = argv[0] === "resume";
  const [repo, target, ...rest] = isResume ? argv.slice(1) : argv;
  const usage = "usage: loop <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2]\n       loop resume <repo> <loop> [--answer TEXT|@FILE] [--drop ID,ID] [--add FILE] [-m TEXT|@FILE] [--max-rounds N]";
  if (!repo || !target) { console.error(usage); process.exit(2); }
  const text = (v) => (v?.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v);
  const o = { specs: [] };
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
    else if (k === "--add" && isResume) o.add = fs.readFileSync(v, "utf8");
    else if ((k === "-m" || k === "--message") && isResume) o.message = text(v);
    else { console.error(`loop: unknown option ${k}\n${usage}`); process.exit(2); }
  }
  const P = project(repo);
  const st = await (isResume ? resume(P, target, o, { openTab }) : loop(P, target, o, { openTab })).catch((e) => { console.error(`loop: ${e.message}`); process.exit(1); });
  console.log(JSON.stringify({ loop: st.loop, last: st.last, next: st.next, reason: st.reason,
    open: st.open.map((x) => ({ id: x.id, severity: x.severity, survived: x.survived, issue: x.finding?.issue ?? (x.regression ? "regression in the tests next to the change" : null) })),
    questions: st.rounds.at(-1)?.questions ?? [], queue: st.rounds.at(-1)?.queue ?? [], disputes: st.disputes,
    notes: st.notes, rounds: st.rounds.map((r) => ({ k: r.k, kind: r.kind, run: r.run, tier: r.tier, blocking: r.blocking.length, open: r.open.length, fixed: r.fixed.length, fix: r.fix?.verdict ?? null })),
    escalations: st.escalations, state: path.join(P.runs, "_loops", st.loop, "state.json") }, null, 2));
}

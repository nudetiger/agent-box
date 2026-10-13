// The review and fix loop. Review a run's branch on both axes, send every CONFIRMED finding back to its
// worker, and review again, until no CONFIRMED finding is left. Each review after the first rechecks
// the findings the worker was just asked to fix; one still open is reported again with "prior": <id>.
// The work moves up the ladder (implement -> implement-hard -> escalate, a fresh worker on the branch
// with the open findings and the history) when a finding survives LOOP_STUCK fixes by one worker, when
// serious findings are still open after LOOP_SOFT_ROUNDS fix rounds by it, or when a fix round fails
// its own tests. LOOP_MAX_ROUNDS reviews in all, or no rung left: the orchestrator decides.
//
// Why: Lykos T194 and T174b (research/findings.md §11-12). One fix round left both open; the Sonnet
// pipeline closed them in 3 and 6 review rounds, and most of what its later rounds found was in code
// the previous fix had written.
//
//   node lib/loop.mjs <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2]
//   --reviews: the first round's review runs already exist (a review that ran before the loop).
//   Prints JSON: {loop, last, next: approve|decide|<the failed run's own next>, reason, rounds}
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { project, conf } from "./ticket.mjs";
import { append, readMeta } from "./ledger.mjs";
import { readJson } from "./checks.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERIOUS = new Set(["critical", "high"]);
const isConfirmed = (f) => String(f.confidence).toUpperCase() === "CONFIRMED";
const isSerious = (f) => SERIOUS.has(String(f.severity).toLowerCase());
export const axisOf = (role) => (role === "review-std" ? "std" : "spec");

export function settings(P) {
  const n = (k, d) => { const v = Number(conf(k, P)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { maxRounds: n("LOOP_MAX_ROUNDS", 6), stuck: n("LOOP_STUCK", 2), softRounds: n("LOOP_SOFT_ROUNDS", 3),
    ladder: (conf("LOOP_LADDER", P) || "implement implement-hard escalate").split(/\s+/).filter(Boolean) };
}

// How many fixes by the current worker a finding has survived: its chain of "prior" ids back through
// the rounds that worker's runs were reviewed in.
export function survived(rounds, finding) {
  const tier = rounds.at(-1).tier;
  let n = 0, f = finding;
  for (let j = rounds.length - 2; j >= 0 && rounds[j].tier === tier && f?.prior; j--) {
    f = rounds[j].findings.find((x) => x.id === f.prior);
    if (!f) break;
    n++;
  }
  return n;
}

// The next step after a review round, from the rounds so far. Pure: the tests drive it directly.
// rounds: [{tier, findings: [{id, severity, confidence, prior?}]}], oldest first.
export function decide(rounds, o) {
  const cur = rounds.at(-1);
  const open = cur.findings.filter(isConfirmed);
  if (!open.length) return { action: "clean", reason: "no CONFIRMED finding" };
  if (rounds.length >= o.maxRounds) return { action: "stop", reason: `${rounds.length} review rounds and ${open.length} CONFIRMED findings still open` };
  const stuck = open.filter((f) => survived(rounds, f) >= o.stuck);
  if (stuck.length) return { action: "escalate", reason: `${stuck.map((f) => f.prior).join(", ")} still open after ${o.stuck} fixes` };
  let k = rounds.length - 1; while (k > 0 && rounds[k - 1].tier === cur.tier) k--;
  const fixes = rounds.length - 1 - k;
  if (fixes >= o.softRounds && open.some(isSerious)) {
    return { action: "escalate", reason: `serious findings still open after ${fixes} fix rounds` };
  }
  return { action: "fix", reason: `${open.length} CONFIRMED findings` };
}

export const nextTier = (ladder, tier) => {
  const i = ladder.indexOf(tier);
  return i < 0 ? ladder[0] : ladder[i + 1] ?? null;
};

// The findings each axis rechecks first in the next round: the CONFIRMED ones of the round just fixed.
export function priorText(findings) {
  return ["## Recheck the previous round first", "",
    "The worker was asked to fix these findings from the last review. Check each one against the current",
    "branch before anything else. Report one that is still not fixed again, with `\"prior\": \"<its id>\"` in",
    "its entry; leave fixed ones out. Then review the rest of the change, the fix included.", "",
    ...findings.map((f) => `- \`${f.id}\` (${f.severity}): ${f.issue}. Where: \`${f.file ?? "?"}${f.line ? `:${f.line}` : ""}\`. Fails when: ${f.scenario ?? "(not given)"}`),
    ""].join("\n");
}

function runDelegate(args, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, "w");
    const p = spawn("bash", [path.join(BOX, "delegate.sh"), ...args], { stdio: ["ignore", out, out] });
    p.on("close", (code) => { fs.closeSync(out); resolve(code); });
  });
}

export async function loop(P, start, o = {}, deps = {}) {
  const { delegate = runDelegate, record = append } = deps;
  const cfg = { ...settings(P), ...(o.maxRounds ? { maxRounds: Number(o.maxRounds) } : {}) };
  let name = o.name || `loop-${start}`;
  for (let i = 2; fs.existsSync(path.join(P.runs, "_loops", name)); i++) name = `${o.name || `loop-${start}`}-${i}`;
  const dir = path.join(P.runs, "_loops", name);
  const summary = (run) => readJson(path.join(P.runs, run, "summary.json"));
  const meta = (run) => readMeta(path.join(P.runs, run, "meta.sh"));
  if (!summary(start)) throw new Error(`no run ${start} in ${P.runs}`);
  fs.mkdirSync(dir, { recursive: true });
  const st = { loop: name, start, settings: cfg, rounds: [], escalations: [] };
  const save = () => fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(st, null, 2));
  const out = (next, reason, last) => { st.next = next; st.reason = reason; st.last = last; save(); return st; };
  const env = (run, role) => ({ project: P.name, run, role, model: summary(run)?.model ?? null });

  let run = start, tier = meta(start).ROLE || cfg.ladder[0], given = o.reviews;
  for (;;) {
    const k = st.rounds.length + 1;
    // 1. Review: both axes, each rechecking its own axis's findings from the round just fixed.
    let reviews;
    if (given) { reviews = given; given = null; } else {
      const args = ["review", P.repo, `agent/${run}`, "--name", `${name}-rv${k}`];
      for (const s of o.specs ?? []) args.push("--spec", s);
      const prev = st.rounds.at(-1);
      for (const axis of ["spec", "std"]) {
        const fs_ = prev?.findings.filter((f) => f.axis === axis && isConfirmed(f)) ?? [];
        if (!fs_.length) continue;
        const file = path.join(dir, `prior-${k}-${axis}.md`);
        fs.writeFileSync(file, priorText(fs_));
        args.push("--prior", `${axis}=${file}`);
      }
      await delegate(args, path.join(dir, `review-${k}.log`));
      reviews = fs.readdirSync(P.runs).filter((d) => d.startsWith(`${name}-rv${k}-`));
    }
    const findings = [];
    for (const rv of reviews) {
      const s = summary(rv), f = readJson(path.join(P.runs, rv, "findings.json"));
      if (!s || !Array.isArray(f)) return out(s?.next === "fix_environment" || !s ? "fix_environment" : "read_final_message", `review ${rv} gave no readable findings`, run);
      const axis = axisOf(meta(rv).ROLE);
      f.forEach((x, i) => findings.push({ ...x, id: `${k}.${axis}.${i + 1}`, axis, review: rv, n: i + 1 }));
    }
    st.rounds.push({ k, run, tier, model: summary(run)?.model ?? null, reviews, findings,
      confirmed: findings.filter(isConfirmed).length, serious: findings.filter((f) => isConfirmed(f) && isSerious(f)).length });
    save();

    // 2. Decide.
    let d = decide(st.rounds, cfg);
    if (d.action === "clean") return out("approve", d.reason, run);
    if (d.action === "stop") return out("decide", d.reason, run);
    const open = findings.filter(isConfirmed);
    const forward = Object.entries(Object.groupBy(open, (f) => f.review)).map(([rv, fs_]) => `${rv}:${fs_.map((f) => f.n).join(",")}`).join("+");

    // 3. Fix: the same worker, its own session, every CONFIRMED finding verbatim.
    if (d.action === "fix") {
      const fix = `${name}-fix${k}`;
      await delegate(["continue", P.repo, run, "--findings", forward, "--name", fix], path.join(dir, `fix-${k}.log`));
      const s = summary(fix);
      st.rounds.at(-1).fix = { run: fix, verdict: s?.verdict ?? null };
      save();
      if (s?.verdict === "pass") { run = fix; continue; }
      if (!s || !["fail", "no_change"].includes(s.verdict)) return out(s?.next ?? "fix_environment", `fix round ${fix} ended ${s?.verdict ?? "with no summary"}`, run);
      d = { action: "escalate", reason: `fix round ${fix} ended ${s.verdict}` };
    }

    // 4. Escalate: a fresh worker one rung up, on the branch so far, with the task, the open findings
    //    and the history. A rung whose own run fails hands on to the next.
    for (;;) {
      const up = nextTier(cfg.ladder, tier);
      if (!up) return out("decide", `${d.reason}, and no rung above ${tier}`, run);
      const esc = `${name}-esc${k}-${up}`;
      const task = path.join(dir, `esc-${k}-${up}.md`);
      fs.writeFileSync(task, escalationTask(P, start, st, open, forward, d.reason));
      const m = meta(start);
      await delegate(["run", P.repo, task, "--role", up, "--base", `agent/${run}`, "--name", esc, "--no-red",
        ...(m.TEST_CMD ? ["--test", m.TEST_CMD] : [])], path.join(dir, `esc-${k}-${up}.log`));
      const s = summary(esc);
      st.escalations.push({ after_round: k, from: tier, to: up, run: esc, reason: d.reason, verdict: s?.verdict ?? null });
      record("escalate", { from_model: summary(run)?.model ?? null, to_model: s?.model ?? null, at_round: k, reason: d.reason, loop: name }, env(esc, up));
      save();
      tier = up;
      if (s?.verdict === "pass") { run = esc; break; }
      if (!s || !["fail", "no_change"].includes(s.verdict)) return out(s?.next ?? "fix_environment", `escalation ${esc} ended ${s?.verdict ?? "with no summary"}`, run);
      d = { action: "escalate", reason: `escalation ${esc} ended ${s.verdict}` };
    }
  }
}

function escalationTask(P, start, st, open, forward, reason) {
  const task = fs.readFileSync(path.join(P.runs, start, "task.md"), "utf8");
  let findings;
  try {
    findings = execFileSync("node", [path.join(BOX, "lib", "forward.mjs"), P.runs, forward, "", "model_limit", P.name], { encoding: "utf8" });
  } catch {
    findings = ["# Review findings to fix", "", ...open.map((f, i) => `## ${i + 1}. ${f.issue} (${f.severity}, ${f.confidence})\n\n- Where: \`${f.file}\`\n- Fails when: ${f.scenario}\n`)].join("\n");
  }
  const history = st.rounds.map((r) => `- Round ${r.k}: ${r.model} (${r.tier}) had ${r.confirmed} CONFIRMED findings, ${r.serious} serious${r.fix ? `; its fix round ended ${r.fix.verdict}` : ""}.`);
  return `${task.trimEnd()}\n\n## Earlier workers on this branch\n\nThe branch you start on holds earlier workers' commits for this task. Read \`git log\` and the diff from\nthe base before you change anything; keep what is right. Why you were called: ${reason}.\n\n${history.join("\n")}\n\n${findings}`;
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const [repo, start, ...rest] = process.argv.slice(2);
  if (!repo || !start) { console.error("usage: loop <repo> <run> [--spec FILE]... [--name N] [--max-rounds N] [--reviews RV1,RV2]"); process.exit(2); }
  const o = { specs: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = [rest[i], rest[i + 1]];
    if (k === "--spec") o.specs.push(path.resolve(v));
    else if (k === "--name") o.name = v;
    else if (k === "--max-rounds") o.maxRounds = v;
    else if (k === "--reviews") o.reviews = v.split(",").filter(Boolean);
    else { console.error(`loop: unknown option ${k}`); process.exit(2); }
  }
  const st = await loop(project(repo), start, o).catch((e) => { console.error(`loop: ${e.message}`); process.exit(1); });
  console.log(JSON.stringify({ loop: st.loop, last: st.last, next: st.next, reason: st.reason,
    rounds: st.rounds.map((r) => ({ k: r.k, run: r.run, tier: r.tier, confirmed: r.confirmed, serious: r.serious, fix: r.fix?.verdict ?? null })),
    escalations: st.escalations }, null, 2));
}

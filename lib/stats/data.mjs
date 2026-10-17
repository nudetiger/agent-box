// Reads the ledger (docs/ledger.md) and computes every metric the views show. Everything here is
// plain data: no styling. A metric without a denominator is null, never 0.
import { readFileSync, statSync } from "node:fs";
import { costOf } from "../prices.mjs";
export { costOf };

export function readLedger(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line[0] !== "{") continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.type !== "string") continue;
    const t = Date.parse(e.ts);
    // non-enumerable: `json run` prints the event exactly as written
    Object.defineProperty(e, "t", { value: Number.isFinite(t) ? t / 1000 : 0 });
    out.push(e);
  }
  return out;
}
export function ledgerStamp(file) {
  try { const s = statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return "none"; }
}

// ─── vocabulary ──────────────────────────────────────────────────────────────────────
export const OWNER = {
  ctx_missing: "orchestrator", spec_vague: "orchestrator", scope_too_narrow: "orchestrator",
  worker_careless: "worker", worker_scope_creep: "worker", worker_misreport: "worker", worker_ignored_rule: "worker",
  model_limit: "model", seal_correct: "harness", seal_too_tight: "harness", review_false_positive: "reviewer",
  env: "env", other: "other",
};
export const ownerOf = (cause) => OWNER[cause] ?? "other";
const EXEMPT = new Set(["SENSITIVE", "LEFTOVERS"]);
export const needsReason = (flag) => !EXEMPT.has(flag);
const BAD = new Set(["fail", "blocked", "error", "timeout"]);
const ACCEPTED = new Set(["accepted", "merged"]);

// ─── math ────────────────────────────────────────────────────────────────────────────
export const num = (x) => typeof x === "number" && Number.isFinite(x);
export const ratio = (a, b) => (b > 0 ? a / b : null);
const sum = (xs, f = (x) => x) => xs.reduce((n, x) => n + (num(f(x)) ? f(x) : 0), 0);
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function pctl(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)];
}
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function push(map, k, v) { const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); }
function groupBy(xs, f) { const m = new Map(); for (const x of xs) push(m, f(x), x); return m; }

// ─── runs ────────────────────────────────────────────────────────────────────────────
// A run is graded when its verdict says whether the work passed: not a review, not an explore.
export const isGraded = (r) => r.verdict != null && r.verdict !== "review" && r.mode !== "review" && r.mode !== "explore";
const hasTok = (r) => r.tokens && typeof r.tokens === "object";
export const tokIn = (r) => (r.tokens?.input ?? 0) + (r.tokens?.cache_read ?? 0);
export const tokOut = (r) => (r.tokens?.output ?? 0) + (r.tokens?.reasoning ?? 0);
export const flagNames = (r) => (Array.isArray(r.flags) ? r.flags.map((f) => (typeof f === "string" ? f : f?.flag)).filter(Boolean) : []);
export const hasFlag = (r, f) => flagNames(r).includes(f);
export const runKey = (r) => `${r.project}/${r.run}`;

// ─── scope: filters, window, indexes ─────────────────────────────────────────────────
const PRIMARY = new Set(["run", "review", "bench", "tests", "escalate", "land"]);
// Labels and outcomes are never dropped by model/role/harness: they attach to the items that are.
function keep(e, f) {
  if (f.project && e.project != null && e.project !== f.project) return false;
  if (!PRIMARY.has(e.type)) return true;
  if (f.model && e.model != null && e.model !== f.model) return false;
  if (f.role && e.role != null && e.role !== f.role) return false;
  if (f.harness && e.harness != null && e.harness !== f.harness) return false;
  return true;
}

export function scope(all, o, now) {
  const A = all.filter((e) => keep(e, o));
  let lo = now;
  for (const e of A) if (e.t && e.t < lo) lo = e.t;
  if (o.since > 0) lo = now - o.since;
  const D = {
    now, since: o.since, lo, o, A,
    E: A.filter((e) => e.t >= lo),
    P: o.since > 0 ? A.filter((e) => e.t >= lo - o.since && e.t < lo) : [],
    byId: new Map(), labels: new Map(), outcomes: new Map(), reviews: new Map(), bench: new Map(),
    runsByName: new Map(), firstRun: new Map(),
  };
  for (const e of A) {
    if (e.id) D.byId.set(String(e.id), e);
    if (e.type === "label") for (const ref of Array.isArray(e.refs) ? e.refs : []) push(D.labels, String(ref), e);
    else if (e.type === "outcome" && e.target_run) {
      for (const k of [String(e.target_run), `${e.project}/${e.target_run}`]) {
        const p = D.outcomes.get(k);
        if (!p || e.t >= p.t) D.outcomes.set(k, e);
      }
    } else if (e.type === "review" && e.target) push(D.reviews, `${e.project}/${e.target}`, e);
    else if (e.type === "bench" && e.target) push(D.bench, String(e.target), e);
    else if (e.type === "run") {
      if (e.run) { push(D.runsByName, String(e.run), e); push(D.runsByName, runKey(e), e); }
    }
  }
  D.firstRun = firstRuns(A.filter((e) => e.type === "run"));
  D.items = items(D, D.E);
  D.itemByRef = new Map(D.items.map((i) => [i.ref, i]));
  return D;
}

function firstRuns(runs) {
  const m = new Map();
  for (const r of runs) {
    if (!isGraded(r) || !r.task) continue;
    const k = `${r.project}/${r.task}`, p = m.get(k);
    if (!p || r.t < p.t) m.set(k, r);
  }
  return m;
}
// Passed without an auto-fix rescue: the harness's first test run was green.
export const firstPass = (r) => r.verdict === "pass" && (num(r.exits?.first_test) ? r.exits.first_test === 0 : !(r.autofix > 0));
// Share of tasks whose first run (in `first`) is in `runs` and passed on its first test run.
function firstTry(runs, first) {
  const set = new Set(runs);
  let n = 0, p = 0;
  for (const f of first.values()) if (set.has(f)) { n++; if (firstPass(f)) p++; }
  return { tasks: n, pass: p, rate: ratio(p, n) };
}

export const outcomeOf = (D, r) => D.outcomes.get(String(r.id)) ?? D.outcomes.get(runKey(r)) ?? null;
export const reviewsOf = (D, r) => [...(D.reviews.get(`${r.project}/agent/${r.run}`) ?? []), ...(D.reviews.get(`${r.project}/${r.run}`) ?? [])];
export function findRun(D, q) {
  if (!q) return null;
  const byId = D.byId.get(q);
  if (byId?.type === "run") return byId;
  const xs = D.runsByName.get(q) ?? [];
  return xs.reduce((a, b) => (!a || b.t >= a.t ? b : a), null);
}

// ─── labels and the items that need one ──────────────────────────────────────────────
// An orchestrator label overrides any other on the same ref; otherwise the newest wins.
function resolve(ls) {
  if (!ls.length) return null;
  const newest = (xs) => xs.reduce((a, b) => (b.t >= a.t ? b : a));
  const orch = ls.filter((l) => l.source === "orchestrator"), wrk = ls.filter((l) => l.source === "worker");
  return { eff: orch.length ? newest(orch) : newest(ls), orch: orch.length ? newest(orch) : null, worker: wrk.length ? newest(wrk) : null, all: ls };
}
function labelsFor(D, keys) {
  const seen = new Set(), out = [];
  for (const k of keys) for (const l of D.labels.get(k) ?? []) if (!seen.has(l)) { seen.add(l); out.push(l); }
  return out;
}

export function items(D, X) {
  const out = [];
  const add = (ev, suffix, kind, what, detail, extraKeys = [], extra = []) => {
    const ref = suffix == null ? String(ev.id) : `${ev.id}#${suffix}`;
    out.push({ ref, kind, what, detail: detail ?? null, ev, lab: resolve([...labelsFor(D, [ref, ...extraKeys]), ...extra]) });
  };
  for (const e of X) {
    if (e.type === "run") {
      for (const f of Array.isArray(e.flags) ? e.flags : []) {
        const flag = typeof f === "string" ? f : f?.flag;
        if (flag && needsReason(flag)) add(e, flag, "flag", flag, f?.detail);
      }
      if (BAD.has(e.verdict)) add(e, "verdict", "verdict", e.verdict, null, [`${e.id}#${e.verdict}`]);
    } else if (e.type === "review") {
      for (const f of Array.isArray(e.findings) ? e.findings : []) {
        if (f?.n == null) continue;
        add(e, f.n, "finding", [f.severity, f.category].filter(Boolean).join(" ") || "finding", f.issue);
        out[out.length - 1].finding = f;
      }
    } else if (e.type === "outcome" && e.result === "rejected") {
      // the outcome's own cause is the orchestrator's label on it
      const own = e.cause ? [{ cause: e.cause, source: "orchestrator", why: e.why, t: e.t, id: e.id, refs: [String(e.id)] }] : [];
      add(e, null, "outcome", "rejected", e.target_run ? `run ${e.target_run}` : null, [`${e.id}#rejected`], own);
    }
  }
  return out;
}

// ─── metrics ─────────────────────────────────────────────────────────────────────────
export function runStats(D, runs, first = D.firstRun) {
  const g = runs.filter(isGraded);
  const pass = g.filter((r) => r.verdict === "pass").length;
  const secs = runs.map((r) => r.seconds?.total).filter(num);
  const tk = runs.filter(hasTok);
  const input = sum(tk, (r) => r.tokens.input), cr = sum(tk, (r) => r.tokens.cache_read);
  const steps = runs.map((r) => r.steps).filter(num);
  const ms = runs.filter((r) => num(r.steps) && r.steps > 0 && num(r.seconds?.agent) && num(r.tool_s));
  const oc = runs.map((r) => outcomeOf(D, r)).filter(Boolean);
  const acc = oc.filter((o) => ACCEPTED.has(o.result)).length;
  const priced = runs.filter((r) => costOf(r) != null);
  const reported = runs.filter((r) => r.report && typeof r.report === "object");
  const nflags = sum(runs, (r) => flagNames(r).length);
  const asked = runs.filter((r) => num(r.questions?.asked));
  const ft = firstTry(runs, first);
  const fixed = runs.filter((r) => r.autofix > 0);
  const tin = tk.length ? sum(tk, tokIn) : null, tout = tk.length ? sum(tk, tokOut) : null;
  return {
    runs: runs.length, graded: g.length, pass, passRate: ratio(pass, g.length),
    firstTryTasks: ft.tasks, firstTryPass: ft.pass, firstTry: ft.rate,
    avgSecs: avg(secs), p50Secs: pctl(secs, 0.5), p90Secs: pctl(secs, 0.9),
    steps: avg(steps), modelSecsPerStep: ratio(sum(ms, (r) => r.seconds.agent - r.tool_s), sum(ms, (r) => r.steps)),
    tokensIn: tin, tokensOut: tout, tokens: tk.length ? tin + tout : null,
    avgTokensIn: tk.length ? tin / tk.length : null, avgTokensOut: tk.length ? tout / tk.length : null,
    avgTokens: tk.length ? (tin + tout) / tk.length : null,
    cacheHit: ratio(cr, input + cr),
    flags: nflags, flagsPerRun: ratio(nflags, runs.length),
    questions: asked.length ? sum(asked, (r) => r.questions.asked) : null,
    outcomes: oc.length, accepted: acc, rejected: oc.filter((o) => o.result === "rejected").length,
    discarded: oc.filter((o) => o.result === "discarded").length, acceptedRate: ratio(acc, oc.length),
    cost: priced.length ? sum(priced, (r) => costOf(r)) : null, priced: priced.length,
    autofixed: fixed.length, rescued: fixed.filter((r) => r.verdict === "pass").length,
    rescueRate: ratio(fixed.filter((r) => r.verdict === "pass").length, fixed.length),
    misreport: ratio(runs.filter((r) => hasFlag(r, "MISREPORT")).length, reported.length),
  };
}

export function kpis(D, X) {
  const runs = X.filter((e) => e.type === "run");
  const its = X === D.E ? D.items : items(D, X);
  return { ...runStats(D, runs), unlabeled: its.filter((i) => !i.lab).length, needReason: its.length };
}

export function modelRows(D) {
  const runs = D.E.filter((e) => e.type === "run");
  return [...groupBy(runs, (r) => `${r.role ?? ""}\u0000${r.model ?? ""}`).values()]
    .map((rs) => ({ role: rs[0].role ?? null, model: rs[0].model ?? null, ...runStats(D, rs) }))
    .sort((a, b) => String(a.role ?? "~").localeCompare(String(b.role ?? "~")) || String(a.model).localeCompare(String(b.model)));
}

function buckets(D, ts, n = 14) {
  const span = Math.max(D.now - D.lo, 3600), b = span / n, out = Array(n).fill(0);
  for (const t of ts) out[Math.min(n - 1, Math.max(0, Math.floor((t - D.lo) / b)))]++;
  return out;
}

export function flagRows(D) {
  const m = new Map();
  for (const r of D.E) {
    if (r.type !== "run") continue;
    for (const flag of new Set(flagNames(r))) {
      let x = m.get(flag);
      if (!x) m.set(flag, (x = { flag, n: 0, needsReason: needsReason(flag), ts: [], causes: {}, unlabeled: 0 }));
      x.n++;
      x.ts.push(r.t);
      if (!x.needsReason) continue;
      const it = D.itemByRef.get(`${r.id}#${flag}`);
      if (it?.lab) x.causes[it.lab.eff.cause] = (x.causes[it.lab.eff.cause] ?? 0) + 1;
      else x.unlabeled++;
    }
  }
  const total = D.E.filter((e) => e.type === "run").length;
  return [...m.values()].map(({ ts, ...x }) => ({ ...x, perRun: ratio(x.n, total), trend: buckets(D, ts) }))
    .sort((a, b) => b.n - a.n || a.flag.localeCompare(b.flag));
}

export function causeRows(D) {
  const lab = D.items.filter((i) => i.lab);
  const total = lab.length;
  return [...groupBy(lab, (i) => i.lab.eff.cause ?? "other").entries()].map(([cause, xs]) => {
    const both = xs.filter((i) => i.lab.orch && i.lab.worker && i.lab.orch !== i.lab.worker);
    return {
      cause, owner: ownerOf(cause), n: xs.length, share: ratio(xs.length, total),
      bySource: { orchestrator: xs.filter((i) => i.lab.eff.source === "orchestrator").length,
        worker: xs.filter((i) => i.lab.eff.source === "worker").length, auto: xs.filter((i) => i.lab.eff.source === "auto").length },
      agreeOf: both.length, agree: ratio(both.filter((i) => i.lab.orch.cause === i.lab.worker.cause).length, both.length),
      trend: buckets(D, xs.map((i) => i.ev.t)),
    };
  }).sort((a, b) => b.n - a.n || a.cause.localeCompare(b.cause));
}

// The worker's own context gaps (`<run id>#context`, never an item that needs a reason).
export function contextGaps(D, X) {
  const out = [];
  for (const e of X) {
    if (e.type !== "label") continue;
    for (const ref of Array.isArray(e.refs) ? e.refs.map(String) : []) {
      if (!ref.endsWith("#context")) continue;
      const r = D.byId.get(ref.slice(0, -8));
      const gaps = String(e.why ?? "").split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean);
      out.push({ ref, project: r?.project ?? e.project ?? null, run: r?.run ?? e.run ?? null, model: r?.model ?? e.model ?? null, t: e.t, gaps });
    }
  }
  return out;
}
export function contextByProject(D) {
  return [...groupBy(contextGaps(D, D.E), (c) => c.project ?? "?").entries()]
    .map(([project, xs]) => ({ project, runs: xs.length, gaps: xs.reduce((n, x) => n + x.gaps.length, 0),
      perRun: ratio(xs.length, D.E.filter((e) => e.type === "run" && (e.project ?? "?") === project).length) }))
    .sort((a, b) => b.gaps - a.gaps);
}

export function notes(D, cause) {
  const out = [];
  for (const e of D.E) {
    const why = typeof e.why === "string" ? e.why.trim() : "";
    if (!why || (cause && e.cause !== cause)) continue;
    if (e.type !== "label" && !(e.type === "outcome" && e.cause)) continue;
    const refs = e.type === "label" ? (Array.isArray(e.refs) ? e.refs.map(String) : []) : [String(e.id)];
    const target = e.type === "outcome" ? findRun(D, `${e.project}/${e.target_run}`) ?? findRun(D, String(e.target_run))
      : D.byId.get(String(refs[0] ?? "").split("#")[0]);
    out.push({ id: e.id ?? null, ts: e.ts, t: e.t, type: e.type, cause: e.cause ?? null, owner: ownerOf(e.cause), source: e.source ?? (e.type === "outcome" ? "orchestrator" : null),
      refs, project: target?.project ?? e.project ?? null, run: target?.run ?? e.run ?? null, why });
  }
  return out.sort((a, b) => b.t - a.t);
}

export function reviewStats(D, X) {
  const revs = X.filter((e) => e.type === "review");
  const fs = [];
  for (const r of revs) for (const f of Array.isArray(r.findings) ? r.findings : []) {
    if (!f) continue;
    const it = D.itemByRef.get(`${r.id}#${f.n}`) ?? items(D, [r]).find((i) => i.ref === `${r.id}#${f.n}`);
    fs.push({ r, f, lab: it?.lab ?? null });
  }
  const stat = (fx, rx) => {
    const labeled = fx.filter((x) => x.lab);
    const fp = labeled.filter((x) => x.lab.eff.cause === "review_false_positive").length;
    const conf = fx.filter((x) => String(x.f.confidence).toUpperCase() === "CONFIRMED").length;
    return {
      reviews: rx.length, clean: rx.filter((r) => r.verdict === "clean").length, cleanRate: ratio(rx.filter((r) => r.verdict === "clean").length, rx.length),
      findings: fx.length, perReview: ratio(fx.length, rx.length), confirmed: conf, confirmedRate: ratio(conf, fx.length),
      labeled: labeled.length, falsePositive: fp, fpRate: ratio(fp, labeled.length), unlabeled: fx.length - labeled.length,
    };
  };
  const count = (key) => [...groupBy(fs, (x) => x.f[key] ?? "?").entries()]
    .map(([k, xs]) => ({ [key]: k, n: xs.length, falsePositive: xs.filter((x) => x.lab?.eff.cause === "review_false_positive").length }))
    .sort((a, b) => b.n - a.n);
  return {
    ...stat(fs, revs),
    byModel: [...groupBy(revs, (r) => r.model ?? null).entries()].map(([model, rx]) => ({ model, ...stat(fs.filter((x) => rx.includes(x.r)), rx) }))
      .sort((a, b) => b.reviews - a.reviews),
    bySeverity: count("severity"), byCategory: count("category"),
  };
}

export function benchData(D, X) {
  const at = X.filter((e) => e.type === "bench").map((b) => {
    const r = D.byId.get(String(b.target)) ?? null;
    const expect = b.expect ?? r?.bench?.expect ?? null;
    return {
      suite: b.suite ?? r?.bench?.suite ?? null, task: b.task ?? r?.bench?.task ?? null, model: r?.model ?? b.model ?? null,
      harness: r?.harness ?? b.harness ?? null, pass: b.pass === true, t: b.t, run: r?.run ?? null,
      secs: num(r?.seconds?.total) ? r.seconds.total : null,
      tokens: r && hasTok(r) ? tokIn(r) + tokOut(r) : null, expect,
      honest: expect === "blocked" && r ? r.verdict === "blocked" || /^blocked$/i.test(String(r.report?.status ?? "")) : null,
    };
  }).sort((a, b) => a.t - b.t);
  const med = (xs, k) => median(xs.map((x) => x[k]).filter(num));
  const mean = (xs, k) => avg(xs.map((x) => x[k]).filter(num));
  const tasks = [...groupBy(at, (a) => `${a.suite ?? "?"}/${a.task ?? "?"}`).entries()].map(([key, xs]) => {
    const byModel = {};
    for (const x of xs) (byModel[x.model ?? "?"] ??= []).push(x.pass);
    return { key, suite: xs[0].suite, task: xs[0].task, expect: xs.find((x) => x.expect)?.expect ?? null, attempts: xs.length,
      pass: xs.filter((x) => x.pass).length, rate: ratio(xs.filter((x) => x.pass).length, xs.length),
      medSecs: med(xs, "secs"), medTokens: med(xs, "tokens"), byModel };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const models = [...groupBy(at, (a) => a.model ?? "?").entries()].map(([model, xs]) => {
    const eb = xs.filter((x) => x.honest != null);
    return { model, tasks: new Set(xs.map((x) => `${x.suite}/${x.task}`)).size, attempts: xs.length,
      pass: xs.filter((x) => x.pass).length, rate: ratio(xs.filter((x) => x.pass).length, xs.length),
      expectBlocked: eb.length, honest: eb.filter((x) => x.honest).length, honesty: ratio(eb.filter((x) => x.honest).length, eb.length),
      avgSecs: mean(xs, "secs"), avgTokens: mean(xs, "tokens") };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.attempts - a.attempts);
  const harness = [...groupBy(at, (a) => a.harness ?? "?").entries()].map(([h, xs]) => ({
    harness: h, first: Math.min(...xs.map((x) => x.t)), attempts: xs.length, pass: xs.filter((x) => x.pass).length,
    rate: ratio(xs.filter((x) => x.pass).length, xs.length), medSecs: med(xs, "secs"), medTokens: med(xs, "tokens"),
  })).sort((a, b) => a.first - b.first);
  return { attempts: at.length, pass: at.filter((x) => x.pass).length, rate: ratio(at.filter((x) => x.pass).length, at.length), tasks, models, harness };
}

export function compare(D, a, b) {
  const runs = D.A.filter((e) => e.type === "run" && e.harness != null);
  const versions = [...groupBy(runs, (r) => r.harness).entries()].map(([harness, rs]) => ({
    harness, first: Math.min(...rs.map((r) => r.t)), last: Math.max(...rs.map((r) => r.t)), runs: rs.length,
    projects: [...new Set(rs.map((r) => r.project))].length,
  })).sort((x, y) => x.first - y.first);
  const A = a || versions.at(-2)?.harness || null, B = b || versions.at(-1)?.harness || null;
  const metric = (v) => {
    const rs = runs.filter((r) => r.harness === v);
    const s = runStats(D, rs, firstRuns(rs));
    const bd = benchData(D, D.A.filter((e) => e.type === "bench" && (D.byId.get(String(e.target))?.harness ?? e.harness) === v));
    return { runs: s.runs, passRate: s.passRate, firstTry: s.firstTry, avgSecs: s.avgSecs, steps: s.steps, avgTokens: s.avgTokens,
      cacheHit: s.cacheHit, flagsPerRun: s.flagsPerRun, misreport: s.misreport, benchRate: bd.rate, benchAttempts: bd.attempts };
  };
  return { versions, a: A, b: B, ready: !!(A && B && A !== B), A: A ? metric(A) : null, B: B ? metric(B) : null };
}

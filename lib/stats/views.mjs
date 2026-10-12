// Every view is build(D, arg) → plain model (what `json <view>` prints) and draw(model, sel) → lines.
// A drawable view also returns `keys`: one per selectable row, what Enter drills into.
import * as d from "./data.mjs";
import {
  ui, wide, S, T, cat, segw, clip, padr, padl, rep, fdur, fnum, fpct, fdec, fcost, ftime, fago, shortModel,
  grade, gradeLow, bar, spark, delta, table, flow, box, section, kv, note, markdown, DASH,
} from "./style.mjs";
import { liveModel, drawLive } from "./live.mjs";

const OWNER_STYLE = { orchestrator: "warn", worker: "bad", harness: "violet", reviewer: "teal", model: "orange", env: "dim", other: "dim" };
const causeStyle = (c) => OWNER_STYLE[d.ownerOf(c)];
const sevRank = (x) => { const i = ["critical", "high", "medium", "low"].indexOf(x); return i < 0 ? 9 : i; };
const VERDICT = { pass: "good", fail: "bad", blocked: "warn", no_change: "dim", error: "bad", timeout: "warn", setup_failed: "bad", weak_spec: "warn", review: "teal" };
const OUTCOME = { accepted: "good", merged: "good", rejected: "bad", discarded: "warn" };
const HINT = {
  ctx_missing: "give the worker the files and docs it needed", spec_vague: "tighten the task, seal a test",
  scope_too_narrow: "widen files: / scope:", worker_careless: "worker checklist, tests first",
  worker_scope_creep: "smaller task, scope rule in the preamble", worker_misreport: "distrust this model's report",
  worker_ignored_rule: "preamble rule, or a stronger model", model_limit: "route this kind of task to a stronger model",
  seal_correct: "keep the seal, fix the prompt", seal_too_tight: "loosen the seal rule",
  review_false_positive: "reviewer prompt, or another reviewer", env: "harness, quota or tooling fix", other: "promote to a cause if it recurs",
};
// <repo> is the repo folder; its lowercase name is the ledger's project
const noteCmd = (project, run, ref = "<ref>") => `delegate.sh note ${project ?? "<repo>"} ${run ?? "<run>"} --refs ${ref} --cause <cause> --why "..."`;
const trustCmd = (project, run) => `delegate.sh accept|reject ${project ?? "<repo>"} ${run ?? "<run>"} --why "..."`;

// ─── header ──────────────────────────────────────────────────────────────────────────
function windowName(since) {
  if (!since) return "all time";
  if (since % 86400 === 0) return `last ${since / 86400}d`;
  if (since % 3600 === 0) return `last ${since / 3600}h`;
  return `last ${fdur(since)}`;
}
const iso = (t) => (t ? new Date(t * 1000).toISOString().replace(/\.\d+Z$/, "Z") : null);
export function scopeModel(D) {
  return { project: D.o.project || null, window: windowName(D.since), since: D.since, from: iso(D.lo), to: iso(D.now),
    model: D.o.model || null, role: D.o.role || null, harness: D.o.harness || null };
}
export const scopeText = (s) => [s.project ?? "all projects", s.window, s.model && `model ${s.model}`, s.role && `role ${s.role}`, s.harness && `harness ${s.harness}`]
  .filter(Boolean).join(" · ");

const header = (D) => ({ scope: scopeModel(D), kpis: d.kpis(D, D.E), prev: D.since > 0 ? d.kpis(D, D.P) : null });
function drawHeader(h) {
  const k = h.kpis, p = h.prev ?? {}, iw = ui.WW - 5;
  const lines = [
    ...flow([
      cat(kv("runs", String(k.runs)), delta(k.runs, p.runs || null, true, "%")),
      cat(kv("pass", fpct(k.passRate), grade(k.passRate, 0.8, 0.5) + "+b"), S("dim", k.graded ? ` ${k.pass}/${k.graded}` : ""), delta(k.passRate, p.passRate, true, "pt")),
      cat(kv("first try", fpct(k.firstTry), grade(k.firstTry, 0.7, 0.4) + "+b"), S("dim", k.firstTryTasks ? ` ${k.firstTryPass}/${k.firstTryTasks} tasks` : ""), delta(k.firstTry, p.firstTry, true, "pt")),
      cat(kv("avg time", fdur(k.avgSecs)), delta(k.avgSecs, p.avgSecs, false, "%")),
    ], iw),
    ...flow([
      cat(kv("tokens", fnum(k.tokens)), S("dim", k.tokens != null ? ` (${fnum(k.tokensIn)} in · ${fnum(k.tokensOut)} out)` : ""), delta(k.tokens, p.tokens, false, "%")),
      cat(kv("cache hit", fpct(k.cacheHit), grade(k.cacheHit, 0.7, 0.4) + "+b"), delta(k.cacheHit, p.cacheHit, true, "pt")),
      cat(kv("cost", fcost(k.cost)), S("dim", k.runs ? ` ${k.priced}/${k.runs} runs priced` : "")),
    ], iw),
    ...flow([
      cat(kv("flags", String(k.flags), k.flags ? "warn+b" : "text+b"), delta(k.flagsPerRun, p.flagsPerRun, false, "%")),
      cat(kv("unlabeled", String(k.unlabeled), k.unlabeled ? "warn+b" : k.needReason ? "good+b" : "text+b"), S("warn", k.unlabeled ? " ⚑" : "")),
      cat(kv("accepted", String(k.accepted), k.accepted ? "good+b" : "text+b"), S("dim", k.outcomes ? ` ${fpct(k.acceptedRate)} of ${k.outcomes}` : ""), delta(k.acceptedRate, p.acceptedRate, true, "pt")),
      kv("rejected", String(k.rejected), k.rejected ? "bad+b" : "text+b"),
      kv("questions", k.questions == null ? DASH : String(k.questions)),
    ], iw),
  ];
  return box(S("accent+b", "◢◤ agent-box"), S("dim", scopeText(h.scope)), lines);
}

// ─── shared pieces ───────────────────────────────────────────────────────────────────
const modelCell = (m) => (m == null ? S("faint", DASH) : S("text", shortModel(m)));
const roleCell = (r) => (r == null ? S("faint", "--model") : S("accent", r));
const pctCell = (r, good, ok, low = false) => S((low ? gradeLow : grade)(r, good, ok), fpct(r));
const selPrefix = (on) => (on ? S("accent+b", "▸ ") : T("  "));
function markSel(line, on) { if (on) line.sel = true; return line; }

function flagBars(rows, sel, limit = Infinity) {
  if (!rows.length) return [note("good", "✓ no flags in this window")];
  const m = Math.max(...rows.map((r) => r.n));
  const bw = Math.max(Math.min(Math.round((ui.WW - 45) * 0.45), 36), 12);
  return rows.slice(0, limit).map((r, k) => {
    const st = r.needsReason ? "warn" : "dim";
    const causes = Object.entries(r.causes).sort((a, b) => b[1] - a[1]);
    const why = !r.needsReason ? [S("faint", "no reason needed")] : [
      ...causes.map(([c, n]) => cat(S(causeStyle(c), "● "), S("dim", `${c} ${n}`))),
      ...(r.unlabeled ? [S("warn", `unlabeled ${r.unlabeled}`)] : []),
    ];
    return markSel(cat("  ", padr(cat(selPrefix(k === sel), S("text", r.flag)), 20), bar(r.n, m, bw, st), padl(S("text+b", String(r.n)), 5), "  ",
      spark(r.trend, st), "  ", ...why.flatMap((w, i) => [i ? S("faint", " · ") : [], w])), k === sel);
  });
}

function causeBars(rows, sel, limit = Infinity) {
  if (!rows.length) return [note("dim", "no reasons recorded yet · stats unlabeled lists what needs one")];
  const m = Math.max(...rows.map((r) => r.n));
  const bw = Math.max(Math.min(Math.round((ui.WW - 56) * 0.5), 36), 10);
  return rows.slice(0, limit).map((r, k) => {
    const cs = OWNER_STYLE[r.owner];
    return markSel(cat("  ", padr(cat(selPrefix(k === sel), S(cs, "● "), S("text", r.cause)), 27), bar(r.n, m, bw, cs),
      padl(S("text+b", String(r.n)), 5), padl(S("dim", fpct(r.share)), 6), "  ",
      spark(r.trend, cs), "  ", r.agree == null ? S("faint", "no worker view")
        : cat(bar(r.agree, 1, 6, grade(r.agree, 0.75, 0.5)), S(grade(r.agree, 0.75, 0.5), ` ${fpct(r.agree)} agree`), S("faint", ` of ${r.agreeOf}`))), k === sel);
  });
}
const ownersLegend = () => cat("   ", ...["orchestrator", "worker", "model", "harness", "reviewer", "env"]
  .flatMap((o, i) => [i ? "   " : [], S(OWNER_STYLE[o], "●"), " ", S("dim", o)]));

function reviewLine(s, p) {
  return flow([
    kv("reviews", String(s.reviews)), kv("findings", String(s.findings)),
    cat(kv("confirmed", fpct(s.confirmedRate), grade(s.confirmedRate, 0.6, 0.3) + "+b")),
    cat(kv("false positive", fpct(s.fpRate), gradeLow(s.fpRate, 0.2, 0.4) + "+b"), S("dim", s.labeled ? ` of ${s.labeled} labeled` : ""), delta(s.fpRate, p?.fpRate, false, "pt")),
    s.unlabeled ? kv("unlabeled", String(s.unlabeled), "warn+b") : null,
  ].filter(Boolean), ui.WW - 4).map((l) => cat("   ", l));
}

function modelsTable(rows, sel, compact) {
  const cols = compact
    ? [{ h: "role", w: 13 }, { h: "model", flex: 14 }, { h: "runs", w: 4, a: "r" }, { h: "pass", w: 18 },
      { h: "avg", w: 6, a: "r", drop: 2 }, { h: "tokens", w: 6, a: "r", drop: 4 }, { h: "cache", w: 5, a: "r", drop: 3 },
      { h: "flg/r", w: 5, a: "r", drop: 5 }, { h: "acc", w: 4, a: "r", drop: 1 }]
    : [{ h: "role", w: 12 }, { h: "model", flex: 14 }, { h: "runs", w: 4, a: "r" }, { h: "pass", w: 4, a: "r" },
      { h: "avg", w: 6, a: "r" }, { h: "p50", w: 6, a: "r", drop: 8.5 }, { h: "p90", w: 6, a: "r", drop: 3 },
      { h: "steps", w: 5, a: "r", drop: 4 }, { h: "s/step", w: 6, a: "r", drop: 6 }, { h: "rescue", w: 6, a: "r", drop: 5.5 }, { h: "tok in/out", w: 10, a: "r", drop: 7 },
      { h: "cache", w: 5, a: "r", drop: 2 }, { h: "flg/r", w: 5, a: "r", drop: 1 },
      { h: "q", w: 3, a: "r", drop: 4.5 }, { h: "acc", w: 4, a: "r" }];
  return table(cols, rows.map((r) => compact
    ? [roleCell(r.role), modelCell(r.model), String(r.runs),
      { bar: r.passRate ?? 0, max: 1, style: grade(r.passRate, 0.8, 0.5), suffix: padl(S(grade(r.passRate, 0.8, 0.5) + "+b", fpct(r.passRate)), 5) },
      fdur(r.avgSecs), fnum(r.tokens), pctCell(r.cacheHit, 0.7, 0.4), S(gradeLow(r.flagsPerRun, 0.2, 0.6), fdec(r.flagsPerRun)), pctCell(r.acceptedRate, 0.8, 0.5)]
    : [roleCell(r.role), modelCell(r.model), String(r.runs), pctCell(r.passRate, 0.8, 0.5), fdur(r.avgSecs), fdur(r.p50Secs), fdur(r.p90Secs),
      fdec(r.steps), fdec(r.modelSecsPerStep), r.autofixed ? S(grade(r.rescueRate, 0.6, 0.3), `${r.rescued}/${r.autofixed}`) : null, r.avgTokensIn == null ? null : cat(S("text", fnum(r.avgTokensIn)), S("faint", "/"), S("dim", fnum(r.avgTokensOut))), pctCell(r.cacheHit, 0.7, 0.4),
      S(gradeLow(r.flagsPerRun, 0.2, 0.6), fdec(r.flagsPerRun)), r.questions == null ? null : String(r.questions), pctCell(r.acceptedRate, 0.8, 0.5)]), sel);
}

function runRows(D, filter = {}) {
  const unl = new Map();
  for (const i of D.items) if (!i.lab && i.ev.type === "run") unl.set(i.ev, (unl.get(i.ev) ?? 0) + 1);
  return D.E.filter((e) => e.type === "run")
    .filter((r) => !filter.flag || d.hasFlag(r, filter.flag))
    .filter((r) => !("model" in filter) || (r.model ?? null) === filter.model)
    .filter((r) => !("role" in filter) || (r.role ?? null) === filter.role)
    .sort((a, b) => b.t - a.t)
    .map((r) => ({ id: r.id ?? null, run: r.run ?? null, project: r.project ?? null, role: r.role ?? null, model: r.model ?? null,
      mode: r.mode ?? null, verdict: r.verdict ?? null, secs: d.num(r.seconds?.total) ? r.seconds.total : null,
      steps: d.num(r.steps) ? r.steps : null, tokens: r.tokens ? d.tokIn(r) + d.tokOut(r) : null, flags: d.flagNames(r),
      outcome: d.outcomeOf(D, r)?.result ?? null, unlabeled: unl.get(r) ?? 0, ts: r.ts ?? null }));
}
function runsTable(rows, sel) {
  return table([{ h: "run", flex: 12 }, { h: "project", w: 9, drop: 4 }, { h: "role", w: 11, drop: 3 }, { h: "model", w: 17, min: 13, shrink: 1.5 },
    { h: "mode", w: 9, drop: 7 }, { h: "verdict", w: 9 }, { h: "time", w: 6, a: "r" }, { h: "steps", w: 5, a: "r", drop: 6.5 },
    { h: "tokens", w: 6, a: "r", drop: 2 }, { h: "flags", w: 5, a: "r" }, { h: "outcome", w: 9, drop: 1 }, { h: "unl", w: 3, a: "r" },
    { h: "started", w: 11, drop: 6 }],
  rows.map((r) => [S("text", r.run ?? r.id), S("dim", r.project ?? DASH), roleCell(r.role), modelCell(r.model), S("dim", r.mode ?? DASH),
    S(VERDICT[r.verdict] ?? "dim", r.verdict ?? DASH), fdur(r.secs), r.steps == null ? null : String(r.steps), fnum(r.tokens),
    r.flags.length ? S("warn", `⚑ ${r.flags.length}`) : S("faint", "·"), r.outcome ? S(OUTCOME[r.outcome] ?? "dim", r.outcome) : S("faint", "·"),
    r.unlabeled ? S("warn+b", String(r.unlabeled)) : S("faint", "0"), S("dim", ftime(Date.parse(r.ts) / 1000))]), sel);
}

// ─── views ───────────────────────────────────────────────────────────────────────────
const V = {};

V.overview = {
  build: (D) => {
    const rv = d.reviewStats(D, D.E), bd = d.benchData(D, D.E);
    return { header: header(D), models: d.modelRows(D), flags: d.flagRows(D), causes: d.causeRows(D),
      reviews: (({ byModel, bySeverity, byCategory, ...s }) => s)(rv), reviewsPrev: D.since > 0 ? (({ byModel, bySeverity, byCategory, ...s }) => s)(d.reviewStats(D, D.P)) : null,
      bench: { attempts: bd.attempts, pass: bd.pass, rate: bd.rate, tasks: bd.tasks.length, models: bd.models.length, best: bd.models[0] ?? null } };
  },
  draw: (m) => {
    const b = m.bench;
    return { lines: [
      ...drawHeader(m.header),
      ...section("models", "pass = verdict pass / graded runs · acc = accepted outcomes · models tab: details"),
      ...modelsTable(m.models, -1, true),
      ...section("flags", "evidence the harness computed · flags tab: trends and runs"),
      ...flagBars(m.flags, -1, 6),
      ...section("causes", "why things failed, by who it points at"),
      ...causeBars(m.causes, -1, 6), ownersLegend(),
      ...section("review", "confirmed = reviewer's own confidence · false positive = labeled review_false_positive"),
      ...reviewLine(m.reviews, m.reviewsPrev),
      ...section("bench", "hidden checks the worker never saw"),
      ...(b.attempts ? flow([kv("attempts", String(b.attempts)), cat(kv("pass", fpct(b.rate), grade(b.rate, 0.7, 0.4) + "+b"), S("dim", ` ${b.pass}/${b.attempts}`)),
        kv("tasks", String(b.tasks)), kv("models", String(b.models)),
        b.best ? cat(S("dim", "best "), S("accent+b", shortModel(b.best.model)), S("dim", ` ${fpct(b.best.rate)}`)) : []], ui.WW - 4).map((l) => cat("   ", l))
        : [note("dim", "no bench attempts in this window")]),
    ] };
  },
};

V.models = {
  build: (D) => {
    const runs = D.E.filter((e) => e.type === "run");
    const vs = {};
    for (const r of runs) vs[r.verdict ?? "none"] = (vs[r.verdict ?? "none"] ?? 0) + 1;
    return { header: header(D), models: d.modelRows(D), verdicts: Object.entries(vs).map(([verdict, n]) => ({ verdict, n })).sort((a, b) => b.n - a.n) };
  },
  draw: (m, sel) => {
    const max = Math.max(0, ...m.verdicts.map((v) => v.n));
    return { keys: m.models.map((r) => ({ view: "runs", arg: { role: r.role, model: r.model }, label: `${r.role ?? "--model"} ${shortModel(r.model)}` })), lines: [
      ...drawHeader(m.header),
      ...section("by role and model", "s/step = (agent − tool s) / steps · rescue = auto-fixed runs that passed · tok per run · enter: runs"),
      ...modelsTable(m.models, sel, false),
      ...section("verdicts", ""),
      ...(m.verdicts.length ? m.verdicts.map((v) => cat("    ", padr(S(VERDICT[v.verdict] ?? "dim", v.verdict), 14), bar(v.n, max, Math.min(40, ui.WW - 30), VERDICT[v.verdict] ?? "dim"), padl(S("text+b", String(v.n)), 6)))
        : [note("dim", "no runs in this window")]),
    ] };
  },
};

V.runs = {
  build: (D, arg) => ({ header: header(D), filter: arg ?? {}, runs: runRows(D, arg ?? {}) }),
  draw: (m, sel) => {
    const f = m.filter, what = [f.flag && `flag ${f.flag}`, "role" in f && `role ${f.role ?? "--model"}`, "model" in f && `model ${shortModel(f.model)}`].filter(Boolean).join(" · ");
    return { keys: m.runs.map((r) => ({ view: "run", arg: r.id ?? `${r.project}/${r.run}`, label: r.run })), lines: [
      ...drawHeader(m.header),
      ...section(what ? `runs · ${what}` : "runs", `${m.runs.length} · newest first · enter: everything about a run`),
      ...runsTable(m.runs, sel),
    ] };
  },
};

V.run = {
  build: (D, q) => {
    const r = d.findRun(D, q);
    if (!r) return { query: q ?? null, found: false };
    const its = d.items(D, [r]);
    const lab = (ref) => its.find((i) => i.ref === ref)?.lab;
    const labelOut = (l) => l && { cause: l.eff.cause ?? null, source: l.eff.source ?? null, why: l.eff.why ?? null,
      worker: l.worker?.cause ?? null, orchestrator: l.orch?.cause ?? null };
    const o = d.outcomeOf(D, r);
    const flags = (Array.isArray(r.flags) ? r.flags : []).map((f) => {
      const flag = typeof f === "string" ? f : f?.flag;
      return { flag, detail: f?.detail ?? null, needsReason: d.needsReason(flag), label: labelOut(lab(`${r.id}#${flag}`)) ?? null };
    });
    const reviews = d.reviewsOf(D, r).map((v) => {
      const vi = d.items(D, [v]);
      return { id: v.id, run: v.run ?? null, model: v.model ?? null, verdict: v.verdict ?? null, ts: v.ts,
        findings: (Array.isArray(v.findings) ? v.findings : []).map((f) => ({ ...f, label: labelOut(vi.find((i) => i.ref === `${v.id}#${f.n}`)?.lab) ?? null })) };
    });
    const bench = (D.bench.get(String(r.id)) ?? []).map((b) => ({ suite: b.suite, task: b.task, pass: b.pass, check_exit: b.check_exit, check_s: b.check_s, expect: b.expect ?? null }));
    const needs = [...its, ...reviews.flatMap((v) => d.items(D, [D.byId.get(String(v.id))].filter(Boolean)))]
      .filter((i) => !i.lab).map((i) => ({ ref: i.ref, kind: i.kind, what: i.what, project: i.ev.project ?? null, run: i.ev.run ?? null,
        command: noteCmd(i.ev.project, i.ev.run, i.ref) }));
    const relabels = [...new Set(its.flatMap((i) => i.lab?.all ?? []))].map((l) => ({ id: l.id ?? null, ts: l.ts ?? null, refs: l.refs ?? [], cause: l.cause ?? null, source: l.source ?? null, why: l.why ?? null }));
    const ctx = d.contextGaps(D, D.A.filter((e) => e.type === "label")).filter((c) => c.ref === `${r.id}#context`);
    return { query: q, found: true, event: r, contextGaps: [...new Set(ctx.flatMap((c) => c.gaps))], trust: o ? null : trustCmd(r.project, r.run), verdictLabel: labelOut(its.find((i) => i.kind === "verdict")?.lab) ?? null, flags, labels: relabels, reviews,
      outcome: o ? { result: o.result, cause: o.cause ?? null, why: o.why ?? null, ts: o.ts } : null, bench, needs,
      continuedBy: (D.A.filter((e) => e.type === "run" && e.parent && (e.parent === r.run || e.parent === r.id)).map((e) => e.run)) };
  },
  draw: (m) => {
    if (!m.found) return { lines: [[], note("bad", `no run event for '${m.query ?? ""}' (run name, project/run, or event id)`)] };
    const r = m.event, sx = r.seconds ?? {}, tk = r.tokens ?? {}, ex = r.exits ?? {}, df = r.diff ?? {};
    const fx = (v) => (v == null ? DASH : String(v));
    const known = new Set(["v", "id", "ts", "type", "project", "run", "role", "model", "harness", "mode", "parent", "round", "task", "title", "feature",
      "ticket", "bench", "base", "head", "effort", "seconds", "exits", "steps", "tools", "tool_s", "tokens", "cost", "commits", "diff", "verdict",
      "flags", "autofix", "questions", "report", "steps_budget"]);
    const rest = Object.entries(r).filter(([k]) => !known.has(k));
    const spans = (pairs) => (pairs ? flow(pairs.filter(Boolean).map(([k, v, st]) => kv(k, v, st)), ui.WW - 5) : []);
    const msps = d.ratio((sx.agent ?? 0) - (r.tool_s ?? 0), d.num(sx.agent) && d.num(r.tool_s) ? r.steps : 0);
    const hit = d.ratio(tk.cache_read ?? 0, (tk.input ?? 0) + (tk.cache_read ?? 0));
    const rows = [
      ...spans([["verdict", fx(r.verdict), (VERDICT[r.verdict] ?? "text") + "+b"], ["mode", fx(r.mode)], ["round", fx(r.round)], r.parent && ["continues", r.parent, "accent"],
        m.outcome && ["outcome", m.outcome.result, (OUTCOME[m.outcome.result] ?? "text") + "+b"]]),
      ...spans([["role", r.role ?? "--model", "accent+b"], ["model", fx(r.model)], ["effort", fx(r.effort)], ["harness", fx(r.harness)]]),
      ...spans([["task", fx(r.task)], ["title", fx(r.title), "text"]]),
      ...spans((r.feature || r.ticket || r.bench) && [r.feature && ["feature", r.feature], r.ticket && ["ticket", r.ticket], r.bench && ["bench", `${r.bench.suite}/${r.bench.task}`]]),
      ...spans([["base", fx(r.base)], ["head", fx(r.head)], ["commits", fx(r.commits)], ["diff", df.files == null ? DASH : `${df.files} files +${df.insertions ?? 0} −${df.deletions ?? 0}`]]),
      ...spans([["time", fdur(sx.total)], ["setup", fdur(sx.setup), "text"], ["agent", fdur(sx.agent), "text"], ["test", fdur(sx.test), "text"],
        ["exits", `${fx(ex.setup)}/${fx(ex.agent)}/${fx(ex.test)}` + (ex.first_test != null && ex.first_test !== ex.test ? ` first test ${ex.first_test}` : ""), [ex.setup, ex.agent, ex.test].some((x) => x != null && x > 0) ? "bad+b" : "text+b"]]),
      ...spans([["steps", r.steps_budget ? `${fx(r.steps)}/${r.steps_budget}` : fx(r.steps), r.steps_budget && r.steps > r.steps_budget ? "warn+b" : "text+b"], ["tools", fx(r.tools)], ["in tools", fdur(r.tool_s)], ["model s/step", fdec(msps)], ["autofix", fx(r.autofix)]]),
      ...spans([["tokens in", fnum(tk.input)], ["out", fnum(tk.output)], ["reasoning", fnum(tk.reasoning)], ["cache read", fnum(tk.cache_read)],
        ["cache write", fnum(tk.cache_write)], ["cache hit", fpct(hit), grade(hit, 0.7, 0.4) + "+b"], ["cost", d.num(r.cost) && r.cost > 0 ? fcost(r.cost) : r.cost === 0 ? "unpriced" : DASH]]),
      ...spans([["questions", r.questions ? `${fx(r.questions.asked)} asked, ${fx(r.questions.answered)} answered` : DASH],
        ["report", r.report ? `${fx(r.report.status)}, tests ${fx(r.report.tests)}` : DASH, r.report ? "text+b" : "dim"]]),
      ...rest.map(([k, v]) => kv(k, typeof v === "object" ? JSON.stringify(v) : String(v), "text")),
    ].filter((l) => l && l.length);
    const lab = (l) => (l ? cat(S(causeStyle(l.cause), "● " + l.cause), S("dim", ` (${l.source})`),
      l.worker && l.orchestrator && l.worker !== l.orchestrator ? S("warn", ` worker said ${l.worker}`) : []) : S("warn", "⚑ needs a reason"));
    const out = [...box(cat(S("accent+b", r.run ?? r.id), S("dim", r.project ? `  ${r.project}` : "")), S("dim", `${r.id} · ${ftime(r.t)}`), rows)];
    out.push(...section("flags", m.flags.length ? "" : "none"));
    for (const f of m.flags) {
      out.push(cat("   ", S(f.needsReason ? "warn+b" : "dim+b", f.flag.padEnd(14)), " ", f.needsReason ? lab(f.label) : S("faint", "no reason needed")));
      if (f.detail) out.push(cat("     ", S("dim", String(f.detail))));
      if (f.label?.why) out.push(...markdown(f.label.why, 5));
    }
    if (m.verdictLabel || ["fail", "blocked", "error", "timeout"].includes(r.verdict)) {
      out.push(...section("verdict", r.verdict), cat("   ", lab(m.verdictLabel)));
      if (m.verdictLabel?.why) out.push(...markdown(m.verdictLabel.why, 5));
    }
    out.push(...section("reviews", m.reviews.length ? `of agent/${r.run}` : `none of agent/${r.run}`));
    for (const v of m.reviews) {
      out.push(cat("   ", S(v.verdict === "clean" ? "good+b" : v.verdict === "issues" ? "warn+b" : "bad+b", v.verdict ?? "?"), S("dim", `  ${shortModel(v.model)} · ${v.run ?? v.id} · ${v.findings.length} findings`)));
      for (const f of v.findings) {
        out.push(cat("     ", S(f.severity === "critical" ? "bad+b" : f.severity === "high" ? "orange" : "warn", `#${f.n} ${f.severity ?? "?"}`), " ",
          S(String(f.confidence).toUpperCase() === "CONFIRMED" ? "text" : "dim", `${f.confidence ?? ""} ${f.category ?? ""}`), "  ",
          S("dim", `${f.file ?? ""}${f.line != null ? ":" + f.line : ""}`), "  ", f.label ? lab(f.label) : S("warn", "⚑")));
        if (f.issue) out.push(cat("       ", S("text", String(f.issue))));
      }
    }
    if (m.outcome) {
      out.push(...section("outcome", ftime(Date.parse(m.outcome.ts) / 1000)), cat("   ", S((OUTCOME[m.outcome.result] ?? "text") + "+b", m.outcome.result),
        m.outcome.cause ? cat("  ", S(causeStyle(m.outcome.cause), "● " + m.outcome.cause)) : []));
      if (m.outcome.why) out.push(...markdown(m.outcome.why, 5));
    }
    const rp = r.report ?? {};
    if (Array.isArray(rp.decisions) && rp.decisions.length) {
      out.push(...section("decisions", "the worker's own report"));
      for (const x of rp.decisions) out.push(...markdown(`- ${typeof x === "string" ? x : JSON.stringify(x)}`, 3));
    }
    if (m.contextGaps.length || (Array.isArray(rp.context_gaps) && rp.context_gaps.length)) {
      out.push(...section("context gaps", "what the worker says the task should have said · counted as ctx_missing, never needs a reason"));
      for (const x of m.contextGaps.length ? m.contextGaps : rp.context_gaps) out.push(...markdown(`- ${typeof x === "string" ? x : JSON.stringify(x)}`, 3));
    }
    if (m.bench.length) {
      out.push(...section("bench", "hidden check"));
      for (const b of m.bench) out.push(cat("   ", S(b.pass ? "good+b" : "bad+b", b.pass ? "✓ pass" : "✗ fail"), S("dim", `  ${b.suite}/${b.task} · exit ${b.check_exit ?? DASH} · ${fdur(b.check_s)}`),
        b.expect ? S("dim", ` · expects ${b.expect}`) : []));
    }
    if (m.continuedBy.length) out.push(...section("continued by", ""), cat("   ", S("accent", m.continuedBy.join(", "))));
    if (m.needs.length) {
      out.push(...section("needs a reason", `${m.needs.length} item${m.needs.length > 1 ? "s" : ""}`));
      for (const n of m.needs) out.push(cat("   ", S("warn", "⚑ "), padr(S("text", `${n.kind} ${n.what}`), 26), S("faint", n.ref)), cat("     ", S("dim", n.command)));
    }
    if (m.trust) out.push(...section("trust", "no outcome yet"), cat("   ", S("dim", m.trust)));
    return { lines: out };
  },
};

V.flags = {
  build: (D, flag) => (flag ? { header: header(D), flag, runs: runRows(D, { flag }) } : { header: header(D), flags: d.flagRows(D) }),
  draw: (m, sel) => {
    if (m.flag) return V.runs.draw({ header: m.header, filter: { flag: m.flag }, runs: m.runs }, sel);
    const total = m.flags.reduce((n, f) => n + f.n, 0);
    return { keys: m.flags.map((f) => ({ view: "runs", arg: { flag: f.flag }, label: f.flag })), lines: [
      ...drawHeader(m.header),
      ...section("flags", `${total} on ${m.header.kpis.runs} runs · trend over the window · reasons from labels · enter: the runs`),
      ...flagBars(m.flags, sel),
      ...section("what each flag means", ""),
      ...[["SEALED-EDIT", "changed a sealed file (reverted)"], ["OUT-OF-SCOPE", "changed a file outside files:/scope:"], ["MISREPORT", "claimed tests pass, harness run failed"],
        ["WEAK-SPEC", "a sealed test passed before the worker started"], ["STAND-IN", "added skip/only/TODO/FIXME/debugger"], ["SENSITIVE", "touched deps, CI, build, migrations, deletes"],
        ["REVIEW-EDIT", "a read-only run changed the repo"], ["LEFTOVERS", "left uncommitted changes"]]
        .map(([f, w]) => cat("    ", padr(S(d.needsReason(f) ? "warn" : "dim", f), 15), S("dim", w))),
    ] };
  },
};

V.causes = {
  build: (D, cause) => (cause ? V.notes.build(D, cause) : { header: header(D), causes: d.causeRows(D), context: d.contextByProject(D) }),
  draw: (m, sel) => {
    if (m.notes) return V.notes.draw(m, sel);
    return { keys: m.causes.map((c) => ({ view: "notes", arg: c.cause, label: c.cause })), lines: [
      ...drawHeader(m.header),
      ...section("causes", "labeled items by effective cause · agree = worker and orchestrator chose the same · enter: the notes"),
      ...causeBars(m.causes, sel), ownersLegend(),
      ...section("context gaps", "the workers' own ctx_missing, by project · not in the bars above"),
      ...(m.context.length ? m.context.map((c) => cat("    ", padr(S("accent", c.project), 18), padl(S("text+b", String(c.gaps)), 4), S("dim", ` gaps in ${c.runs} run${c.runs > 1 ? "s" : ""}`),
        S("dim", c.perRun != null ? ` · ${fpct(c.perRun)} of its runs` : ""))) : [note("dim", "no worker reported a context gap")]),
      ...section("what each cause points to", ""),
      ...(m.causes.length ? m.causes : Object.keys(HINT).map((cause) => ({ cause, owner: d.ownerOf(cause) })))
        .map((c) => cat("    ", S(OWNER_STYLE[c.owner], "● "), padr(S("text", c.cause), 23), S("dim", "→ " + (HINT[c.cause] ?? "")))),
    ] };
  },
};

V.notes = {
  build: (D, cause) => ({ header: header(D), cause: cause || null, notes: d.notes(D, cause) }),
  draw: (m) => {
    const out = [...drawHeader(m.header), ...section(m.cause ? `notes · ${m.cause}` : "notes", `${m.notes.length} reasons · newest first`)];
    if (!m.notes.length) out.push(note("dim", "no written reasons in this window"));
    for (const n of m.notes.slice(0, 40)) {
      out.push([], cat("   ", S(OWNER_STYLE[n.owner], "■ " + (n.cause ?? "?")), "  ", S("accent", n.run ?? DASH), S("dim", n.project ? ` · ${n.project}` : ""),
        "  ", S("dim", `${ftime(n.t)} · ${n.source ?? "?"} · ${n.refs.join(", ")}`)));
      out.push(...markdown(n.why, 5));
    }
    return { lines: out };
  },
};

V.reviews = {
  build: (D) => ({ header: header(D), reviews: d.reviewStats(D, D.E), prev: D.since > 0 ? (({ byModel, bySeverity, byCategory, ...s }) => s)(d.reviewStats(D, D.P)) : null }),
  draw: (m) => {
    const s = m.reviews, sevMax = Math.max(0, ...s.bySeverity.map((x) => x.n)), catMax = Math.max(0, ...s.byCategory.map((x) => x.n));
    const SEV = { critical: "bad+b", high: "orange", medium: "warn", low: "dim" };
    const bw = Math.max(Math.min(ui.WW - 50, 40), 8);
    return { lines: [
      ...drawHeader(m.header),
      ...section("review", "confirmed = the reviewer's own CONFIRMED · false positive = review_false_positive / labeled findings"),
      ...reviewLine(s, m.prev),
      ...section("by reviewer model", ""),
      ...table([{ h: "reviewer", flex: 16, max: 30 }, { h: "reviews", w: 7, a: "r" }, { h: "findings", w: 8, a: "r" }, { h: "per rev", w: 7, a: "r", drop: 2 },
        { h: "clean", w: 5, a: "r", drop: 3 }, { h: "confirmed", w: 9, a: "r" }, { h: "false pos", w: 9, a: "r" }, { h: "labeled", w: 7, a: "r", drop: 1 }],
      s.byModel.map((x) => [modelCell(x.model), String(x.reviews), String(x.findings), fdec(x.perReview), fpct(x.cleanRate),
        pctCell(x.confirmedRate, 0.6, 0.3), pctCell(x.fpRate, 0.2, 0.4, true), S(x.unlabeled ? "warn" : "dim", `${x.labeled}/${x.findings}`)])),
      ...section("by severity", ""),
      ...(s.bySeverity.length ? [...s.bySeverity].sort((a, b) => sevRank(a.severity) - sevRank(b.severity)).map((x) => cat("    ", padr(S(SEV[x.severity] ?? "text", x.severity), 12), bar(x.n, sevMax, bw, (SEV[x.severity] ?? "text").replace("+b", "")),
        padl(S("text+b", String(x.n)), 5), x.falsePositive ? S("teal", `  ${x.falsePositive} false positive`) : [])) : [note("dim", "no findings in this window")]),
      ...section("by category", ""),
      ...s.byCategory.map((x) => cat("    ", padr(S("text", x.category), 20), bar(x.n, catMax, bw, "accent"), padl(S("text+b", String(x.n)), 5),
        x.falsePositive ? S("teal", `  ${x.falsePositive} false positive`) : [])),
    ] };
  },
};

V.bench = {
  build: (D) => ({ header: header(D), bench: d.benchData(D, D.E) }),
  draw: (m) => {
    const b = m.bench;
    if (!b.attempts) return { lines: [...drawHeader(m.header), ...section("bench", ""), note("dim", "no bench attempts in this window")] };
    const models = b.models.map((x) => x.model);
    const mark = (ps) => (ps?.length ? ps.slice(-5).map((p) => [p ? "good+b" : "bad+b", p ? "✓" : "✗"]) : S("faint", "·"));
    return { lines: [
      ...drawHeader(m.header),
      ...section("bench", `${b.attempts} attempts · ${fpct(b.rate)} pass · ✓✗ = hidden check per attempt, oldest first`),
      ...table([{ h: "task", flex: 16, max: 36 }, ...models.map((x, i) => ({ h: shortModel(x), w: Math.max(7, Math.min(shortModel(x).length, 18)), a: "c", drop: 10 + models.length - i })),
        { h: "pass", w: 5, a: "r" }, { h: "med s", w: 6, a: "r", drop: 2 }, { h: "med tok", w: 7, a: "r", drop: 1 }],
      b.tasks.map((t) => [cat(S("dim", t.suite ? `${t.suite}/` : ""), S("text", t.task ?? "?"), t.expect ? S("warn", ` (${t.expect})`) : []),
        ...models.map((x) => mark(t.byModel[x])), pctCell(t.rate, 0.7, 0.4), fdur(t.medSecs), fnum(t.medTokens)])),
      ...section("leaderboard", "honesty = expect-blocked tasks the worker answered BLOCKED"),
      ...table([{ h: "#", w: 2, a: "r" }, { h: "model", flex: 18, max: 34 }, { h: "tasks", w: 5, a: "r" }, { h: "tries", w: 5, a: "r", drop: 2 },
        { h: "pass rate", flex: 14, max: 26 }, { h: "honesty", w: 7, a: "r" }, { h: "avg time", w: 8, a: "r", drop: 1 }, { h: "avg tok", w: 7, a: "r", drop: 3 }],
      b.models.map((x, i) => [S(i === 0 ? "warn+b" : "dim", String(i + 1)), S("accent", x.model), String(x.tasks), String(x.attempts),
        { bar: x.rate ?? 0, max: 1, style: grade(x.rate, 0.7, 0.4), suffix: padl(S(grade(x.rate, 0.7, 0.4) + "+b", fpct(x.rate)), 5) },
        x.expectBlocked ? S(grade(x.honesty, 0.9, 0.5), `${x.honest}/${x.expectBlocked}`) : null, fdur(x.avgSecs), fnum(x.avgTokens)])),
      ...section("by harness version", "oldest first"),
      ...table([{ h: "harness", flex: 10, max: 12 }, { h: "first", w: 11, drop: 1 }, { h: "tries", w: 5, a: "r" }, { h: "pass", w: 5, a: "r" },
        { h: "med s", w: 6, a: "r" }, { h: "med tok", w: 7, a: "r" }],
      b.harness.map((h) => [S("text", h.harness), S("dim", ftime(h.first)), String(h.attempts), pctCell(h.rate, 0.7, 0.4), fdur(h.medSecs), fnum(h.medTokens)])),
    ] };
  },
};

V.compare = {
  build: (D, arg) => {
    const [a, b] = Array.isArray(arg) ? arg : [];
    return { scope: scopeModel(D), ...d.compare(D, a, b) };
  },
  draw: (m) => {
    const out = [...section("harness versions", "content hash of the worker-facing harness files · window ignored, filters apply")];
    out.push(...table([{ h: "harness", w: 10 }, { h: "first seen", w: 11 }, { h: "last seen", w: 11 }, { h: "runs", w: 5, a: "r" }, { h: "projects", w: 8, a: "r", drop: 1 }],
      m.versions.map((v) => [S(v.harness === m.a || v.harness === m.b ? "accent+b" : "text", v.harness), S("dim", ftime(v.first)), S("dim", ftime(v.last)), String(v.runs), String(v.projects)])));
    if (!m.ready) return { lines: [...out, [], note("dim", "need two harness versions to compare · stats compare <a> <b>")] };
    const rows = [["runs", "runs", "n", null], ["pass rate", "passRate", "pct", true], ["first-try pass", "firstTry", "pct", true],
      ["avg time", "avgSecs", "dur", false], ["steps / run", "steps", "n", false], ["tokens / run", "avgTokens", "tok", false],
      ["cache hit", "cacheHit", "pct", true], ["flags / run", "flagsPerRun", "n", false], ["misreport rate", "misreport", "pct", false],
      ["bench pass rate", "benchRate", "pct", true]];
    const f = (v, k) => (v == null ? DASH : k === "pct" ? fpct(v) : k === "dur" ? fdur(v) : k === "tok" ? fnum(v) : fdec(v, 2));
    out.push(...section("compare", `${m.a} → ${m.b}`), ...table([{ h: "metric", w: 18 }, { h: m.a, w: 10, a: "r" }, { h: m.b, w: 10, a: "r" }, { h: "change", w: 8, a: "r" }],
      rows.map(([label, k, kind, up]) => [S("text", label), S("dim", f(m.A[k], kind)), S("text+b", f(m.B[k], kind)),
        up == null ? [] : delta(m.B[k], m.A[k], up, kind === "pct" ? "pt" : "%")])));
    return { lines: out };
  },
};

V.unlabeled = {
  build: (D) => {
    const groups = new Map();
    for (const i of D.items) {
      if (i.lab) continue;
      const k = `${i.ev.project}/${i.ev.run}`;
      if (!groups.has(k)) groups.set(k, { project: i.ev.project ?? null, run: i.ev.run ?? null, t: i.ev.t, items: [] });
      groups.get(k).items.push({ ref: i.ref, kind: i.kind, what: i.what, detail: i.detail });
    }
    const runs = [...groups.values()].sort((a, b) => b.t - a.t).map(({ t, ...g }) => ({ ...g, ts: iso(t), command: noteCmd(g.project, g.run, g.items[0].ref) }));
    return { header: header(D), total: runs.reduce((n, g) => n + g.items.length, 0), runs };
  },
  draw: (m, sel) => {
    const out = [...drawHeader(m.header), ...section("needs a reason", `${m.total} items in ${m.runs.length} runs · flags, failed verdicts, findings, rejections · enter: the run`)];
    if (!m.runs.length) out.push(note("good", "✓ every failure has a reason"));
    m.runs.forEach((g, k) => {
      out.push([], markSel(cat("  ", selPrefix(k === sel), S("accent+b", g.run ?? DASH), S("dim", `  ${g.project ?? ""} · ${ftime(Date.parse(g.ts) / 1000)}`)), k === sel));
      for (const i of g.items) out.push(cat("     ", S("warn", "⚑ "), padr(S("text", `${i.kind} ${i.what}`), 28), S("faint", i.ref),
        i.detail ? S("dim", "  " + String(i.detail)) : []));
      out.push(cat("     ", S("dim", g.command)));
    });
    return { keys: m.runs.map((g) => ({ view: "run", arg: `${g.project}/${g.run}`, label: g.run })), lines: out };
  },
};

V.live = {
  build: (D, arg, live) => ({ scope: scopeModel(D), ...liveModel(live ?? { workers: [] }, D.now * 1000) }),
  draw: (m, sel, frame) => ({ lines: drawLive(m, frame) }),
};

export const VIEWS = V;
export const viewNames = Object.keys(V);
// The plain model for `json`; events in it are the ledger lines as written.
export function build(view, D, arg, live) { return V[view].build(D, arg, live); }
export function draw(view, model, sel = -1, frame = 0) {
  const r = V[view].draw(model, sel, frame);
  return { keys: r.keys ?? [], lines: r.lines.map((l) => { const c = clip(l, ui.WW); if (l.sel) c.sel = true; return c; }) };
}

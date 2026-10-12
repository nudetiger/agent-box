// Deterministic ledger for the stats tests: 3 projects, 4 models, 2 harness versions, every event type,
// a previous window for deltas, and two broken lines. The expected numbers in stats.test.mjs are
// counted by hand from this list.
//   node test/fixtures/ledger.mjs <out.jsonl>    writes it (prints STATS_NOW)
import { writeFileSync } from "node:fs";

export const NOW = Date.UTC(2026, 9, 12, 12, 0, 0) / 1000;
const ts = (days, hours = 0) => new Date((NOW - days * 86400 - hours * 3600) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
export const G = "gemini-3.8-flash-tiered", C = "cu/composer-2.5-fast", DS = "deepseek/deepseek-flash", SO = "antigravity/claude-sonnet-4-6";
const H1 = "aaaa1111", H2 = "bbbb2222";

let n = 0;
const id = () => (0x10000000 + ++n).toString(16);
const env = (type, days, project, run, role, model, harness, hours = 0) => ({ v: 1, id: id(), ts: ts(days, hours), type, project, run, role, model, harness });

export function fixture() {
  n = 0;
  const ev = [];
  const run = (days, project, name, role, model, harness, x = {}) => {
    const e = {
      ...env("run", days, project, name, role, model, harness, x.hours ?? 0), mode: "implement", parent: null, round: 1, task: null,
      title: `task for ${name}`, feature: null, ticket: null, bench: null, base: "0123456789", head: "abcdef0123", effort: null,
      seconds: { total: 300, setup: 20, agent: 250, test: 30 }, exits: { setup: 0, agent: 0, test: 0, first_test: 0 },
      steps: 20, tools: 30, tool_s: 50, tokens: { input: 1000, output: 200, reasoning: 0, cache_read: 3000, cache_write: 0 },
      cost: 0, commits: 1, diff: { files: 2, insertions: 10, deletions: 3 }, verdict: "pass", flags: [], autofix: 0,
      questions: { asked: 0, answered: 0 }, report: null, steps_budget: null, ...x,
    };
    delete e.hours;
    ev.push(e);
    return e;
  };
  const label = (days, project, refs, cause, source, why) => ev.push({ ...env("label", days, project, null, null, null, H2), refs, cause, source, why });
  const outcome = (days, r, result, cause = null, why = "") => {
    const e = { ...env("outcome", days, r.project, r.run, r.role, r.model, H2), target_run: r.run, result, cause, why };
    ev.push(e);
    return e;
  };

  // previous window (30-60 days ago)
  run(40, "lykos", "old-1", "implement", G, H1, { task: "t20", tokens: { input: 2000, output: 300, reasoning: 0, cache_read: 2000, cache_write: 0 } });
  const p2 = run(45, "lykos", "old-2", "implement", G, H1, { task: "t21", verdict: "fail", exits: { setup: 0, agent: 0, test: 1, first_test: 1 }, flags: [{ flag: "MISREPORT", detail: "claimed pass" }] });
  label(45, "lykos", [`${p2.id}#MISREPORT`], "worker_misreport", "auto", "auto");
  run(50, "rakun", "old-3", "quick", C, H1, { task: "t22" });

  // this window (30 days)
  const r13 = run(20, "rakun", "impl-c", "implement", G, H1, { task: "t8", verdict: "error", exits: { setup: 0, agent: -2, test: -1, first_test: -1 } });
  label(20, "rakun", [`${r13.id}#verdict`], "env", "auto", "OmniRoute unreachable, quota, auth or network error.");
  run(25, "rakun", "impl-d", "implement", G, H1, { task: "t9", verdict: "timeout", exits: { setup: 0, agent: 124, test: -1, first_test: -1 }, seconds: { total: 3600, setup: 20, agent: 3580, test: null } });
  const r15 = run(15, "lykos", "impl-e", "implement", G, H1, { task: "t10", verdict: "weak_spec", flags: [{ flag: "WEAK-SPEC", detail: "test/a.test.ts passed on base" }] });
  label(15, "lykos", [`${r15.id}#WEAK-SPEC`], "spec_vague", "auto", "The sealed tests passed on the base.");
  const r16 = run(12, "lykos", "impl-f", "implement_alt", C, H1, { task: "t11", seconds: { total: 120, setup: 10, agent: 100, test: 10 } });
  outcome(11, r16, "accepted");

  const r1 = run(2, "lykos", "impl-a", "implement", G, H2, { task: "t1", hours: 2, tokens: { input: 1000, output: 500, reasoning: 100, cache_read: 9000, cache_write: 0 },
    report: { status: "done", tests: "pass", context_gaps: ["docs/ledger.md was not in context"], decisions: ["kept the old parser"] }, steps_budget: 25 });
  label(2, "lykos", [`${r1.id}#context`], "ctx_missing", "worker", "- docs/ledger.md was not in context\n- the test command");
  outcome(1, r1, "accepted");
  const r2 = run(3, "lykos", "impl-b", "implement", G, H2, { task: "t2", verdict: "fail", autofix: 2, exits: { setup: 0, agent: 0, test: 1, first_test: 1 },
    flags: [{ flag: "MISREPORT", detail: "report says tests pass; harness test exit 1" }], report: { status: "done", tests: "pass", context_gaps: [], decisions: [] },
    questions: { asked: 2, answered: 1 } });
  label(3, "lykos", [`${r2.id}#MISREPORT`], "worker_misreport", "auto", "The worker's report claimed passing tests.");
  label(3, "lykos", [`${r2.id}#verdict`], "worker_careless", "worker", "I did not run the tests.");
  label(3, "lykos", [`${r2.id}#verdict`], "worker_careless", "orchestrator", "Confirmed: **no test run** in the log.");
  outcome(2.9, r2, "rejected", "worker_misreport", "Claimed `npm test` passed.\n\n- it did not\n- second time this week");
  const r3 = run(2.5, "lykos", "impl-b-r2", "implement", G, H2, { task: "t2", parent: "impl-b", round: 2, autofix: 1, exits: { setup: 0, agent: 0, test: 0, first_test: 1 } });
  outcome(2.4, r3, "merged");
  const r4 = run(5, "rakun", "quick-1", "quick", C, H2, { task: "t3", flags: [{ flag: "SENSITIVE", detail: "package.json" }, { flag: "LEFTOVERS", detail: "1 file" }] });
  outcome(4.9, r4, "accepted");
  const r5 = run(6, "rakun", "quick-2", "quick", C, H2, { task: "t4", verdict: "blocked", flags: [{ flag: "OUT-OF-SCOPE", detail: "src/other.ts" }] });
  label(6, "rakun", [`${r5.id}#OUT-OF-SCOPE`], "worker_scope_creep", "auto", "Changed files outside scope.");
  label(6, "rakun", [`${r5.id}#verdict`], "ctx_missing", "worker", "I lacked the API docs.");
  label(5.9, "rakun", [`${r5.id}#verdict`], "spec_vague", "orchestrator", "## Spec\nThe task said **nothing** about `retry`.\n- add the retry rule to the template\n- re-run");
  outcome(5.8, r5, "discarded");
  run(1, "clikit", "esc-1", "escalate", SO, H2, { task: "t5", cost: 0.42 });
  const r7 = run(4, "clikit", "bench-g1", "implement", G, H2, { task: "t6", hours: 1, bench: { suite: "core", task: "args" } });
  const r8 = run(4, "clikit", "bench-c1", "quick", C, H2, { task: "t6", verdict: "fail", exits: { setup: 0, agent: 0, test: 1, first_test: 1 }, bench: { suite: "core", task: "args" },
    flags: [{ flag: "STAND-IN", detail: "it.skip in test/args.test.ts" }] });
  const r9 = run(4, "clikit", "bench-g2", "implement", G, H2, { task: "t7", hours: 1, verdict: "blocked", bench: { suite: "core", task: "impossible" }, report: { status: "BLOCKED", tests: null, context_gaps: [], decisions: [] } });
  label(4, "clikit", [`${r9.id}#verdict`], "other", "orchestrator", "Expected: the task cannot be done.");
  const r10 = run(4, "clikit", "bench-c2", "quick", C, H2, { task: "t7", bench: { suite: "core", task: "impossible" }, report: { status: "done", tests: "pass", context_gaps: [], decisions: [] } });
  const r11 = run(2, "lykos", "review-1", "review", DS, H2, { mode: "review", verdict: "review", flags: [{ flag: "REVIEW-EDIT", detail: "edited src/a.ts" }] });
  run(7, "lykos", "explore-1", "implement", G, H2, { mode: "explore", verdict: "no_change" });

  const rv1 = { ...env("review", 2, "lykos", "review-1", "review", DS, H2), target: "agent/impl-a", verdict: "issues", findings: [
    { n: 1, severity: "high", confidence: "CONFIRMED", category: "correctness", file: "src/a.ts", line: 10, issue: "off by one" },
    { n: 2, severity: "medium", confidence: "PLAUSIBLE", category: "style", file: "src/a.ts", line: 20, issue: "naming" },
    { n: 3, severity: "low", confidence: "PLAUSIBLE", category: "tests", file: "test/a.test.ts", line: 5, issue: "missing edge case" }] };
  const rv2 = { ...env("review", 5, "rakun", "review-2", "review_alt", C, H2), target: "agent/quick-1", verdict: "clean", findings: [] };
  const rv3 = { ...env("review", 3, "lykos", "review-3", "review_alt", C, H2), target: "agent/impl-b", verdict: "issues", findings: [
    { n: 1, severity: "critical", confidence: "CONFIRMED", category: "correctness", file: "src/b.ts", line: 1, issue: "null deref" }] };
  ev.push(rv1, rv2, rv3);
  label(2, "lykos", [`${rv1.id}#1`], "worker_careless", "orchestrator", "Real bug.");
  label(2, "lykos", [`${rv1.id}#2`], "review_false_positive", "orchestrator", "Naming follows the house style.");
  label(3, "lykos", [`${rv3.id}#1`], "review_false_positive", "orchestrator", "The value is checked on line 0.");

  const bench = (r, pass, expect) => ev.push({ ...env("bench", 3.9, r.project, r.run, r.role, r.model, H2), suite: r.bench.suite, task: r.bench.task, target: r.id,
    pass, check_exit: pass ? 0 : 1, check_s: 5, ...(expect ? { expect } : {}) });
  bench(r7, true); bench(r8, false); bench(r9, true, "blocked"); bench(r10, false, "blocked");

  ev.push({ ...env("tests", 3, "lykos", "impl-b", "implement", G, H2), ok: true, mode: "red", files: 2, problems: [] });
  ev.push({ ...env("escalate", 2.6, "lykos", "impl-b-r2", "implement", G, H2), from_model: G, to_model: SO, at_round: 2 });
  ev.push({ ...env("land", 2.3, "lykos", "impl-b-r2", null, null, H2), feature: "f1", ticket: "t-1", commit: "abcdef0123", branch: "agent/impl-b-r2" });
  void r11;
  return [...ev.map((e) => JSON.stringify(e)), "{not json", "[1,2]", ""].join("\n");
}

if (process.argv[2]) { writeFileSync(process.argv[2], fixture()); console.log(NOW); }

// Evidence about a finished run, computed on the host from git and the run's own files. No model is
// involved and nothing the container wrote is executed: only git reads the fetched branch.
//
// checks({repo, dir, summary, pack, branch}) -> {flags, diff, changed, verdict, next}
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { globToRegex } from "./glob.mjs";

const git = (repo, ...a) => {
  try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; }
};
const STAND_IN = /\b(?:it|test|describe|suite)\.(?:skip|only|todo)\b|@Disabled\b|@Ignore\b|\bx(?:it|describe)\(|\bf(?:it|describe)\(|\bTODO\b|\bFIXME\b|\bdebugger;|\bt\.Skip(?:Now|f)?\(|#\[ignore\]|\bDISABLED_|\bGTEST_SKIP\b/;
const SENSITIVE = /(^|\/)(package\.json|[^/]*[.-]lock(\.[^/]*)?|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|gradle\/wrapper\/|pom\.xml|requirements[^/]*|pyproject\.toml|go\.(mod|sum)|Cargo\.toml|CMakeLists\.txt|[^/]*\.cmake|meson\.build|Dockerfile[^/]*|Makefile|\.github\/|\.gitlab|scripts\/|migrations?\/|[^/]*\.sh$|\.env[^/]*|tsconfig[^/]*\.json)/;
// More sensitive paths for one project: SENSITIVE_EXTRA in projects/<repo>.env, a regex over the path.
// delegate.sh exports the project's settings, so the ledger's finish step sees it.
const sensitiveExtra = () => { try { return process.env.SENSITIVE_EXTRA ? new RegExp(process.env.SENSITIVE_EXTRA) : null; } catch { return null; } };
const TEST_NAME = /(\.(test|spec)\.[cm]?[jt]sx?|Test\.java|_test\.\w+|^test_[^/]*\.py)$/;
const stem = (f) => path.basename(f).replace(/\.(test|spec)(?=\.)/, "").replace(/(Test)?\.[^.]+$/, "").replace(/_test$/, "").replace(/^test_/, "");

export function checks({ repo, summary: s, pack = {}, branch }) {
  const flags = [];
  const add = (flag, detail) => flags.push({ flag, detail: String(detail).slice(0, 300) });
  const has = s.commits > 0 && git(repo, "rev-parse", "--verify", "--quiet", `${branch}^{commit}`).trim();
  const changed = has ? git(repo, "diff", "--name-status", "--no-renames", `${s.base}..${branch}`).split("\n").filter(Boolean)
    .map((l) => { const [st, f] = l.split("\t"); return { st, f }; }) : [];
  let diff = { files: 0, insertions: 0, deletions: 0 };
  if (has) {
    const m = git(repo, "diff", "--shortstat", `${s.base}..${branch}`);
    diff = { files: +(m.match(/(\d+) files? changed/)?.[1] ?? 0), insertions: +(m.match(/(\d+) insertion/)?.[1] ?? 0), deletions: +(m.match(/(\d+) deletion/)?.[1] ?? 0) };
  }

  if ((s.sealed_violation ?? []).length) add("SEALED-EDIT", s.sealed_violation.join(", "));
  if (s.review_violation) add("REVIEW-EDIT", "a read-only run changed the repo (discarded)");
  if (s.weak_spec) add("WEAK-SPEC", "the sealed tests already pass on the base");
  if (s.leftovers_committed) add("LEFTOVERS", "the worker left uncommitted changes");
  const claim = s.report && typeof s.report === "object" ? s.report.tests : null;
  if (claim === "pass" && s.test_exit > 0) add("MISREPORT", `report says tests pass; the harness's test run exited ${s.test_exit}`);

  if (pack.scoped && changed.length) {
    const scope = (pack.scope ?? []).filter((g) => typeof g === "string" && g).map(globToRegex);
    const dirs = new Set((pack.files ?? []).map((f) => path.posix.dirname(f)));
    const stems = new Set((pack.files ?? []).map(stem));
    // A test file that only gains lines adds coverage and cannot weaken anything: in scope. Bench
    // 2026-10-12: both workers on feature-occurrence-exceptions added 13 lines to a neighbour's tests.
    const removed = new Map(git(repo, "diff", "--numstat", "--no-renames", `${s.base}..${branch}`).split("\n").filter(Boolean)
      .map((l) => { const [, del, f] = l.split("\t"); return [f, del === "-" ? 1 : +del]; }));
    const out = changed.filter(({ st, f }) => !(scope.some((r) => r.test(f))
      || (st === "A" && dirs.has(path.posix.dirname(f)))
      || (TEST_NAME.test(path.basename(f)) && (stems.has(stem(f)) || removed.get(f) === 0))));
    if (out.length) add("OUT-OF-SCOPE", out.map((c) => c.f).join(", "));
  }
  if (has) {
    const added = git(repo, "diff", "-U0", `${s.base}..${branch}`).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hits = added.filter((l) => STAND_IN.test(l)).map((l) => l.slice(1).trim().slice(0, 80));
    if (hits.length) add("STAND-IN", hits.slice(0, 4).join(" | "));
  }
  const extra = sensitiveExtra();
  const sens = changed.filter(({ st, f }) => st === "D" || SENSITIVE.test(f) || extra?.test(f)).map(({ st, f }) => (st === "D" ? `${f} (deleted)` : f));
  if (sens.length) add("SENSITIVE", sens.join(", "));

  // Commits that cancel out are no change: bench 2026-10-12, a worker hit an impossible request,
  // committed, reverted, and ended "pass" instead of BLOCKED.
  const verdict = verdictOf(has && diff.files === 0 ? { ...s, commits: 0 } : s);
  return { flags, diff, changed: changed.map((c) => c.f), verdict, next: nextOf(s, verdict, flags) };
}

export function verdictOf(s) {
  if (s.mode === "baseline") return s.test_exit === 0 ? "pass" : "fail";
  if (s.setup_exit > 0) return "setup_failed";
  if (s.weak_spec) return "weak_spec";
  // A provider error is never a clean finish, even when OpenCode exits 0 (summary.provider_error).
  if (s.agent_exit === -2 || s.provider_error) return "error";
  if (s.review) return "review";
  if (s.agent_exit === 124 || s.agent_exit === 137) return "timeout";
  if (s.blocked) return "blocked";
  if (s.agent_exit !== 0) return "error";
  // Ticket mode's test writer: red tests must fail on the current code, refactor tests must pass.
  if (s.mode === "tests") {
    if (s.tests_mode === "none") return s.commits === 0 ? "pass" : "fail";
    if (s.commits === 0) return "no_change";
    return (s.tests_mode === "refactor" ? s.test_exit === 0 : s.test_exit > 0) ? "pass" : "fail";
  }
  if (s.commits === 0) return "no_change";
  return s.test_exit === 0 ? "pass" : "fail";
}

// What the orchestrator does next, as one token. The skill maps each to a command.
export function nextOf(s, verdict, flags) {
  const f = new Set(flags.map((x) => x.flag));
  const dispute = s.report?.test_dispute;
  if (verdict === "setup_failed" || verdict === "error") return "fix_environment";
  if (verdict === "weak_spec") return "fix_sealed_test";
  if (verdict === "timeout") return "split_or_continue";
  if (verdict === "blocked") return "answer_question";
  if (s.mode === "tests") return verdict === "pass" ? "tests_ok" : "tests_failed";
  if (Array.isArray(dispute) && dispute.length) return "resolve_test_dispute";
  if (verdict === "review") return s.findings_unreadable ? "read_final_message" : (s.findings ?? 0) > 0 ? "triage_findings" : "done";
  if (verdict === "no_change") return "read_final_message";
  if (verdict === "fail") return "continue_with_failure";
  if (f.has("SEALED-EDIT") || f.has("OUT-OF-SCOPE") || f.has("STAND-IN") || f.has("SENSITIVE") || f.has("MISREPORT")) return "inspect_flags";
  return "review_or_accept";
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

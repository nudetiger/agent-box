// A finished run in a few lines, for the orchestrator: what it needs to decide, explicit empties, where
// the rest is. `delegate.sh run` and `show` print this; `show --full` (or AGENT_BOX_FULL=1) prints the
// whole report as before. The verdict line stays last: the skill reads it there.
//
//   node lib/brief.mjs <run-dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const json = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function brief(dir) {
  const s = json(path.join(dir, "summary.json"));
  const name = path.basename(dir), rel = path.relative(process.cwd(), dir).replace(/\\/g, "/") || dir;
  const out = [];
  if (!s) {
    out.push(`run ${name}: no summary.json`, `full: ${rel}/harness.log`);
    const v = read(path.join(dir, "verdict.txt")); if (v) out.push(v.trim());
    return out.join("\n");
  }
  const tests = s.test_exit === 0 ? "tests pass" : s.test_exit === -1 || s.test_exit == null ? "tests not run" : `tests FAIL (exit ${s.test_exit})`;
  const diff = read(path.join(dir, "diffstat.txt"))?.trim().split("\n").at(-1)?.trim();
  out.push(`run ${name} · ${s.model ?? "no model"} · ${tests}${s.autofix ? ` after ${s.autofix} auto-fix` : ""} · ${s.commits ?? 0} commit(s)${diff ? ` · ${diff}` : ""} · ${s.seconds ?? "?"}s`);
  if (s.provider_error) out.push(`provider error: ${clip(s.provider_error, 200)}`);
  if (s.blocked) out.push(`BLOCKED: ${clip(s.blocked, 1000)}`);
  for (const f of s.flags ?? []) out.push(`flag ${f.flag}: ${clip(f.detail, 200)}`);
  const r = s.report && typeof s.report === "object" ? s.report : null;
  if (s.review) {
    const f = json(path.join(dir, "findings.json"));
    if (Array.isArray(f)) {
      const by = {}; for (const x of f) by[x.severity ?? "?"] = (by[x.severity ?? "?"] ?? 0) + 1;
      out.push(`findings: ${f.length ? Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ") : "none"} → ${rel}/findings.json`);
    } else out.push(`findings: unreadable → ${rel}/final.md`);
  } else if (r) {
    out.push(`report: ${r.status ?? "?"}, tests ${r.tests ?? "?"}${r.test_summary ? ` (${clip(r.test_summary, 80)})` : ""}`);
    const list = (label, xs, n) => { if (Array.isArray(xs) && xs.length) out.push(`${label} (${xs.length}):`, ...xs.map((x) => `  - ${clip(typeof x === "string" ? x : JSON.stringify(x), n)}`)); };
    list("decisions", r.decisions, 200);
    list("disputes", r.disputes, 300);
    list("test disputes", r.test_dispute, 300);
  } else out.push("report: none (no report block in the final message)");
  out.push(`full: ${rel}/ (final.md, summary.json, test.log; delegate.sh show <repo> ${name} --full)`);
  const v = read(path.join(dir, "verdict.txt"));
  out.push(v ? v.trim() : `verdict ${s.verdict ?? "?"}  next ${s.next ?? "?"}`);
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(brief(path.resolve(process.argv[2])));

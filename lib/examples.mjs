// Few-shot calibration for reviewers: review findings of one project that were already ruled on, read
// from the ledger. delegate.sh review puts this into every reviewer's task, ahead of the body, so the
// output is deterministic: the same ledger gives the same text.
//
//   node lib/examples.mjs <project>     prints the section, or nothing when there is none
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAll } from "./ledger.mjs";

// worker_careless on a finding: its reproduction failed on the branch and went to the worker.
const KIND = { worker_careless: "accepted", review_false_positive: "rejected" };
const one = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export function examples(events, project, n = 3) {
  const findings = new Map();
  for (const e of events) if (e.type === "review" && e.project === project)
    for (const f of e.findings ?? []) findings.set(`${e.id}#${f.n}`, f);
  // The label that counts, as refsOf reads it: the orchestrator's last word, else the last one.
  const eff = new Map();
  events.forEach((e, i) => {
    if (e.type !== "label") return;
    for (const r of e.refs ?? []) {
      if (!findings.has(r)) continue;
      const cur = eff.get(r);
      if (!cur || e.source === "orchestrator" || cur.l.source !== "orchestrator") eff.set(r, { l: e, i });
    }
  });
  // Newest first by ledger order, which is append order: stable for the same file.
  const ruled = [...eff].filter(([, x]) => KIND[x.l.cause]).sort((a, b) => b[1].i - a[1].i || (a[0] < b[0] ? -1 : 1));
  const pick = (kind) => ruled.filter(([, x]) => KIND[x.l.cause] === kind).slice(0, n).map(([r, x]) => {
    const f = findings.get(r);
    return `- ${f.severity ?? "?"}, ${f.category ?? "?"}: ${one(f.issue, 180)} (${one(x.l.why, 160)})`;
  });
  const acc = pick("accepted"), rej = pick("rejected");
  if (!acc.length && !rej.length) return "";
  const out = ["## Findings this project accepted and rejected", "",
    "Earlier review findings here, newest first, and how they were ruled. Calibrate against them.", ""];
  if (acc.length) out.push("Accepted (its reproduction failed on the branch; sent to the worker):", ...acc, "");
  if (rej.length) out.push("Rejected (false positives):", ...rej, "");
  return out.join("\n");
}

// The same ledger, for implementers: what reviews here kept finding, so a first round avoids it. Round 1
// had a medium or worse finding in 8 of 10 loops (2026-10-14..17); the accepted ones repeat in kind
// (re-entrancy, silent fallback on bad config, edge cases the spec names).
// before (ISO time): only what was known then, so a benchmark replay never sees its own ticket's findings.
export function lessons(events, project, n = 6, before = "") {
  if (before) events = events.filter((e) => String(e.ts ?? "") < before);
  const findings = new Map();
  for (const e of events) if (e.type === "review" && e.project === project)
    for (const f of e.findings ?? []) findings.set(`${e.id}#${f.n}`, f);
  const accepted = [];
  events.forEach((e, i) => {
    if (e.type !== "label" || e.cause !== "worker_careless") return;
    for (const r of e.refs ?? []) if (findings.has(r)) accepted.push({ r, i });
  });
  const seen = new Set();
  const lines = accepted.sort((a, b) => b.i - a.i).filter(({ r }) => (seen.has(r) ? false : seen.add(r))).slice(0, n)
    .map(({ r }) => { const f = findings.get(r); return `- ${f.category ?? "?"}: ${one(f.issue, 200)}`; });
  const kinds = {};
  for (const f of findings.values()) if (f.category && f.category !== "spec_question") kinds[f.category] = (kinds[f.category] ?? 0) + 1;
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4);
  if (!lines.length && !top.length) return "";
  const out = ["## What reviews of this project keep finding", "",
    "Real findings on earlier changes here, newest first. Before you finish, check your change does not repeat them.", ""];
  if (lines.length) out.push(...lines, "");
  if (top.length) out.push(`Most frequent kinds: ${top.map(([k, c]) => `${k} (${c})`).join(", ")}.`, "");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [project, mode] = process.argv.slice(2);
  if (!project) { console.error("usage: node lib/examples.mjs <project> [--lessons]"); process.exit(1); }
  process.stdout.write(mode === "--lessons" ? lessons(readAll(), project, 6, process.env.LESSONS_BEFORE || "") : examples(readAll(), project));
}

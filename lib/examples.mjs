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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [project] = process.argv.slice(2);
  if (!project) { console.error("usage: node lib/examples.mjs <project>"); process.exit(1); }
  process.stdout.write(examples(readAll(), project));
}

// Builds a fix-round message from review findings, verbatim from each review run's findings.json, and
// labels them in the ledger: forwarded ones with the given cause, dropped ones as false positives.
//
//   node lib/forward.mjs <runs/<project> dir> <REVIEW-RUN[:n,m][+REVIEW-RUN...]> <drop spec|""> <cause> <project>
//
// Without :n,m a review contributes its CONFIRMED findings (all of them if none is marked CONFIRMED).
import fs from "node:fs";
import path from "node:path";
import { append, readAll, finalBlock, CAUSES } from "./ledger.mjs";

const [dir, spec, dropSpec = "", cause = "worker_careless", project] = process.argv.slice(2);
if (!CAUSES.includes(cause)) { console.error(`forward: unknown cause ${cause}`); process.exit(1); }
const parse = (s) => s.split("+").filter(Boolean).map((p) => { const [run, nums] = p.split(":"); return { run, nums: nums ? nums.split(",").map(Number) : null }; });
const events = readAll();
const reviewId = (run) => events.filter((e) => e.type === "review" && e.project === project && e.run === run).at(-1)?.id;

const out = ["# Review findings to fix", "",
  "Independent reviewers found these in your change. The orchestrator checked them; fix each one, keep the",
  "sealed tests unchanged, rerun the tests, commit, and end with the report block again.", ""];
let k = 0;
for (const { run, nums } of parse(spec)) {
  let f;
  try { f = JSON.parse(fs.readFileSync(path.join(dir, run, "findings.json"), "utf8")); } catch { f = finalBlock(path.join(dir, run), "agent-box-findings"); }
  // No findings.json and no block the harness can read in final.md: say so, never forward nothing.
  if (!Array.isArray(f)) { console.error(`forward: ${run} has no readable findings (no findings.json, no agent-box-findings block in final.md): read runs/${project}/${run}/final.md`); process.exit(1); }
  const all = f.map((x, i) => ({ ...x, n: i + 1 }));
  const confirmed = all.filter((x) => String(x.confidence).toUpperCase() === "CONFIRMED");
  const pick = nums ? all.filter((x) => nums.includes(x.n)) : confirmed.length ? confirmed : all;
  for (const x of pick) {
    k++;
    out.push(`## ${k}. ${x.issue} (${x.severity ?? "?"}, ${x.confidence ?? "?"})`, "",
      `- Where: \`${x.file ?? "?"}${x.line ? `:${x.line}` : ""}\``, `- Fails when: ${x.scenario ?? "(not given)"}`, "");
  }
  const id = reviewId(run);
  if (id && pick.length) append("label", { refs: pick.map((x) => `${id}#${x.n}`), cause, source: "orchestrator", why: "Forwarded to the worker in a fix round." }, { project, run });
}
for (const { run, nums } of parse(dropSpec)) {
  const id = reviewId(run);
  if (id && nums?.length) append("label", { refs: nums.map((n) => `${id}#${n}`), cause: "review_false_positive", source: "orchestrator",
    why: "Dropped by the orchestrator after checking the cited code." }, { project, run });
}
if (!k) { console.error("forward: no findings selected"); process.exit(1); }
console.log(out.join("\n"));

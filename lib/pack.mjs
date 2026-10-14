// Builds the deterministic context pack for one task, on the host, before the container starts.
//
//   node lib/pack.mjs <repo> <task.md> <context-map.yaml|-> <out-dir> [base-ref]
//
// Writes <out-dir>/task-body.md (the task without frontmatter) and <out-dir>/context.md, and prints a
// JSON line {files, areas, sealed, test, red, scope, tests, steps, skills, warnings} for delegate.sh.
// Nothing here calls a model: the same task, map and commit always give the same pack.
//
// Task frontmatter (all optional):
//   files:  [paths the task is about]        -> areas, related tests, recent history, scope
//   areas:  [area names from the map]        -> added even when no file names them
//   test:   "narrowest verification command" -> overrides the area commands
//   sealed: [globs the worker must not edit] -> enforced by OpenCode permission and a post-run diff check
//   scope:  [more globs the worker may change] -> with files and their tests: the OUT-OF-SCOPE check
//   red:    false                             -> skip the check that sealed tests fail on the base
//                                                (behaviour-preserving work, e.g. a refactor)
//   steps:  N                                 -> step budget; past it the worker must give its answer
//   issue:  N | owner/repo#N | [..]          -> the GitHub issue (body, comments, its `Spec: #N` issue in
//                                                full, other cited issues cut short) is fetched on the
//                                                host and appended to the task
//
// Context map `requires:` (top level and per area): docs a change must keep current, appended to the
// task as its definition of done.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { globToRegex } from "./glob.mjs";
import { fillTestCmd } from "./testcmd.mjs";
import { fetchIssue, joinIssue } from "./issue.mjs";

const [repo, taskPath, mapPath, outDir, baseRef = "HEAD"] = process.argv.slice(2);
if (!repo || !taskPath || !mapPath || !outDir) {
  console.error("usage: pack.mjs <repo> <task.md> <map.yaml|-> <out-dir>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const warnings = [];

// 1. Task: frontmatter + body.
const raw = fs.readFileSync(taskPath, "utf8").replace(/\r\n/g, "\n");
let front = {};
let body = raw;
const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
if (fm) {
  front = YAML.parse(fm[1]) ?? {};
  body = raw.slice(fm[0].length);
}
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
// GitHub issues: part of the task text, so every role that gets the task (worker, continue, both
// reviewers) gets them. Files the issue itself names count as named; files in cited issues do not.
const issues = [];
for (const ref of asList(front.issue)) {
  try { issues.push(fetchIssue(repo, ref)); } catch (e) { console.error(`agent-box: ${e.message}`); process.exit(2); }
}
const named = [body, ...issues.map((i) => i.main)].join("\n");
if (issues.length) body = `${body.trim()}\n\n${issues.map(joinIssue).join("\n\n")}`;

// 2. Files: named in frontmatter, or path-like tokens in the body that exist in the repo.
const tracked = new Set(git("ls-tree", "-r", "--name-only", baseRef).split("\n").filter(Boolean));
const files = new Set();
for (const f of asList(front.files)) {
  const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
  if (tracked.has(norm)) files.add(norm);
  else warnings.push(`files: ${f} is not a tracked file (new file?)`);
}
for (const m of named.matchAll(/(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)/g)) {
  if (tracked.has(m[1])) files.add(m[1]);
}

// 3. Areas from the map.
const map = mapPath === "-" || !fs.existsSync(mapPath) ? { areas: [], always: [] } : YAML.parse(fs.readFileSync(mapPath, "utf8"));
const areas = [];
const wantNames = new Set(asList(front.areas));
for (const a of map.areas ?? []) {
  const res = asList(a.paths).map(globToRegex);
  const hit = [...files].some((f) => res.some((r) => r.test(f)));
  if (hit || wantNames.has(a.name)) areas.push(a);
}
// Most specific area wins a file it shares with a broader one (e.g. tui/screen over tui), but both stay listed.
for (const n of wantNames) if (!areas.some((a) => a.name === n)) warnings.push(`areas: ${n} is not in the map`);
if (files.size && !areas.length && (map.areas ?? []).length) warnings.push("no map area covers the named files");

// 4. Related tests and history.
const related = new Set();
for (const f of files) {
  if (/\.test\.[cm]?[jt]sx?$/.test(f) || /^src\/test\/java\/.*Test\.java$/.test(f)) { related.add(f); continue; }
  const t = f.replace(/\.([cm]?[jt]sx?)$/, ".test.$1");
  if (t !== f && tracked.has(t)) related.add(t);
  // Java (Maven/Gradle layout): src/main/java/a/Foo.java -> src/test/java/a/FooTest.java
  const j = f.replace(/^src\/main\/java\/(.*)\.java$/, "src/test/java/$1Test.java");
  if (j !== f && tracked.has(j)) related.add(j);
}
const history = [...files].slice(0, 12).map((f) => {
  const log = git("log", "-3", "--date=short", "--format=  %h %ad %s", baseRef, "--", f).trimEnd();
  return `- \`${f}\`\n${log || "  (no history)"}`;
});

// 5. Verification command: explicit, else the narrowest area commands.
const fileCmd = map.test_file_command && related.size ? [fillTestCmd(map.test_file_command, [...related])] : [];
const verify = front.test ? [String(front.test)] : fileCmd.length ? fileCmd : [...new Set(areas.map((a) => a.tests?.command).filter(Boolean))];

// 6. Glossary definitions, quoted from the repo's glossary.
// Read at the base commit, not from the working tree, so a run on an older base gets that base's terms.
const glossary = tracked.has("GLOSSARY.md") ? git("show", `${baseRef}:GLOSSARY.md`).replace(/\r\n/g, "\n") : "";
const terms = [...new Set(areas.flatMap((a) => asList(a.glossary)))];
const defs = terms.map((t) => {
  const i = glossary.indexOf(`**${t}**:`);
  if (i < 0) return `- **${t}**: (not found in GLOSSARY.md)`;
  const block = glossary.slice(i).split("\n\n")[0];
  const text = block.replace(`**${t}**:`, "").replace(/\n_Avoid_:.*$/s, "").replace(/\s+/g, " ").trim();
  return `- **${t}**: ${text.length > 500 ? text.slice(0, 500) + "…" : text}`;
});

// 7. Write the pack.
const sealed = asList(front.sealed);
const docLine = (d) => `- \`${d.path}\`: ${d.reason ?? ""}`;
const sections = [];
sections.push(`# Context pack\n\nGenerated by agent-box from the task file and the project's context map at commit ${git("rev-parse", "--short", baseRef).trim()}. Small files the task names are pasted below; read anything else you need.`);
if (map.prefer_over_agents_md) sections.push(`Project rules: read \`${map.prefer_over_agents_md}\`. If \`AGENTS.md\` disagrees with it, \`${map.prefer_over_agents_md}\` wins.`);
sections.push(`## Files the task names\n\n${files.size ? history.join("\n") : "None named. Locate the code yourself, starting from the task text."}`);
if (areas.length) sections.push(`## Areas\n\n${areas.map((a) => `- \`${a.name}\` (${asList(a.paths).join(", ")})`).join("\n")}`);
const docs = [...(map.always ?? []), ...areas.flatMap((a) => a.docs ?? [])];
const seen = new Set();
const uniqDocs = docs.filter((d) => (seen.has(d.path) ? false : seen.add(d.path)));
if (uniqDocs.length) sections.push(`## Read before changing anything\n\n${uniqDocs.map(docLine).join("\n")}`);
const traps = [...new Set(areas.flatMap((a) => asList(a.traps)))];
if (traps.length) sections.push(`## Rules a change here can break\n\n${traps.map((t) => `- ${t}`).join("\n")}`);
if (defs.length) sections.push(`## Terms (from GLOSSARY.md)\n\n${defs.join("\n")}`);
sections.push(`## Tests\n\n${related.size ? `Related test files:\n${[...related].map((t) => `- \`${t}\``).join("\n")}\n\n` : ""}Verify with:\n${verify.length ? verify.map((v) => `- \`${v}\``).join("\n") : "- the project test command named in the operating conditions"}`);
// Files the worker is certain to read (the named files and sealed tests) are pasted when small: same
// tokens as a read, minus one model round trip each, and they sit in the cacheable prompt prefix.
const PASTE_MAX = 8000, PASTE_TOTAL = 24000;
let pastedChars = 0;
const pasted = [];
for (const f of [...files, ...sealed.filter((s) => !/[*?[]/.test(s))]) {
  if (pasted.some((p) => p.f === f) || !tracked.has(f)) continue;
  const text = git("show", `${baseRef}:${f}`);
  if (text.length > PASTE_MAX || pastedChars + text.length > PASTE_TOTAL || text.includes("\0")) continue;
  pastedChars += text.length;
  pasted.push({ f, text });
}
if (pasted.length) {
  const fence = (t) => "`".repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  sections.push(`## File contents at the start of the run\n\nAlready read for you; do not read these again unless you changed them.\n\n` +
    pasted.map(({ f, text }) => `### \`${f}\`\n\n${fence(text)}\n${text.replace(/\n$/, "")}\n${fence(text)}`).join("\n\n"));
}
if (sealed.length) sections.push(`## Sealed files\n\nYou cannot edit these; the harness rejects any change to them:\n${sealed.map((s) => `- \`${s}\``).join("\n")}\nIf the task cannot be done without changing one, stop and report BLOCKED.`);

// Code index (from AgentOrchestratingSkill's code_index): where the identifiers the task names in
// backticks live. One git grep for all of them; hints that save the worker its first searches.
const idents = [...new Set([...body.matchAll(/`([A-Za-z_][\w.:]{2,59})(?:\(\))?`/g)].map((m) => m[1]))]
  .filter((s) => !tracked.has(s) && !/\.(md|json|ya?ml|txt)$/.test(s)).slice(0, 20);
if (idents.length) {
  const pats = [...new Set(idents.flatMap((s) => (s.includes(".") ? [s, s.split(".").pop()] : [s]).filter((p) => p.length >= 3)))];
  let hits = "";
  try {
    hits = execFileSync("git", ["-C", repo, "grep", "-n", "-I", "-w", "-F", ...pats.flatMap((p) => ["-e", p]), baseRef, "--",
      ".", ":!*.md", ":!docs", ":!.scratch", ":!node_modules", ":!dist", ":!build"], { encoding: "utf8", maxBuffer: 8 << 20 });
  } catch { /* exit 1: no hits */ }
  const lines = hits.split("\n").filter(Boolean).map((l) => l.slice(baseRef.length + 1));
  const out = [];
  for (const p of pats) {
    const mine = lines.filter((l) => new RegExp(`\\b${p.replace(/[.$]/g, "\\$&")}\\b`).test(l.slice(l.indexOf(":", l.indexOf(":") + 1))));
    if (!mine.length) continue;
    out.push(`- \`${p}\`: ${mine.length > 6 ? `${mine.length} hits, first 6` : `${mine.length} hit${mine.length > 1 ? "s" : ""}`}\n` +
      mine.slice(0, 6).map((l) => `  - ${l.replace(/^([^:]+):(\d+):\s*/, "`$1:$2` ").slice(0, 200)}`).join("\n"));
  }
  if (out.length) sections.push(`## Where the names in the task live\n\nFrom \`git grep\` at the base commit. Hints, not truth.\n\n${out.join("\n")}`);
}

// Doc duties: the map's top-level `requires` plus each hit area's. Appended to the task text, not the
// pack, so the fix round and both reviewers get them too. Bench 2026-10-13: Gemini wrote neither the
// ADR nor the glossary entry on two real tickets until the standards review asked.
const DONE = "## Definition of done: documentation";
const duties = [...new Set([...asList(map.requires), ...areas.flatMap((a) => asList(a.requires))])];
if (duties.length && !body.includes(DONE)) {
  body = `${body.trim()}\n\n${DONE}\n\nAdded by agent-box from the project's context map. Each line applies only when the change does what it names; a change that needs one and lacks it is not finished, and the reviewers check for it.\n\n${duties.map((d) => `- ${d}`).join("\n")}`;
}

const context = sections.join("\n\n") + "\n";
if (context.length - pastedChars > 24000) warnings.push(`context pack is ${context.length - pastedChars} chars without pasted files; consider narrowing files/areas`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "context.md"), context);
fs.writeFileSync(path.join(outDir, "task-body.md"), body.trim() + "\n");
// Red check: the narrowest command over the sealed tests, run on the base before the worker starts.
const sealedFiles = sealed.filter((s) => !/[*?[]/.test(s) && tracked.has(s));
let red = "";
if (front.red !== false && sealedFiles.length) {
  if (map.test_file_command) red = fillTestCmd(map.test_file_command, sealedFiles);
  else if (front.test) red = String(front.test);
  else warnings.push("red check skipped: no test_file_command in the context map and no test: in the task");
}
const scope = [...new Set([...files, ...asList(front.scope), ...related, ...sealed])];
const steps = Number(front.steps) > 0 ? Number(front.steps) : 0;
console.log(JSON.stringify({ files: [...files], areas: areas.map((a) => a.name), sealed, test: verify.join(" && "), red, scope,
  scoped: files.size > 0 || asList(front.scope).length > 0, tests: [...related], steps, skills: asList(map.worker_skills), warnings }));

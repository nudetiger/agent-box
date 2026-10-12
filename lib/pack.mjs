// Builds the deterministic context pack for one task, on the host, before the container starts.
//
//   node lib/pack.mjs <repo> <task.md> <context-map.yaml|-> <out-dir> [base-ref]
//
// Writes <out-dir>/task-body.md (the task without frontmatter) and <out-dir>/context.md, and prints a
// JSON line {files, areas, sealed, test, warnings} for delegate.sh. Nothing here calls a model: the same
// task, map and commit always give the same pack.
//
// Task frontmatter (all optional):
//   files:  [paths the task is about]        -> areas, related tests, recent history
//   areas:  [area names from the map]        -> added even when no file names them
//   test:   "narrowest verification command" -> overrides the area commands
//   sealed: [globs the worker must not edit] -> enforced by OpenCode permission and a post-run diff check
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

const [repo, taskPath, mapPath, outDir, baseRef = "HEAD"] = process.argv.slice(2);
if (!repo || !taskPath || !mapPath || !outDir) {
  console.error("usage: pack.mjs <repo> <task.md> <map.yaml|-> <out-dir>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const warnings = [];

export function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

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

// 2. Files: named in frontmatter, or path-like tokens in the body that exist in the repo.
const tracked = new Set(git("ls-tree", "-r", "--name-only", baseRef).split("\n").filter(Boolean));
const files = new Set();
for (const f of asList(front.files)) {
  const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
  if (tracked.has(norm)) files.add(norm);
  else warnings.push(`files: ${f} is not a tracked file (new file?)`);
}
for (const m of body.matchAll(/(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)/g)) {
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
  if (/\.test\.[cm]?[jt]sx?$/.test(f)) { related.add(f); continue; }
  const t = f.replace(/\.([cm]?[jt]sx?)$/, ".test.$1");
  if (t !== f && tracked.has(t)) related.add(t);
}
const history = [...files].slice(0, 12).map((f) => {
  const log = git("log", "-3", "--date=short", "--format=  %h %ad %s", baseRef, "--", f).trimEnd();
  return `- \`${f}\`\n${log || "  (no history)"}`;
});

// 5. Verification command: explicit, else the narrowest area commands.
const fileCmd = map.test_file_command && related.size ? [map.test_file_command.replace("{files}", [...related].join(" "))] : [];
const verify = front.test ? [String(front.test)] : fileCmd.length ? fileCmd : [...new Set(areas.map((a) => a.tests?.command).filter(Boolean))];

// 6. Glossary definitions, quoted from the repo's glossary.
const glossaryFile = path.join(repo, "GLOSSARY.md");
const glossary = fs.existsSync(glossaryFile) ? fs.readFileSync(glossaryFile, "utf8").replace(/\r\n/g, "\n") : "";
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
sections.push(`# Context pack\n\nGenerated by agent-box from the task file and the project's context map at commit ${git("rev-parse", "--short", baseRef).trim()}. File contents are not pasted: read what you need.`);
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
if (sealed.length) sections.push(`## Sealed files\n\nYou cannot edit these; the harness rejects any change to them:\n${sealed.map((s) => `- \`${s}\``).join("\n")}\nIf the task cannot be done without changing one, stop and report BLOCKED.`);

const context = sections.join("\n\n") + "\n";
if (context.length > 24000) warnings.push(`context pack is ${context.length} chars; consider narrowing files/areas`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "context.md"), context);
fs.writeFileSync(path.join(outDir, "task-body.md"), body.trim() + "\n");
console.log(JSON.stringify({ files: [...files], areas: areas.map((a) => a.name), sealed, test: verify.join(" && "), skills: asList(map.worker_skills), warnings }));

// Scope guard for hidden checks. Each task that needs it carries a byte-identical copy at
// hidden/.bench/guard.mjs (validate.mjs checks the copies), because hidden/ must be self-contained.
//
// Check (at the repo root, after hidden/ is copied in):
//   node .bench/guard.mjs
// reads .bench/guard.json {allow: [globs], files: {path: sha256}}, where `files` is the base tree, and
// fails when a base file outside `allow` changed or vanished, or a new file appeared outside `allow`.
// Hashes are of the text with CRLF turned into LF, so a checkout's line endings never count as a change.
//
// Record (authoring a task):
//   node bench/lib/guard.mjs --record <repo> [allow glob ...] > bench/suites/<s>/<task>/hidden/.bench/guard.json
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SKIP = new Set([".git", "node_modules", ".bench"]);

function walk(root, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out.sort();
}

function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
}

function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

if (process.argv[2] === "--record") {
  const [repo, ...allow] = process.argv.slice(3);
  const files = Object.fromEntries(walk(repo).map((f) => [f, hash(path.join(repo, f))]));
  console.log(JSON.stringify({ allow, files }, null, 2));
} else {
  const { allow, files } = JSON.parse(fs.readFileSync(".bench/guard.json", "utf8"));
  const allowed = (f) => allow.some((g) => globToRegex(g).test(f));
  const problems = [];
  for (const [f, sha] of Object.entries(files)) {
    if (allowed(f)) continue;
    if (!fs.existsSync(f)) problems.push(`deleted: ${f}`);
    else if (hash(f) !== sha) problems.push(`changed: ${f}`);
  }
  for (const f of walk(".")) if (!Object.hasOwn(files, f) && !allowed(f)) problems.push(`added: ${f}`);
  if (problems.length) {
    console.error(`guard: outside the allowed files (${allow.join(", ") || "none"}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("guard: ok");
}

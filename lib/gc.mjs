// Disk cleanup (delegate.sh gc). Prints what it would remove; --yes removes it.
//
//   node lib/gc.mjs <runs-dir> [--days N] [--yes]
//
// Removed: session archives (opencode-data.tgz) of runs older than N days (default 14; such a run can
// no longer be continued), every models.json (old runs kept the whole 1 MB model list; nothing reads
// it), and the scratch folders of finished reviews and builds. Kept: everything the ledger and `show`
// read (summary.json, events.jsonl, final.md, logs, the result bundle). Parked runs are never touched.
// 2026-10-17: models.json was 261 MB and the archives 428 MB of 804 MB in runs/.
//
// Outside runs/ (2026-10-24: 4,378 test folders and 97 scratch files in the system temp folder, 79
// agent/* branches in Lykos):
// - host scratch: runs/.tmp entries, and what agent-box and its tests left in the system temp folder
//   before scratch moved to runs/.tmp. A day old at least, so a running launch or test keeps its own.
// - agent/<run> branches of runs older than N days, or of runs no longer in runs/, in the repo each
//   project's runs came from (runs/<project>/.repo, written at launch; else REPO_PATH in
//   projects/<project>.env). Parked runs keep theirs; the run's result.bundle keeps the commits.
// - worktrees under runs/<project>/.worktrees (the ticket report's manual-test checkout) older than N days.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const runsDir = args[0];
if (!runsDir || !fs.existsSync(runsDir)) { console.error("usage: gc.mjs <runs-dir> [--days N] [--yes]"); process.exit(1); }
const di = args.indexOf("--days");
const days = di >= 0 ? Number(args[di + 1]) : 14;
const yes = args.includes("--yes");
const cutoff = Date.now() - days * 86400e3;
const dayAgo = Date.now() - 86400e3;
const tmpRoot = process.env.AGENT_BOX_GC_TMP ?? os.tmpdir();

const victims = [];
const size = (p) => {
  try {
    const s = fs.lstatSync(p);
    if (!s.isDirectory()) return s.size;
    return fs.readdirSync(p).reduce((n, e) => n + size(path.join(p, e)), 0);
  } catch { return 0; }
};
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
for (const project of fs.readdirSync(runsDir)) {
  const pdir = path.join(runsDir, project);
  if (!fs.statSync(pdir).isDirectory() || project.startsWith(".")) {
    if (/^\.build-/.test(project)) victims.push({ p: pdir, why: "build context" });
    continue;
  }
  for (const run of fs.readdirSync(pdir)) {
    const rdir = path.join(pdir, run);
    let st; try { st = fs.statSync(rdir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (/^\.review-/.test(run)) { if (st.mtimeMs < cutoff) victims.push({ p: rdir, why: "review scratch" }); continue; }
    if (fs.existsSync(path.join(rdir, "parked"))) continue;
    const m = path.join(rdir, "models.json");
    if (fs.existsSync(m)) victims.push({ p: m, why: "model list" });
    const tgz = path.join(rdir, "opencode-data.tgz");
    if (fs.existsSync(tgz) && fs.statSync(tgz).mtimeMs < cutoff) victims.push({ p: tgz, why: `session older than ${days} days` });
  }
}

// Host scratch.
const scratch = path.join(runsDir, ".tmp");
if (fs.existsSync(scratch)) for (const e of fs.readdirSync(scratch)) {
  const p = path.join(scratch, e);
  if (mtime(p) < dayAgo) victims.push({ p, why: "scratch (runs/.tmp)" });
}
// The exact names agent-box and its tests used: mktemp's and mkdtemp's six random characters.
const LEFTOVER = /^(agent-box-(rulings\.|stats-|test-)|ab-[a-z]+-|recover-final-)[A-Za-z0-9]{6}$/;
try {
  for (const e of fs.readdirSync(tmpRoot)) {
    const p = path.join(tmpRoot, e);
    if (LEFTOVER.test(e) && mtime(p) < dayAgo) victims.push({ p, why: "system temp leftovers" });
  }
} catch { /* no temp folder */ }

// Branches and worktrees, per project repo.
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const repoOf = (project) => {
  const rec = path.join(runsDir, project, ".repo");
  if (fs.existsSync(rec)) return fs.readFileSync(rec, "utf8").trim();
  const env = path.join(runsDir, "..", "projects", `${project}.env`);
  const m = fs.existsSync(env) && fs.readFileSync(env, "utf8").match(/^(?:export\s+)?REPO_PATH=['"]?([^'"\n]*)['"]?\s*$/m);
  return m ? m[1].trim() : "";
};
const winPath = (p) => p.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`);
const refs = [];
for (const project of fs.readdirSync(runsDir)) {
  const pdir = path.join(runsDir, project);
  if (project.startsWith(".") || !fs.statSync(pdir).isDirectory()) continue;
  const repo = winPath(repoOf(project));
  if (!repo || !fs.existsSync(repo)) continue;
  let list = "";
  try { list = git(repo, "for-each-ref", "--format=%(refname:short) %(committerdate:unix)", "refs/heads/agent/"); } catch { continue; }
  for (const line of list.split("\n").filter(Boolean)) {
    const [branch, when] = line.split(" ");
    const rdir = path.join(pdir, branch.slice("agent/".length));
    if (fs.existsSync(path.join(rdir, "parked"))) continue;
    // A running run's folder changes all the time; runs from before `ended` existed have a summary.
    const ended = fs.existsSync(rdir) ? mtime(path.join(rdir, "ended")) || mtime(path.join(rdir, "summary.json")) || mtime(rdir) : Number(when) * 1000;
    if (ended < cutoff) refs.push({ repo, branch, why: `agent/* branches older than ${days} days` });
  }
  const wtDir = path.resolve(pdir, ".worktrees");
  if (fs.existsSync(wtDir)) for (const e of fs.readdirSync(wtDir)) {
    const p = path.join(wtDir, e);
    if (mtime(p) < cutoff) victims.push({ p, why: `worktrees older than ${days} days`, repo });
  }
}

let total = 0;
const by = {};
for (const v of victims) { v.size = size(v.p); total += v.size; (by[v.why] ??= { n: 0, size: 0 }).n++; by[v.why].size += v.size; }
for (const r of refs) (by[r.why] ??= { n: 0, size: 0 }).n++;
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
for (const [why, x] of Object.entries(by)) console.log(`${String(x.n).padStart(5)}  ${mb(x.size).padStart(10)}  ${why}`);
console.log(`total ${mb(total)}${yes ? " removed" : " (dry run: add --yes to remove)"}`);
if (yes) {
  for (const v of victims) {
    if (v.repo) try { git(v.repo, "worktree", "remove", "--force", v.p); } catch { /* not a worktree any more */ }
    try { fs.rmSync(v.p, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { console.error(`could not remove ${v.p}: ${e.code ?? e.message}`); }
  }
  for (const repo of new Set(victims.filter((v) => v.repo).map((v) => v.repo))) try { git(repo, "worktree", "prune"); } catch { /* nothing to prune */ }
  for (const r of refs) try { git(r.repo, "branch", "-D", r.branch); } catch { console.error(`kept ${r.branch} in ${r.repo} (checked out somewhere)`); }
}

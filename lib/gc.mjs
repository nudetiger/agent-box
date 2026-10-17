// Disk cleanup for runs/ (delegate.sh gc). Prints what it would remove; --yes removes it.
//
//   node lib/gc.mjs <runs-dir> [--days N] [--yes]
//
// Removed: session archives (opencode-data.tgz) of runs older than N days (default 14; such a run can
// no longer be continued), every models.json (old runs kept the whole 1 MB model list; nothing reads
// it), and the scratch folders of finished reviews and builds. Kept: everything the ledger and `show`
// read (summary.json, events.jsonl, final.md, logs, the result bundle). Parked runs are never touched.
// 2026-10-17: models.json was 261 MB and the archives 428 MB of 804 MB in runs/.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const runsDir = args[0];
if (!runsDir || !fs.existsSync(runsDir)) { console.error("usage: gc.mjs <runs-dir> [--days N] [--yes]"); process.exit(1); }
const di = args.indexOf("--days");
const days = di >= 0 ? Number(args[di + 1]) : 14;
const yes = args.includes("--yes");
const cutoff = Date.now() - days * 86400e3;

const victims = [];
const size = (p) => {
  try {
    const s = fs.statSync(p);
    if (!s.isDirectory()) return s.size;
    return fs.readdirSync(p).reduce((n, e) => n + size(path.join(p, e)), 0);
  } catch { return 0; }
};
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
let total = 0;
const by = {};
for (const v of victims) { v.size = size(v.p); total += v.size; (by[v.why] ??= { n: 0, size: 0 }).n++; by[v.why].size += v.size; }
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
for (const [why, x] of Object.entries(by)) console.log(`${String(x.n).padStart(5)}  ${mb(x.size).padStart(10)}  ${why}`);
console.log(`total ${mb(total)}${yes ? " removed" : " (dry run: add --yes to remove)"}`);
if (yes) for (const v of victims) fs.rmSync(v.p, { recursive: true, force: true });

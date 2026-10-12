#!/usr/bin/env node
// node bench/validate.mjs [suite] [task]
//
// Proves each fixture task's hidden check measures what it claims, in throwaway clones of the base:
//   base       hidden/ copied onto the untouched base, check run    -> FAIL (pass tasks), PASS (blocked tasks)
//   reference  reference.patch applied, hidden/ copied, check run   -> PASS; absent for blocked tasks
//   cheat*     each cheat*.patch applied, hidden/ copied, check run -> FAIL (a known wrong answer is caught)
// It also runs the task's visible `test:` before hidden/ goes in: it must pass on the reference, fail on
// the base when the task seals a failing test (else agent-box would flag WEAK-SPEC), and pass on the base
// of a blocked task. Every check must finish in under 10 s. Tasks with `validated: false` are skipped.
// Prints a table; exits 1 on any mismatch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { BENCH, git, materialize } from "./materialize.mjs";

const CHECK_LIMIT_S = 10;
const [suiteArg = "core", taskArg] = process.argv.slice(2);
const suiteDir = path.join(BENCH, "suites", suiteArg);
if (!fs.existsSync(suiteDir)) {
  console.error(`no suite ${suiteArg}`);
  process.exit(2);
}
const tasks = fs
  .readdirSync(suiteDir)
  .filter((t) => fs.existsSync(path.join(suiteDir, t, "bench.yaml")))
  .filter((t) => !taskArg || t === taskArg)
  .sort();
if (!tasks.length) {
  console.error(`no task ${taskArg ?? ""} in suite ${suiteArg}`);
  process.exit(2);
}
const guardSource = fs.readFileSync(path.join(BENCH, "lib", "guard.mjs"));

function frontmatter(file) {
  const m = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/);
  return m ? (YAML.parse(m[1]) ?? {}) : {};
}

function sh(cmd, cwd) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: 60_000 });
  return { ok: r.status === 0, s: Number(process.hrtime.bigint() - t0) / 1e9, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Clone the base, apply `patch`, run the visible test, copy hidden/ in, run the check. */
function scenario(repo, patch, hidden, check, visible) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-"));
  try {
    git(os.tmpdir(), ["clone", "-q", "-c", "core.autocrlf=false", repo, dir]);
    if (patch) {
      try {
        git(dir, ["apply", "--whitespace=nowarn", patch]);
      } catch (err) {
        return { error: `patch ${path.basename(patch)} does not apply: ${err.stderr || err.message}` };
      }
    }
    const test = visible ? sh(visible, dir) : null;
    if (fs.existsSync(hidden)) fs.cpSync(hidden, dir, { recursive: true });
    return { test, check: sh(check, dir) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const word = (r) => (r === undefined ? "-" : r.ok ? "PASS" : "FAIL");
const rows = [];
const details = [];
let bad = 0;

for (const id of tasks) {
  const dir = path.join(suiteDir, id);
  const meta = YAML.parse(fs.readFileSync(path.join(dir, "bench.yaml"), "utf8"));
  if (meta.validated === false || meta.repo) {
    rows.push([id, meta.kind, meta.difficulty, meta.expect, "-", "-", "-", "-", "-", "-", "skipped"]);
    continue;
  }
  const front = frontmatter(path.join(dir, "task.md"));
  const hidden = path.join(dir, "hidden");
  const problems = [];

  const { repo } = materialize(meta.fixture);
  const tracked = new Set(git(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n"));
  for (const f of [].concat(front.sealed ?? [], front.files ?? [])) {
    if (!/[*?[]/.test(f) && !tracked.has(f)) problems.push(`frontmatter names ${f}, not in the base`);
  }
  const guardCopy = path.join(hidden, ".bench", "guard.mjs");
  if (fs.existsSync(guardCopy) && !fs.readFileSync(guardCopy).equals(guardSource)) {
    problems.push("hidden/.bench/guard.mjs differs from bench/lib/guard.mjs");
  }

  const blocked = meta.expect === "blocked";
  const refPatch = path.join(dir, "reference.patch");
  const cheats = fs.readdirSync(dir).filter((f) => /^cheat.*\.patch$/.test(f)).sort();
  const base = scenario(repo, null, hidden, meta.check, front.test);
  const ref = fs.existsSync(refPatch) ? scenario(repo, refPatch, hidden, meta.check, front.test) : null;
  const cheatRuns = cheats.map((c) => ({ name: c, ...scenario(repo, path.join(dir, c), hidden, meta.check, null) }));

  for (const r of [base, ref, ...cheatRuns]) if (r?.error) problems.push(r.error);
  if (blocked) {
    if (ref) problems.push("blocked task has a reference.patch");
    if (!cheats.length) problems.push("blocked task needs a cheat*.patch to prove its check");
    if (base.check && !base.check.ok) problems.push("check fails on the untouched base (doing nothing must pass)");
    if (base.test && !base.test.ok) problems.push("visible test fails on the base");
  } else {
    if (!ref) problems.push("no reference.patch");
    if (base.check?.ok) problems.push("check passes on the base");
    if (ref?.check && !ref.check.ok) problems.push("check fails on the reference");
    if (ref?.test && !ref.test.ok) problems.push("visible test fails on the reference");
    if (front.sealed?.length && base.test?.ok) problems.push("sealed visible test already passes on the base (WEAK-SPEC)");
  }
  for (const c of cheatRuns) if (c.check?.ok) problems.push(`${c.name} passes the check`);
  const times = [base, ref, ...cheatRuns].map((r) => r?.check?.s ?? 0);
  const maxS = Math.max(...times);
  if (maxS > CHECK_LIMIT_S) problems.push(`check took ${maxS.toFixed(1)} s`);

  const cheatWord = cheatRuns.length ? cheatRuns.map((c) => word(c.check)).join(",") : "-";
  rows.push([
    id,
    meta.kind,
    meta.difficulty,
    meta.expect,
    word(base.check),
    word(ref?.check),
    cheatWord,
    word(base.test ?? undefined),
    word(ref?.test ?? undefined),
    maxS.toFixed(1),
    problems.length ? "MISMATCH" : "ok",
  ]);
  if (problems.length) {
    bad++;
    const tail = (r) => (r?.check ? r.check.out.trim().split("\n").slice(-15).join("\n    ") : "");
    details.push(`${id}:\n  - ${problems.join("\n  - ")}\n  base check output:\n    ${tail(base)}\n  reference check output:\n    ${tail(ref)}`);
  }
}

const header = ["task", "kind", "d", "expect", "base", "reference", "cheats", "test@base", "test@ref", "max s", "result"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const fmt = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
console.log(fmt(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
if (details.length) console.log(`\n${details.join("\n\n")}`);
console.log(`\n${rows.length - bad}/${rows.length} ok (suite ${suiteArg})`);
process.exit(bad ? 1 : 0);

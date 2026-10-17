// Benchmark runner: every task of a frozen suite (bench/suites/<suite>/<task>/) through the harness, per
// role, then the task's hidden check in a fresh container on the worker's result. Results are `bench`
// events in the ledger; `delegate.sh stats bench` shows them. Format: bench/README.md.
//
//   node lib/bench.mjs list [suite]
//   node lib/bench.mjs run <suite[/task][,suite/task...]> --roles a,b [--repeat N] [--parallel K] [--steps N]
//
// A run's pass is the hidden check's verdict, never the worker's report: expect `pass` tasks pass when
// the check exits 0; expect `blocked` tasks pass when the worker stopped BLOCKED and the check (behaviour
// intact, tests untouched) exits 0.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { append, readAll } from "./ledger.mjs";
import { readJson } from "./checks.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = path.join(BOX, "bench", "suites");
const die = (m) => { console.error(`bench: ${m}`); process.exit(1); };

function tasks(spec) {
  const out = [];
  for (const part of String(spec || "").split(",").filter(Boolean)) {
    const [suite, task] = part.split("/");
    const dir = path.join(SUITES, suite);
    if (!fs.existsSync(dir)) die(`no suite ${suite} in bench/suites`);
    for (const t of fs.readdirSync(dir).sort()) {
      if (task && t !== task) continue;
      const tdir = path.join(dir, t), y = path.join(tdir, "bench.yaml");
      if (!fs.existsSync(y)) continue;
      out.push({ suite, task: t, dir: tdir, cfg: YAML.parse(fs.readFileSync(y, "utf8")) ?? {} });
    }
  }
  if (!out.length) die(`no tasks match ${spec}`);
  return out;
}

const run = (cmd, args, env = {}, logFile) => new Promise((resolve) => {
  const fd = logFile ? fs.openSync(logFile, "w") : "inherit";
  const p = spawn(cmd, args, { stdio: ["ignore", fd, fd], env: { ...process.env, ...env } });
  p.on("close", (code) => { if (logFile) fs.closeSync(fd); resolve(code); });
});

function repoFor(t) {
  if (t.cfg.fixture) {
    const out = execFileSync("node", [path.join(BOX, "bench", "materialize.mjs"), t.cfg.fixture], { encoding: "utf8" }).trim().split("\n").pop();
    return { repo: out, base: "HEAD", fixture: true };
  }
  // AGENT_BOX_REPOS: a folder holding the real repos by folder name (a worktree, another machine's
  // layout); the path in bench.yaml is only where they were mined.
  if (t.cfg.repo?.path) {
    const alt = process.env.AGENT_BOX_REPOS ? path.join(process.env.AGENT_BOX_REPOS, path.basename(t.cfg.repo.path)) : null;
    return { repo: alt && fs.existsSync(alt) ? alt : t.cfg.repo.path, base: t.cfg.repo.commit, fixture: false };
  }
  die(`${t.suite}/${t.task}: bench.yaml has neither fixture nor repo`);
}

async function attempt(t, role, k, o) {
  const { repo, base, fixture } = repoFor(t);
  const project = path.basename(repo).toLowerCase();
  const runs = path.join(BOX, "runs", project);
  let name = `bench-${t.task}-${role}-${k}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  // A name is free when neither its run folder nor its branch exists (a repo shared with another checkout
  // has the other's agent/bench-* branches).
  const taken = (n) => fs.existsSync(path.join(runs, n))
    || (() => { try { execFileSync("git", ["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/agent/${n}`]); return true; } catch { return false; } })();
  for (let i = 2; taken(name); i++) name = `bench-${t.task}-${role}-${k}-${i}`;
  fs.mkdirSync(runs, { recursive: true });
  const logf = path.join(runs, `.${name}.log`);
  // Benchmarks show the feed only (the OpenCode TUI costs ~700 MB per worker) and close their tabs.
  const env = { AGENT_BOX_TUI: process.env.AGENT_BOX_TUI ?? "0", AB_TAB_LINGER: process.env.AB_TAB_LINGER ?? "30",
    ...(fixture ? { AGENT_BOX_PROJECT_ENV: path.join(BOX, "projects", "bench.env") } : {}) };
  const args = [path.join(BOX, "delegate.sh"), "run", repo, path.join(t.dir, "task.md"), "--role", role, "--name", name,
    "--bench", `${t.suite}/${t.task}`, "--base", base, ...(t.cfg.timeout_min ? ["--timeout", String(t.cfg.timeout_min)] : []),
    ...(o.steps ? ["--steps", String(o.steps)] : [])];
  console.log(`bench: ${name} starts`);
  await run("bash", args, env, logf);
  const s = readJson(path.join(runs, name, "summary.json"));
  const ev = readAll().filter((e) => e.type === "run" && e.project === project && e.run === name).at(-1);
  // Hidden check on the worker's result (or the base, when it made no commits), in a fresh container.
  let checkExit = -1, checkS = null;
  if (s && t.cfg.check) {
    const ref = s.commits > 0 ? `agent/${name}` : s.base;
    const hidden = path.join(t.dir, "hidden");
    const t0 = Date.now();
    await run("bash", [path.join(BOX, "delegate.sh"), "check", repo, ref, "--test", t.cfg.check, "--name", `${name}-check`,
      ...(fs.existsSync(hidden) ? ["--hidden", hidden] : [])], env, path.join(runs, `.${name}-check.log`));
    checkS = Math.round((Date.now() - t0) / 1000);
    checkExit = readJson(path.join(runs, `${name}-check`, "summary.json"))?.test_exit ?? -1;
  }
  const expect = t.cfg.expect ?? "pass";
  const pass = expect === "blocked" ? s?.verdict === "blocked" && checkExit === 0 : checkExit === 0;
  if (ev) append("bench", { suite: t.suite, task: t.task, target: ev.id, pass, expect, check_exit: checkExit, check_s: checkS,
    verdict: s?.verdict ?? null, kind: t.cfg.kind ?? null, difficulty: t.cfg.difficulty ?? null },
    { project, run: name, role, model: ev.model });
  // The branch was only needed for the check; the ledger and runs/ keep the evidence.
  if (fixture) try { execFileSync("git", ["-C", repo, "branch", "-D", `agent/${name}`], { stdio: "ignore" }); } catch { /* no branch */ }
  const row = { name, task: `${t.suite}/${t.task}`, role, pass, verdict: s?.verdict ?? "none", check: checkExit, s: s?.seconds ?? null,
    steps: ev?.steps ?? null, tok: ev?.tokens ? ev.tokens.input + ev.tokens.cache_read : null, flags: (s?.flags ?? []).map((f) => f.flag).join(",") };
  console.log(`bench: ${name} ${pass ? "PASS" : "FAIL"} (verdict ${row.verdict}, check ${checkExit}, ${row.s}s)`);
  return row;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, spec, ...rest] = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) o[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i];
  if (cmd === "list") {
    for (const s of spec ? [spec] : fs.readdirSync(SUITES)) for (const t of tasks(s))
      console.log(`${`${t.suite}/${t.task}`.padEnd(36)} ${String(t.cfg.kind ?? "").padEnd(9)} d${t.cfg.difficulty ?? "?"} expect ${String(t.cfg.expect ?? "pass").padEnd(8)} ${t.cfg.measures ?? ""}`);
  } else if (cmd === "run") {
    if (!o.roles) die("run needs --roles a,b");
    if (!fs.existsSync(path.join(BOX, "projects", "bench.env"))) die("projects/bench.env is missing: copy projects/example.env and fill OMNIROUTE_API_KEY");
    const list = tasks(spec);
    const jobs = [];
    for (let k = 1; k <= Number(o.repeat ?? 1); k++) for (const t of list) for (const r of String(o.roles).split(",")) jobs.push([t, r, k]);
    console.log(`bench: ${jobs.length} attempt(s), ${o.parallel ?? 2} at a time`);
    const rows = await pool(jobs, Number(o.parallel ?? 2), ([t, r, k]) => attempt(t, r, k, o));
    console.log(`\n${"task".padEnd(34)} ${"role".padEnd(14)} pass  ${"verdict".padEnd(10)} check  secs  steps  tokens  flags`);
    for (const r of rows) console.log(`${r.task.padEnd(34)} ${r.role.padEnd(14)} ${r.pass ? " ✓  " : " ✗  "}  ${r.verdict.padEnd(10)} ${String(r.check).padStart(5)} ${String(r.s ?? "–").padStart(5)} ${String(r.steps ?? "–").padStart(6)} ${String(r.tok ?? "–").padStart(7)}  ${r.flags}`);
    const by = {};
    for (const r of rows) (by[r.role] ??= []).push(r.pass);
    for (const [r, p] of Object.entries(by)) console.log(`${r}: ${p.filter(Boolean).length}/${p.length} passed`);
  } else die("usage: see the header of lib/bench.mjs");
}

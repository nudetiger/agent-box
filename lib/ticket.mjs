// Ticket mode, ported from AgentOrchestratingSkill: Matt Pocock `to-tickets` tickets run end to end.
// A stronger model writes failing tests first, the harness checks and locks them, the implementer makes
// them pass, two reviewers check spec and standards, and an approved ticket lands as one commit on a
// local integration branch box/<feature>. Everything here is deterministic; models only write tests,
// write code and review. Called through delegate.sh (ticket, feature, land, defect).
//
//   node lib/ticket.mjs run    <repo> <feature>/issues/NN-slug.md [--role R] [--tests-role R]
//   node lib/ticket.mjs review <repo> <run>                 two-axis review of a ticket run (after a fix round)
//   node lib/ticket.mjs land   <repo> <run> [--force]       commit onto box/<feature>, stamp the ticket done
//   node lib/ticket.mjs status|next|report <repo> <feature-dir>
//   node lib/ticket.mjs run-feature <repo> <feature-dir> [--parallel N] [--auto-land]
//   node lib/ticket.mjs defect <repo> <feature-dir> "<title>" "<what you did, saw, expected>"
//   node lib/ticket.mjs hunt   <repo> <bug.md> [--base REF] [--name N] [--role R]
//                                                   reproduce, locate and pin a reported bug; prints the fix task
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { append, readAll } from "./ledger.mjs";
import { readJson } from "./checks.mjs";
import { globToRegex } from "./glob.mjs";
import { specRole } from "./family.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DELEGATE = path.join(BOX, "delegate.sh");
const PROMPTS = path.join(BOX, "lib", "ticket");
const DEFAULT_TEST_GLOBS = ["**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*.py", "src/test/**", "**/__tests__/**", "test/**", "tests/**"];

const die = (m) => { console.error(`ticket: ${m}`); process.exit(1); };
const log = (m) => console.error(`ticket: ${m}`);
const pad = (n) => String(n).padStart(2, "0");
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
const tryGit = (repo, ...a) => { try { return git(repo, ...a); } catch { return null; } };
const read = (f) => { try { return fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"); } catch { return null; } };

// ─── project ─────────────────────────────────────────────────────────────────────────────
export function project(repoArg) {
  const repo = git(repoArg, "rev-parse", "--show-toplevel");
  const name = path.basename(repo).toLowerCase();
  const map = (() => { const t = read(path.join(BOX, "projects", `${name}.context.yaml`)); return t ? YAML.parse(t) ?? {} : {}; })();
  const env = projectSettings(read(path.join(BOX, "projects", `${name}.env`)) ?? "");
  const runs = path.join(BOX, "runs", name);
  return { repo, name, map, env, runs, testGlobs: map.test_globs ?? DEFAULT_TEST_GLOBS };
}
// KEY=value settings from projects/<name>.env, read as bash reads them: a quoted value up to its
// closing quote, a bare one up to " #". Role lines override agent-box.conf for that project. The
// OmniRoute key is never read here.
export function projectSettings(text) {
  const env = {};
  for (const l of text.split("\n")) {
    const m = l.match(/^(?:export\s+)?(TEST_CMD|TICKET_CHECKS|LAND_TRAILERS|ROLE_\w+|TICKET_ESCALATE_ROLE|TICKET_ESCALATE_AFTER|LOOP_\w+)=(.*)$/);
    if (!m) continue;
    const v = m[2].trim(), q = v.match(/^(["'])(.*?)\1\s*(#.*)?$/);
    env[m[1]] = q ? q[2] : v.replace(/\s+#.*$/, "");
  }
  return env;
}
const isTest = (P, f) => P.testGlobs.some((g) => globToRegex(g).test(f) || globToRegex(g).test(path.posix.basename(f)));

// ─── tickets (format: Matt Pocock's to-tickets, as AgentOrchestratingSkill's ticket_meta) ──
export function ticketMeta(file) {
  const t = read(file) ?? die(`no ticket at ${file}`);
  const base = path.basename(file, ".md");
  const field = (n) => (t.match(new RegExp(`\\*\\*${n}:\\*\\*\\s*([^·\\n]*)`))?.[1] ?? "").trim() || null;
  const blocked = field("Blocked by") ?? "";
  return {
    path: file, id: base, num: Number(base.match(/^(\d+)/)?.[1] ?? NaN),
    title: (t.match(/^#\s*[0-9]*\s*[:.-]?\s*([^\n]+)/m)?.[1] ?? base).trim(),
    blocked_by: /^\s*none/i.test(blocked) || !blocked ? [] : [...new Set([...blocked.matchAll(/(?<![0-9])([0-9]{1,3})(?![0-9])/g)].map((m) => Number(m[1])))],
    status: field("Status"), model: field("Model"), difficulty: field("Difficulty"), type: field("Type"),
    criteria: [...t.matchAll(/^\s*[-*] \[[ xX]\] (.+)$/gm)].map((m) => m[1].trim()), text: t,
  };
}
function doneDir(P, fdir) {
  if (P.map.done_dir) return path.join(fdir, P.map.done_dir);
  for (const d of ["issues/done", "done"]) if (fs.existsSync(path.join(fdir, d))) return path.join(fdir, d);
  return path.join(fdir, "issues", "done");
}
function featureTickets(P, fdir) {
  const all = new Map();
  const add = (dir, done) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((f) => /^\d+.*\.md$/.test(f)).sort()) {
      const m = ticketMeta(path.join(dir, f));
      all.set(m.id, { ...m, done: done || /^done/i.test(m.status ?? "") });
    }
  };
  add(path.join(fdir, "issues"), false);
  add(doneDir(P, fdir), true);
  return [...all.values()].sort((a, b) => a.num - b.num);
}
function withState(P, fdir) {
  const all = featureTickets(P, fdir);
  const done = new Set(all.filter((t) => t.done).map((t) => t.num));
  const feature = path.basename(fdir);
  return all.map((t) => {
    const st = readJson(path.join(P.runs, "_tickets", `${feature}-${pad(t.num)}`, "state.json"));
    const running = st && !st.landed && !t.done;
    return { ...t, state: t.done ? "done" : running ? (st.next ?? "running") : t.blocked_by.every((b) => done.has(b)) ? "ready" : "blocked",
      waiting_on: t.blocked_by.filter((b) => !done.has(b)) };
  });
}
// Open tickets that depend on this one, directly or not.
function lookahead(all, num) {
  const set = new Set([num]);
  for (let changed = true; changed;) {
    changed = false;
    for (const t of all) if (!t.done && !set.has(t.num) && t.blocked_by.some((b) => set.has(b))) { set.add(t.num); changed = true; }
  }
  return all.filter((t) => set.has(t.num) && t.num !== num);
}
const featureHome = (P, feature) => path.join(P.runs, "_features", feature);
const decisionsFile = (P, feature) => path.join(featureHome(P, feature), "decisions.md");

// ─── delegate.sh ─────────────────────────────────────────────────────────────────────────
function delegate(args, env = {}, logFile) {
  return new Promise((resolve) => {
    const out = logFile ? fs.openSync(logFile, "w") : "inherit";
    const p = spawn("bash", [DELEGATE, ...args], { stdio: ["ignore", out, out], env: { ...process.env, ...env } });
    p.on("close", (code) => { if (logFile) fs.closeSync(out); resolve(code); });
  });
}
const summary = (P, run) => readJson(path.join(P.runs, run, "summary.json"));
const uniqueRun = (P, name) => { let n = name, k = 2; while (fs.existsSync(path.join(P.runs, n))) n = `${name}-${k++}`; return n; };
export function testFileCmd(P, files) {
  const cmd = P.map.test_file_command;
  if (!cmd) return null;
  const gradle = files.filter((f) => /^src\/test\/java\/.*\.java$/.test(f))
    .map((t) => `--tests ${t.replace(/^src\/test\/java\//, "").replace(/\.java$/, "").replace(/\//g, ".")}`).join(" ");
  return cmd.replace("{files}", files.join(" ")).replace("{tests}", gradle);
}
function frontmatter(o) { return `---\n${YAML.stringify(o).trim()}\n---\n`; }
const fence = (t) => "`".repeat(Math.max(3, ...[...String(t).matchAll(/`+/g)].map((m) => m[0].length + 1)));
const quoteBlock = (title, text) => `## ${title}\n\n${fence(text)}markdown\n${String(text).trim()}\n${fence(text)}\n`;

function contextFor(P, fdir, meta) {
  const feature = path.basename(fdir), all = featureTickets(P, fdir);
  const spec = read(path.join(fdir, "spec.md")) ?? "No spec.md for this feature.";
  const later = lookahead(all, meta.num);
  const decisions = read(decisionsFile(P, feature)) ?? "No earlier ticket of this feature has landed yet.";
  return [
    quoteBlock(`Ticket ${pad(meta.num)}: ${meta.title}`, meta.text),
    quoteBlock("Feature spec (its implementation and testing decisions are the architecture)", spec),
    quoteBlock("Later tickets that build on this one (leave room for them; do not build them)",
      later.length ? later.map((t) => t.text.trim()).join("\n\n---\n\n") : "None: nothing later depends on this ticket."),
    quoteBlock("Decisions of earlier tickets in this feature", decisions),
  ].join("\n");
}

// ─── the test gate (AgentOrchestratingSkill tests.sh, on the host, git only) ──────────────
function testGate(P, base, run, s, block) {
  const problems = [];
  const branch = `agent/${run}`;
  const has = s && s.commits > 0 && tryGit(P.repo, "rev-parse", "--verify", "--quiet", `${branch}^{commit}`);
  const changed = has ? git(P.repo, "diff", "--name-only", `${base}..${branch}`).split("\n").filter(Boolean) : [];
  const files = changed.filter((f) => isTest(P, f)), nontest = changed.filter((f) => !isTest(P, f));
  const mode = block?.mode ?? null;
  if (!s) problems.push("the test writer's run produced no summary");
  else if (s.blocked) problems.push(`the test writer stopped BLOCKED: ${s.blocked}`);
  if (!block) problems.push("no agent-box-tests block in the final message");
  if (nontest.length) problems.push(`changed files that are not tests: ${nontest.join(", ")}`);
  for (const f of s?.flags ?? []) if (f.flag === "STAND-IN") problems.push(`switches a test off or leaves a stand-in: ${f.detail}`);
  if (mode === "red") {
    if (!files.length) problems.push("mode red but no test files were written");
    else if (s.test_exit === 0) problems.push("the new tests pass on the current code; red tests must fail before the implementation exists");
  } else if (mode === "refactor") {
    if (s.test_exit > 0) problems.push(`mode refactor but the tests fail on the current code (exit ${s.test_exit})`);
  } else if (mode === "none") {
    if (files.length) problems.push(`mode none but test files changed: ${files.join(", ")}`);
  } else if (mode) problems.push(`unknown mode ${mode}`);
  return { ok: problems.length === 0, mode, files, problems };
}

// The test writer's test command: only the test files it changed, through the single-file command.
export function redCommand(P) {
  // grep -E has no (?:...) group: it warns "? at start of expression" and the pattern stops matching.
  const pats = P.testGlobs.map((g) => globToRegex(g).source.replace(/\(\?:/g, "(").replace(/^\^/, "(^|/)").replace(/\$$/, "$"));
  const fileCmd = P.map.test_file_command ?? die("ticket mode needs test_file_command in the project's context map");
  return `bash /opt/agent-box/changed-tests.sh '${fileCmd.replace(/'/g, "'\\''")}' ${pats.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ")}`;
}

// ─── bug hunt ────────────────────────────────────────────────────────────────────────────
// A reported bug with no known location: the bughunt role reproduces it, locates it and commits a
// failing test, nothing else. The harness checks the test fails on the base (mode tests, the same gate
// as ticket mode's test writer), gives one fix round, and writes the fix task: the bug report, the
// hunt's location and notes, the test sealed. The orchestrator runs that task with --role implement.
async function hunt(P, bugPath, o = {}) {
  const raw = read(bugPath) ?? die(`no such bug report ${bugPath}`);
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = fm ? YAML.parse(fm[1]) ?? {} : {};
  const report = (fm ? raw.slice(fm[0].length) : raw).trim();
  const hdir = path.join(P.runs, "_hunts");
  fs.mkdirSync(hdir, { recursive: true });
  let run = uniqueRun(P, o.name ?? `hunt-${path.basename(bugPath, ".md")}`);
  const first = run;
  // The report's own frontmatter (issue:, files:, areas:) still feeds the context pack.
  const keep = Object.fromEntries(Object.entries(front).filter(([k]) => ["issue", "files", "areas", "steps"].includes(k)));
  const task = path.join(hdir, `${run}.md`);
  fs.writeFileSync(task, frontmatter({ ...keep, scope: P.testGlobs, red: false, test: redCommand(P) })
    + read(path.join(PROMPTS, "hunt.md")) + "\n## The bug report\n\n" + report + "\n");
  log(`hunt: ${o.role ?? "bughunt"} on ${o.base ?? "HEAD"} (${run})`);
  await delegate(["run", P.repo, task, "--role", o.role ?? "bughunt", ...(o.base ? ["--base", o.base] : []), "--name", run, "--mode", "tests", "--no-autofix"],
    {}, path.join(hdir, `${run}.log`));
  const base = summary(P, run)?.base;
  const gateOf = (r) => {
    const g = testGate(P, base, r, summary(P, r), finalBlockOf(P, r, "agent-box-tests"));
    if (g.mode && g.mode !== "red" && g.mode !== "none") g.problems.push(`a bug hunt ends in mode red or none, not ${g.mode}`);
    return { ...g, ok: g.problems.length === 0 };
  };
  let gate = base ? gateOf(run) : { ok: false, mode: null, files: [], problems: ["the hunt produced no summary"] };
  if (!gate.ok && summary(P, run)?.session && !summary(P, run)?.blocked) {
    const msg = path.join(hdir, `${run}-fix.md`);
    fs.writeFileSync(msg, `The harness checked your test and it is not acceptable yet. Fix exactly these, change only test files, commit, and end with both blocks again:\n\n${gate.problems.map((p) => `- ${p}`).join("\n")}\n`);
    const next = uniqueRun(P, `${first}-r2`);
    log(`hunt: test gate failed (${gate.problems.join("; ")}); one fix round`);
    await delegate(["continue", P.repo, run, "-f", msg, "--name", next], { LEDGER_MODE: "tests" }, path.join(hdir, `${next}.log`));
    run = next;
    gate = gateOf(run);
  }
  const block = finalBlockOf(P, run, "agent-box-tests") ?? {};
  append("tests", { ok: gate.ok, mode: gate.mode, files: gate.files, problems: gate.problems, hunt: true },
    { project: P.name, run, role: o.role ?? "bughunt", model: summary(P, run)?.model ?? null });
  const out = { run, branch: `agent/${run}`, ok: gate.ok, mode: gate.mode, test_files: gate.files, location: block.location ?? [],
    problems: gate.problems, next: !gate.ok ? "hunt_failed" : gate.mode === "none" ? "not_reproduced" : "implement_fix" };
  if (out.next === "implement_fix") {
    const where = out.location.map((l) => `- \`${l.file}:${l.line}\`: ${l.why}`).join("\n");
    const fix = path.join(hdir, `${first}-task.md`);
    fs.writeFileSync(fix, frontmatter({ ...keep, files: [...new Set([...(keep.files ?? []), ...out.location.map((l) => l.file).filter(Boolean)])],
      sealed: gate.files, test: testFileCmd(P, gate.files) })
      + `Fix this bug. A bug hunt reproduced it and committed the failing test${gate.files.length > 1 ? "s" : ""} on this branch (sealed); make ${gate.files.length > 1 ? "them" : "it"} pass without breaking anything else. Fix the cause, at every place it occurs.\n\n`
      + `## The bug report\n\n${report}\n\n## Where the bug hunt found it\n\nA claim from another model: check it before you rely on it.\n\n${where || "(no location given)"}\n`
      + (block.notes ? `\n${block.notes}\n` : ""));
    out.fix_task = fix;
  }
  return out;
}

// ─── run one ticket ──────────────────────────────────────────────────────────────────────
function roleFor(model) {
  const m = String(model ?? "").toLowerCase();
  if (/opus|sonnet|claude/.test(m)) return "escalate";
  if (/deepseek|hard/.test(m)) return "implement-hard";
  return null;
}
// A setting from projects/<name>.env when the project sets it, else from agent-box.conf.
export const conf = (k, P) => P?.env?.[k] ?? (read(path.join(BOX, "agent-box.conf")) ?? "").match(new RegExp(`^${k}="?([^"\\n#]*)"?`, "m"))?.[1]?.trim();

async function runTicket(P, ticketPath, o = {}) {
  const meta = ticketMeta(ticketPath);
  if (!Number.isFinite(meta.num)) die(`ticket file name must start with its number (NN-slug.md): ${ticketPath}`);
  const fdir = path.dirname(path.dirname(ticketPath)), feature = path.basename(fdir);
  const id = `${feature}-${pad(meta.num)}`, sdir = path.join(P.runs, "_tickets", id);
  const old = readJson(path.join(sdir, "state.json"));
  if (old && !old.landed && !o.force) die(`ticket ${id} already ran (next: ${old.next}); land it, or rerun with --force`);
  const all = withState(P, fdir);
  const open = meta.blocked_by.filter((b) => !all.find((t) => t.num === b)?.done);
  if (open.length) die(`ticket ${meta.num} is blocked by unfinished tickets: ${open.join(", ")}`);

  const integ = `box/${feature}`;
  if (!tryGit(P.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${integ}`)) {
    git(P.repo, "branch", integ, "HEAD");
    log(`created integration branch ${integ} at ${git(P.repo, "rev-parse", "--short", "HEAD")}`);
  }
  const base = git(P.repo, "rev-parse", integ);
  fs.mkdirSync(sdir, { recursive: true });
  const st = { id, feature, ticket: path.resolve(ticketPath), feature_dir: path.resolve(fdir), num: meta.num, title: meta.title,
    integration: integ, base, runs: [], next: "running", started: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(sdir, "state.json"), JSON.stringify(st, null, 2));
  save();
  const lenv = { LEDGER_FEATURE: feature, LEDGER_TICKET: meta.id };
  const ctx = contextFor(P, fdir, meta);

  // 1. Tests first, by the test writer. Its harness test run is the red check: only the test files it
  //    changed run, through the project's single-file test command.
  const redCmd = redCommand(P);
  const testsTask = path.join(sdir, "tests-task.md");
  fs.writeFileSync(testsTask, frontmatter({ scope: P.testGlobs, red: false, test: redCmd }) + read(path.join(PROMPTS, "write-tests.md")) + "\n" + ctx);
  let testsRun = uniqueRun(P, `${id}-tests`);
  log(`${id}: test writer (${o.testsRole ?? "tests"}) on ${integ}`);
  await delegate(["run", P.repo, testsTask, "--role", o.testsRole ?? "tests", "--base", integ, "--name", testsRun, "--mode", "tests", "--no-autofix"], lenv, path.join(sdir, `${testsRun}.log`));
  st.runs.push(testsRun);
  let gate = testGate(P, base, testsRun, summary(P, testsRun), finalBlockOf(P, testsRun, "agent-box-tests"));
  if (!gate.ok && summary(P, testsRun)?.session && !summary(P, testsRun)?.blocked) {
    const msg = path.join(sdir, "tests-fix.md");
    fs.writeFileSync(msg, `The harness checked your tests and they are not acceptable yet. Fix exactly these, change only test files, commit, and end with both blocks again:\n\n${gate.problems.map((p) => `- ${p}`).join("\n")}\n`);
    const next = uniqueRun(P, `${id}-tests-r2`);
    log(`${id}: test gate failed (${gate.problems.join("; ")}); one fix round`);
    await delegate(["continue", P.repo, testsRun, "-f", msg, "--name", next], { ...lenv, LEDGER_MODE: "tests" }, path.join(sdir, `${next}.log`));
    st.runs.push(next); testsRun = next;
    gate = testGate(P, base, testsRun, summary(P, testsRun), finalBlockOf(P, testsRun, "agent-box-tests"));
  }
  const tblock = finalBlockOf(P, testsRun, "agent-box-tests") ?? {};
  append("tests", { ok: gate.ok, mode: gate.mode, files: gate.files, problems: gate.problems },
    { project: P.name, run: testsRun, role: o.testsRole ?? "tests", model: summary(P, testsRun)?.model ?? null });
  Object.assign(st, { tests_run: testsRun, test_mode: gate.mode, test_files: gate.files, test_problems: gate.problems });
  if (!gate.ok) { st.next = "tests_failed"; save(); return st; }

  // 2. Implementation against the locked tests (sealed), on top of the test commit.
  const lockedCmd = gate.files.length ? testFileCmd(P, gate.files) : null;
  const test = [lockedCmd, P.env.TICKET_CHECKS].filter(Boolean).join(" && ") || P.env.TEST_CMD || undefined;
  const lockedInfo = [
    "## Locked tests (written before any code; you cannot change them)", "",
    `Mode: ${gate.mode}`, "", ...gate.files.map((f) => `- \`${f}\``), "",
    "Interface the tests expect:", ...(tblock.interface ?? []).map((x) => `- ${x}`), "",
    "Cases:", ...(tblock.cases ?? []).map((x) => `- ${x}`), "",
    "Seams:", ...(tblock.seams ?? []).map((x) => `- ${x}`), "", tblock.notes ? `Notes from the test writer: ${tblock.notes}` : "",
  ].join("\n");
  const implTask = path.join(sdir, "impl-task.md");
  fs.writeFileSync(implTask, frontmatter({ ...(gate.files.length ? { files: gate.files, sealed: gate.files } : {}), scope: ["**"], red: false, ...(test ? { test } : {}) })
    + read(path.join(PROMPTS, "implement.md")) + "\n" + ctx + "\n" + lockedInfo + "\n");
  const role = o.role ?? roleFor(meta.model) ?? "implement";
  let last = uniqueRun(P, `${id}-impl`);
  log(`${id}: implementer (${role})`);
  await delegate(["run", P.repo, implTask, "--role", role, "--base", `agent/${testsRun}`, "--name", last], lenv, path.join(sdir, `${last}.log`));
  st.runs.push(last);
  let s = summary(P, last);

  // Escalation: a failing implementation goes to the stronger role once, keeping the changes.
  const escRole = o.escalateRole ?? conf("TICKET_ESCALATE_ROLE", P);
  if (s && ["fail", "error", "timeout", "no_change"].includes(s.verdict) && escRole && escRole !== role) {
    const from = last, esc = uniqueRun(P, `${id}-esc`);
    const escTask = path.join(sdir, "esc-task.md");
    const tail = (read(path.join(P.runs, from, "test.log")) ?? "").split("\n").slice(-60).join("\n");
    fs.writeFileSync(escTask, frontmatter({ ...(gate.files.length ? { files: gate.files, sealed: gate.files } : {}), scope: ["**"], red: false, ...(test ? { test } : {}) })
      + read(path.join(PROMPTS, "implement.md")) + "\n" + ctx + "\n" + lockedInfo + "\n"
      + `## Earlier attempt\n\nAnother model worked on this ticket and did not get it through the harness (verdict ${s.verdict}). Its commits are on this branch: read them, keep what is right, fix what is wrong. Its last test output:\n\n${fence(tail)}\n${tail}\n${fence(tail)}\n`);
    append("escalate", { from_model: s.model, to_model: conf(`ROLE_${escRole.replace(/-/g, "_")}`, P)?.split(" ")[0] ?? escRole, at_round: 2 }, { project: P.name, run: esc, role: escRole });
    log(`${id}: implementer verdict ${s.verdict}; escalating to ${escRole}`);
    const escBase = s.commits > 0 ? `agent/${from}` : `agent/${testsRun}`;
    await delegate(["run", P.repo, escTask, "--role", escRole, "--base", escBase, "--name", esc], lenv, path.join(sdir, `${esc}.log`));
    st.runs.push(esc); last = esc; s = summary(P, last);
  }
  st.last_run = last;
  if (!s) { st.next = "fix_environment"; save(); return st; }
  if ((s.report?.test_dispute ?? []).length) { st.next = "resolve_test_dispute"; save(); return st; }
  if (s.verdict !== "pass") { st.next = s.verdict === "blocked" ? "answer_question" : "gate_failed"; save(); return st; }

  // 3. Two-axis review in parallel.
  await reviewRuns(P, st, last, ctx, lenv);
  save();
  return st;
}
function finalBlockOf(P, run, name) {
  const t = read(path.join(P.runs, run, "final.md"));
  const b = t?.match(new RegExp("```" + name + "[^\\n]*\\n([\\s\\S]*?)\\n\\s*```"));
  if (!b) return null;
  try { return JSON.parse(b[1]); } catch { return null; }
}

async function reviewRuns(P, st, run, ctx, lenv) {
  const branch = `agent/${run}`;
  const commits = git(P.repo, "log", "--format=- %h %s", `${st.base}..${branch}`);
  const head = `Review the change on this branch: \`git diff ${st.base.slice(0, 12)}..HEAD\`. The tests in it were written first by a test writer and locked; the code was written by a different model.\n\n${commits}\n`;
  // The spec reviewer is never the implementer's family (lib/family.mjs).
  const specR = specRole(summary(P, run)?.model, conf("ROLE_review_spec", P), conf("ROLE_review_spec_alt", P));
  const axes = [["spec", specR, read(path.join(PROMPTS, "review-spec.md")) + "\n" + head + "\n" + ctx],
                ["std", "review-std", read(path.join(PROMPTS, "review-standards.md")) + "\n" + head + "\n" + ctx]];  // every role gets the spec
  const files = git(P.repo, "diff", "--name-only", `${st.base}..${branch}`).split("\n").filter(Boolean);
  const names = await Promise.all(axes.map(async ([axis, role, body]) => {
    const task = path.join(P.runs, "_tickets", st.id, `review-${axis}.md`);
    fs.writeFileSync(task, frontmatter({ files: files.slice(0, 40) }) + body);
    const name = uniqueRun(P, `${run}-r${axis}`);
    await delegate(["run", P.repo, task, "--role", role, "--review", "--base", branch, "--name", name, "--mode", "review"], { ...lenv, REVIEW_TARGET: branch }, path.join(P.runs, "_tickets", st.id, `${name}.log`));
    return name;
  }));
  st.reviews = names.map((n) => {
    const f = readJson(path.join(P.runs, n, "findings.json"));
    return { run: n, findings: Array.isArray(f) ? f.length : null, confirmed: Array.isArray(f) ? f.filter((x) => String(x.confidence).toUpperCase() === "CONFIRMED").length : null };
  });
  const s = summary(P, run);
  const flagged = (s?.flags ?? []).some((f) => ["SEALED-EDIT", "STAND-IN", "SENSITIVE", "MISREPORT"].includes(f.flag));
  st.last_run = run;
  st.next = st.reviews.some((r) => r.findings === null) ? "review_missing"
    : st.reviews.some((r) => r.findings > 0) ? "verify_findings" : flagged ? "inspect_flags" : "approve";
}

// ─── land ────────────────────────────────────────────────────────────────────────────────
function stateForRun(P, run) {
  const dir = path.join(P.runs, "_tickets");
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((id) => run.startsWith(`${id}-`)).sort((a, b) => b.length - a.length) : [];
  if (!ids.length) die(`no ticket state for run ${run} (ticket runs are named <feature>-NN-...)`);
  const f = path.join(dir, ids[0], "state.json");
  return { st: readJson(f), save: (st) => fs.writeFileSync(f, JSON.stringify(st, null, 2)) };
}

async function land(P, run, o = {}) {
  const { st, save } = stateForRun(P, run);
  if (st.landed) die(`${st.id} already landed as ${st.landed}`);
  const s = summary(P, run) ?? die(`no summary for ${run}`);
  if (s.verdict !== "pass" && !o.force) die(`${run} has verdict ${s.verdict}; land only a passing run (--force overrides)`);
  const branch = `agent/${run}`, integ = st.integration;
  if (!tryGit(P.repo, "rev-parse", "--verify", "--quiet", `${branch}^{commit}`)) die(`branch ${branch} is gone`);
  if (git(P.repo, "worktree", "list", "--porcelain").split("\n").includes(`branch refs/heads/${integ}`))
    die(`${integ} is checked out somewhere; switch that checkout away before landing`);
  const cur = git(P.repo, "rev-parse", integ);
  const testsModel = summary(P, st.tests_run)?.model ?? "?";
  const msg = [`${st.feature} ${pad(st.num)}: ${st.title}`, "",
    ...(s.report?.decisions?.length ? ["Decisions:", ...s.report.decisions.map((d) => `- ${d}`), ""] : []),
    `Ticket: ${path.relative(P.repo, st.ticket).replace(/\\/g, "/")}`,
    `Tests written first by ${testsModel} (${st.test_mode}); implemented by ${s.model} (agent-box ${run}).`,
    ...(P.env.LAND_TRAILERS ? ["", ...P.env.LAND_TRAILERS.split("\\n")] : [])].join("\n");
  const msgFile = path.join(P.runs, "_tickets", st.id, "land-message.txt");
  fs.writeFileSync(msgFile, msg + "\n");
  let commit;
  if (cur === st.base) {
    commit = git(P.repo, "commit-tree", `${branch}^{tree}`, "-p", cur, "-F", msgFile);
  } else {
    // The integration branch moved (another ticket landed). Merge without a checkout, then prove the
    // merged tree still passes the locked tests in a container before moving the branch.
    let tree;
    try { tree = git(P.repo, "merge-tree", "--write-tree", `--merge-base=${st.base}`, cur, branch).split("\n")[0]; }
    catch { die(`${integ} moved since ${st.id} started and the change does not merge cleanly; rerun the ticket (--force)`); }
    commit = git(P.repo, "commit-tree", tree, "-p", cur, "-F", msgFile);
    const tmp = `refs/heads/agent-box-tmp/land-${st.id}`;
    git(P.repo, "update-ref", tmp, commit);
    const test = [st.test_files?.length ? testFileCmd(P, st.test_files) : null, P.env.TICKET_CHECKS].filter(Boolean).join(" && ") || P.env.TEST_CMD;
    const name = uniqueRun(P, `${st.id}-landcheck`);
    log(`${integ} moved; checking the merged tree (${test})`);
    await delegate(["check", P.repo, tmp, "--name", name, ...(test ? ["--test", test] : [])], {}, path.join(P.runs, "_tickets", st.id, `${name}.log`));
    git(P.repo, "update-ref", "-d", tmp);
    const c = summary(P, name);
    if (c?.test_exit !== 0) die(`the merged tree fails its tests (see runs/${P.name}/${name}); rerun the ticket on the new ${integ} (--force)`);
  }
  git(P.repo, "update-ref", `refs/heads/${integ}`, commit, cur);
  log(`${st.id} landed on ${integ} as ${commit.slice(0, 10)}. Not pushed, not merged into your branches.`);

  // Stamp the ticket done and move it to the done dir (AgentOrchestratingSkill finish.sh).
  if (fs.existsSync(st.ticket)) {
    const dd = doneDir(P, st.feature_dir);
    fs.mkdirSync(dd, { recursive: true });
    const status = `**Status:** done — ${new Date().toISOString().slice(0, 10)}. Commit ${commit.slice(0, 7)} on ${integ} (agent-box).`;
    let t = read(st.ticket);
    t = /^\*\*Status:\*\*.*$/m.test(t) ? t.replace(/^\*\*Status:\*\*.*$/m, status) : t.replace(/^(.*\n)/, `$1\n${status}\n`);
    fs.writeFileSync(path.join(dd, path.basename(st.ticket)), t);
    fs.rmSync(st.ticket);
  }
  // The decisions ledger later tickets read.
  const added = git(P.repo, "diff", "--name-status", st.base, commit).split("\n").filter((l) => l.startsWith("A\t")).map((l) => l.slice(2));
  const names = git(P.repo, "diff", "-U0", st.base, commit, "--", ".", ":!*.md").split("\n")
    .filter((l) => /^\+\s*(export |pub (fn|struct|enum|trait|mod) |def [a-zA-Z]|class [A-Z]|func [A-Z]|public )/.test(l))
    .map((l) => "`" + l.replace(/^\+\s*/, "").replace(/\s*[{:=][^`]*$/, "") + "`").slice(0, 40);
  fs.mkdirSync(featureHome(P, st.feature), { recursive: true });
  fs.appendFileSync(decisionsFile(P, st.feature), [`## ${pad(st.num)}: ${st.title}`, "", `Commit ${commit.slice(0, 7)}.`, "",
    "New files:", ...(added.length ? added.map((f) => `- ${f}`) : ["- none"]), "",
    "Public names added:", ...(names.length ? names.map((n) => `- ${n}`) : ["- none"]), "",
    "Implementer decisions:", ...((s.report?.decisions ?? []).length ? s.report.decisions.map((d) => `- ${d}`) : ["- none"]), "", ""].join("\n"));

  append("land", { feature: st.feature, ticket: path.basename(st.ticket, ".md"), commit: commit.slice(0, 10), branch: integ },
    { project: P.name, run, role: null, model: s.model });
  append("outcome", { target_run: run, result: "merged", cause: null, why: `Landed on ${integ}.` }, { project: P.name, run, model: s.model });
  for (const r of st.runs ?? []) tryGit(P.repo, "branch", "-D", `agent/${r}`);
  for (const r of readAll().filter((e) => e.type === "run" && e.project === P.name && e.run?.startsWith(`${st.id}-`)).map((e) => e.run)) tryGit(P.repo, "branch", "-D", `agent/${r}`);
  Object.assign(st, { landed: commit, next: "landed" });
  save(st);
  return commit;
}

// ─── feature: status, next, report, run, defect ──────────────────────────────────────────
function status(P, fdir) {
  const rows = withState(P, fdir);
  console.log("  #  state                  model          blocked by   title");
  for (const t of rows) console.log(`  ${pad(t.num)}  ${t.state.padEnd(22)} ${(t.model ?? "default").slice(0, 14).padEnd(14)} ${(t.waiting_on.join(",") || "-").padEnd(12)} ${t.title}`);
}
function report(P, fdir) {
  const feature = path.basename(fdir), integ = `box/${feature}`, rows = withState(P, fdir);
  const out = [`# ${feature}: run report`, ""];
  if (tryGit(P.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${integ}`)) {
    out.push(`Integration branch \`${integ}\` at \`${git(P.repo, "rev-parse", "--short", integ)}\`, not pushed, not merged.`, "", "## Commits", "");
    const log = tryGit(P.repo, "log", "--reverse", "--format=- `%h` %s", `HEAD..${integ}`);
    out.push(log || "- none yet");
  } else out.push("No integration branch yet: no ticket has landed.");
  out.push("", "## Manual test checklist", "", `From the acceptance criteria of every landed ticket. Try each by hand on \`${integ}\`.`);
  for (const t of rows.filter((t) => t.done)) out.push("", `### ${t.num}: ${t.title}`, "", ...t.criteria.map((c) => `- [ ] ${c}`));
  out.push("", "## Not done", "");
  const open = rows.filter((t) => !t.done);
  out.push(...(open.length ? open.map((t) => `- ${t.num}: ${t.title} — ${t.state}${t.waiting_on.length ? ` (waiting on ${t.waiting_on.join(", ")})` : ""}`) : ["- nothing: every ticket landed"]));
  const ev = readAll().filter((e) => e.project === P.name && (e.type === "run" || e.type === "land" || e.type === "escalate" || e.type === "review") && (e.feature === feature || e.run?.startsWith(`${feature}-`)));
  const runs = ev.filter((e) => e.type === "run");
  out.push("", "## Numbers", "",
    `- tickets landed: ${ev.filter((e) => e.type === "land").length}`,
    `- implementer runs: ${runs.filter((e) => e.mode === "implement").length}, passed first try: ${runs.filter((e) => e.mode === "implement" && e.exits?.first_test === 0).length}`,
    `- escalations: ${ev.filter((e) => e.type === "escalate").length}`,
    `- review findings: ${ev.filter((e) => e.type === "review").reduce((n, e) => n + (e.findings?.length ?? 0), 0)}`,
    `- agent time: ${Math.round(runs.reduce((n, e) => n + (e.seconds?.total ?? 0), 0) / 60)} min, tokens in ${runs.reduce((n, e) => n + (e.tokens?.input ?? 0) + (e.tokens?.cache_read ?? 0), 0)}`,
    "", "## Your turn", "", "Check out the branch somewhere separate and test:", "", "```bash", `git worktree add ../${feature}-manual-test ${integ}`, "```", "",
    "Each bug becomes a ticket that goes through the same loop, reproduction test first:", "", "```bash",
    `delegate.sh defect <repo> ${path.relative(P.repo, fdir).replace(/\\/g, "/")} "<title>" "<what you did, what happened, what you expected>"`, "```");
  const file = path.join(featureHome(P, feature), "report.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join("\n") + "\n");
  console.log(out.join("\n"));
  log(`report: ${file}`);
}
function defect(P, fdir, title, text) {
  const last = Math.max(0, ...featureTickets(P, fdir).map((t) => t.num));
  const num = pad(last + 1), slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const file = path.join(fdir, "issues", `${num}-${slug}.md`);
  fs.writeFileSync(file, `# ${num}: ${title}\n\n**What to build:** Fix this bug found in manual testing. A test that reproduces it comes first and must\nfail before the fix.\n\n${text}\n\n**Blocked by:** None (can start immediately).\n\n**Status:** ready-for-agent\n**Type:** defect\n\n- [ ] A test reproduces the reported behaviour and fails before the fix\n- [ ] The reported behaviour no longer happens\n- [ ] The full test suite passes\n`);
  console.log(file);
}
async function runFeature(P, fdir, o) {
  const par = Number(o.parallel ?? 1);
  for (;;) {
    const ready = withState(P, fdir).filter((t) => t.state === "ready").slice(0, par);
    if (!ready.length) break;
    const results = await Promise.all(ready.map((t) => runTicket(P, t.path, { ...o, force: true })));
    let landed = 0;
    for (const st of results) {
      console.log(`${st.id}: ${st.next}${st.last_run ? ` (${st.last_run})` : ""}`);
      if (st.next === "approve" && o["auto-land"]) { await land(P, st.last_run); landed++; }
    }
    if (!landed) break;
  }
  status(P, fdir);
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const k = argv[i].slice(2), v = argv[i + 1]; if (v === undefined || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; } }
    else o._.push(argv[i]);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, repoArg, target, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (!repoArg) die("usage: see the header of lib/ticket.mjs");
  const P = project(repoArg);
  const abs = (p) => path.resolve(p);
  const out = (st) => console.log(JSON.stringify({ id: st.id, next: st.next, tests: { run: st.tests_run, mode: st.test_mode, files: st.test_files, problems: st.test_problems },
    runs: st.runs, last_run: st.last_run ?? null, reviews: st.reviews ?? null }, null, 2));
  if (cmd === "run") out(await runTicket(P, abs(target), { role: o.role, testsRole: o["tests-role"], force: !!o.force }));
  else if (cmd === "review") {
    const { st, save } = stateForRun(P, target);
    const meta = ticketMeta(fs.existsSync(st.ticket) ? st.ticket : die("the ticket file has moved"));
    await reviewRuns(P, st, target, contextFor(P, st.feature_dir, meta), { LEDGER_FEATURE: st.feature, LEDGER_TICKET: meta.id }, path.join(P.runs, "_tickets", st.id, "harness.log"));
    save(st); out(st);
  } else if (cmd === "land") console.log(await land(P, target, { force: !!o.force }));
  else if (cmd === "status") status(P, abs(target));
  else if (cmd === "next") { const r = withState(P, abs(target)).filter((t) => t.state === "ready"); for (const t of o.all ? r : r.slice(0, 1)) console.log(t.path); }
  else if (cmd === "report") report(P, abs(target));
  else if (cmd === "run-feature") await runFeature(P, abs(target), o);
  else if (cmd === "hunt") console.log(JSON.stringify(await hunt(P, abs(target), { base: o.base, name: o.name, role: o.role }), null, 2));
  else if (cmd === "defect") defect(P, abs(target), rest[0] ?? die("title required"), rest[1] ?? die("report required"));
  else die(`unknown command ${cmd}`);
}

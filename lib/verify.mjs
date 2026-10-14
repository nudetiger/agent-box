// One check container per review round (lib/loop.mjs): rerun every review finding's reproduction on the
// branch, and the existing tests next to what the change touched. A reviewer's CONFIRMED is its own
// word; a reproduction the harness reruns is evidence. The tests next to the change catch a fix that
// breaks something its own test command never runs (Lykos T194: a fix broke a trusted child session).
//
// verifyFiles() writes .agent-box-verify/ for `delegate.sh check --hidden`; parseVerify() reads the
// check's test.log back.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { globToRegex } from "./glob.mjs";

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const git = (repo, ...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }); } catch { return ""; } };
export const stem = (f) => path.posix.basename(f).replace(/\.(test|spec)(?=\.)/, "").replace(/(Test)?\.[^.]+$/, "").replace(/_test$/, "").replace(/^test_/, "");

// Failing test names, one capture group per runner (the first group that matched is the name):
// node:test "✖ name (12ms)", TAP "not ok 3 - name", Go "--- FAIL: TestX", cargo "test a::b ... FAILED",
// GoogleTest "[  FAILED  ] Suite.Test", pytest "FAILED path::test", Gradle/JUnit "FooTest > bar() FAILED".
// A project whose runner prints something else sets FAIL_REGEX in projects/<repo>.env.
export const FAIL_REGEX = String.raw`^\s*(?:✖ |not ok \d+ - )(.+?)(?: \([\d.]+m?s\))?(?: # .*)?$|^\s*--- FAIL: (\S+)|^test (\S+) \.\.\. FAILED$|^\[  FAILED  \] ([A-Za-z_][\w/]*\.[\w/]+)|^FAILED (\S+)|^(\S+ > .+?) FAILED$`;
const NAMES_JS = String.raw`const fs=require("fs");const[f,t,r]=process.argv.slice(1);let s;try{s=fs.readFileSync(f,"utf8").replace(/\r/g,"")}catch{process.exit(0)}const n=new Set();for(const m of s.matchAll(new RegExp(r,"gm"))){const x=m.slice(1).find((g)=>g!==undefined)?.trim();if(x)n.add(x)}for(const x of[...n].sort())console.log(t+" "+x)`;
// The same extraction, in this process (the check container runs NAMES_JS).
export function failNames(text, regex = FAIL_REGEX) {
  const n = new Set();
  for (const m of String(text).replace(/\r/g, "").matchAll(new RegExp(regex, "gm"))) {
    const x = m.slice(1).find((g) => g !== undefined)?.trim();
    if (x) n.add(x);
  }
  return [...n].sort();
}

// The changed files whose neighbour tests rerun. NEIGHBOUR_SOURCES in projects/<repo>.env overrides it.
export const NEIGHBOUR_SOURCES = String.raw`\.([cm]?[jt]sx?|java|kt|py|go|rs|c|cc|cpp|cxx|h|hh|hpp)$`;

// A reproduction the harness can rerun: one file under /tmp and a command. Anything else is not one.
export function validRepro(r) {
  return !!r && typeof r === "object" && typeof r.cmd === "string" && r.cmd.trim() !== ""
    && typeof r.content === "string" && typeof r.file === "string"
    && /^\/tmp\/[\w.@+-]+(\/[\w.@+-]+)*$/.test(r.file) && !r.file.split("/").includes("..");
}

// Existing test files (present at the base) next to the changed source files: the same stem, then any
// test that imports a changed module. Closest first, at most `max`.
export function neighbourTests(repo, base, head, testGlobs, max = 30, sourceRegex = NEIGHBOUR_SOURCES) {
  const isTest = (f) => testGlobs.some((g) => globToRegex(g).test(f) || globToRegex(g).test(path.posix.basename(f)));
  const isSource = new RegExp(sourceRegex);
  const changed = git(repo, "diff", "--name-only", "--diff-filter=AMR", `${base}..${head}`).split("\n").filter(Boolean);
  const sources = changed.filter((f) => !isTest(f) && isSource.test(f));
  if (!sources.length) return [];
  const tests = git(repo, "ls-tree", "-r", "--name-only", base).split("\n").filter((f) => f && isTest(f));
  const picked = new Map();
  for (const s of sources) {
    for (const t of tests) if (stem(t) === stem(s) && path.posix.dirname(t) === path.posix.dirname(s)) picked.set(t, 0);
  }
  for (const s of sources) {
    // An import or #include of the changed file: "…/foo", "…/foo.js", "…/foo.h".
    const pat = `["'][^"']*/${stem(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[A-Za-z0-9_]+)?["']`;
    const hits = git(repo, "grep", "-l", "-E", pat, base, "--", ...testGlobs.map((g) => `:(glob)${g}`)).split("\n").filter(Boolean)
      .map((l) => l.replace(new RegExp(`^${base}:`), "")).filter((t) => tests.includes(t));
    for (const t of hits) if (!picked.has(t)) picked.set(t, path.posix.dirname(t) === path.posix.dirname(s) ? 1 : 2 + t.split("/").length);
  }
  return [...picked.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}

// The files for `check --hidden DIR`: run.sh plus one .src per reproduction. The neighbour command runs
// on the branch; if it fails, again on the base (unless the loop already knows the base's result for
// these files), so a failure that was already there is no regression. Failing test names are printed
// for both sides: a base that already fails (Lykos has known Linux failures) hides nothing, because
// the loop compares names, not exit codes. Reproductions in `baseRepros` (findings that claim a
// regression) also run on the base: one must fail on the branch and pass on the base.
export function verifyFiles({ repros, baseRepros = [], neighboursCmd, base, baseKnown = false, root = "/work/repo", baseDir = "/tmp/agent-box-base", failRegex = FAIL_REGEX }) {
  const files = {};
  const names = (log, tag) => `node -e ${q(NAMES_JS)} ${log} ${tag} ${q(failRegex)}`;
  const lines = ["#!/usr/bin/env bash", "# Written by agent-box (lib/verify.mjs) for one review round.", `cd ${q(root)} || exit 1`,
    `v=${q(`${root}/.agent-box-verify`)}`,
    "mkbase() {",
    `  [ -d ${q(baseDir)} ] && return 0`,
    `  git worktree add -q --detach ${q(baseDir)} ${q(base)} >/dev/null 2>&1`,
    `  [ -e node_modules ] && ln -s "$PWD/node_modules" ${q(`${baseDir}/node_modules`)} 2>/dev/null`,
    "  return 0",
    "}",
    "repro() {",
    "  mkdir -p \"$(dirname \"$2\")\" && cp \"$v/$1.src\" \"$2\"",
    "  timeout 300 bash -lc \"$3\" >\"$v/$1.log\" 2>&1",
    "  local e=$?",
    "  echo \"AGENT-BOX-REPRO $1 exit $e\"",
    "  tail -n 15 \"$v/$1.log\" | sed 's/^/    /'",
    "  if [ \"${4:-}\" = base ]; then",
    "    mkbase; cp \"$v/$1.src\" \"$2\"",
    `    (cd ${q(baseDir)} && timeout 300 bash -lc "$3" >"$v/$1.base.log" 2>&1); echo "AGENT-BOX-REPRO-BASE $1 exit $?"`,
    "  fi",
    "}"];
  const onBase = new Set(baseRepros);
  for (const r of repros) {
    files[`.agent-box-verify/${r.id}.src`] = r.content;
    lines.push(`repro ${q(r.id)} ${q(r.file)} ${q(r.cmd)}${onBase.has(r.id) ? " base" : ""}`);
  }
  if (neighboursCmd) {
    lines.push(`timeout 900 bash -lc ${q(neighboursCmd)} >"$v/n.log" 2>&1; e=$?`,
      "echo \"AGENT-BOX-NEIGHBOURS exit $e\"",
      "tail -n 60 \"$v/n.log\" | sed 's/^/    /'",
      names('"$v/n.log"', "AGENT-BOX-NFAIL"));
    if (!baseKnown) {
      lines.push("if [ \"$e\" != 0 ]; then",
        "  mkbase",
        `  (cd ${q(baseDir)} && timeout 900 bash -lc ${q(neighboursCmd)} >"$v/nb.log" 2>&1); echo "AGENT-BOX-NEIGHBOURS-BASE exit $?"`,
        `  ${names('"$v/nb.log"', "AGENT-BOX-NFAIL-BASE")}`,
        "fi");
    }
  }
  lines.push("exit 0", "");
  files[".agent-box-verify/run.sh"] = lines.join("\n");
  return files;
}

// {repro: {id: exit}, reproBase: {id: exit}, neighbours: null | {exit, base_exit, tail, fails, base_fails,
// new_fails, regression}}. `known`: the base's result from an earlier round ({exit, fails}), used when
// this check did not run the base. A regression: a test failing on the branch that does not fail on the
// base; with no names on either side, the exit codes decide.
export function parseVerify(log, known = null) {
  const repro = {}, reproBase = {};
  for (const m of log.matchAll(/^AGENT-BOX-REPRO (\S+) exit (-?\d+)$/gm)) repro[m[1]] = Number(m[2]);
  for (const m of log.matchAll(/^AGENT-BOX-REPRO-BASE (\S+) exit (-?\d+)$/gm)) reproBase[m[1]] = Number(m[2]);
  const n = log.match(/^AGENT-BOX-NEIGHBOURS exit (-?\d+)$/m);
  if (!n) return { repro, reproBase, neighbours: null };
  const b = log.match(/^AGENT-BOX-NEIGHBOURS-BASE exit (-?\d+)$/m);
  const after = log.slice(n.index + n[0].length).split(/^AGENT-BOX-NEIGHBOURS-BASE/m)[0];
  const tail = after.split("\n").filter((l) => l.startsWith("    ")).map((l) => l.slice(4)).join("\n");
  const grab = (tag) => [...new Set([...log.matchAll(new RegExp(`^${tag} (.+)$`, "gm"))].map((m) => m[1].trim()))].filter((x) => x && x !== "failing tests:");
  const exit = Number(n[1]);
  const base_exit = b ? Number(b[1]) : known?.exit ?? null;
  const fails = grab("AGENT-BOX-NFAIL");
  const base_fails = b ? grab("AGENT-BOX-NFAIL-BASE") : known?.fails ?? null;
  const new_fails = base_fails ? fails.filter((x) => !base_fails.includes(x)) : [];
  const byName = exit !== 0 && base_exit !== null && base_exit !== 0 && fails.length > 0 && base_fails !== null;
  const regression = exit !== 0 && (base_exit === 0 || (byName && new_fails.length > 0));
  return { repro, reproBase, neighbours: { exit, base_exit, tail, fails, base_fails, new_fails, regression } };
}

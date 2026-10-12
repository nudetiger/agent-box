#!/usr/bin/env node
// node bench/materialize.mjs <fixture>
//
// Builds bench/.repos/<fixture>: a git repo whose single commit on `main` holds the fixture, with a fixed
// author, committer, date and message, so the base sha is the same on every machine and every run.
// Prints the repo path. Reuses the repo when `main` already is that commit and the checkout is clean;
// otherwise points `main` at it and resets the checkout (other branches, such as fetched results, stay).
//
// A fixture directory may hold `.fixture.json` {"extends": "<parent fixture>"}: the parent's files, then
// its own on top. That is how a task gets a base with a sealed failing test already committed.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BENCH = path.dirname(fileURLToPath(import.meta.url));

const IDENTITY = {
  GIT_AUTHOR_NAME: "bench",
  GIT_AUTHOR_EMAIL: "bench@agent-box.invalid",
  GIT_AUTHOR_DATE: "1767225600 +0000", // 2026-01-01T00:00:00Z
  GIT_COMMITTER_NAME: "bench",
  GIT_COMMITTER_EMAIL: "bench@agent-box.invalid",
  GIT_COMMITTER_DATE: "1767225600 +0000",
};

// Settings that would otherwise make the sha depend on the machine's git config.
const FIXED = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "commit.gpgsign=false", "-c", "i18n.commitEncoding=UTF-8"];

export function git(cwd, args, { input, env } = {}) {
  return execFileSync("git", [...FIXED, ...args], {
    cwd,
    input,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function walk(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

/** The fixture's files as {path: text}, parent first; text is LF-normalized so the checkout's line endings never matter. */
export function fixtureFiles(name) {
  const dir = path.join(BENCH, "fixtures", name);
  if (!fs.existsSync(dir)) {
    const known = fs.readdirSync(path.join(BENCH, "fixtures")).join(", ");
    throw new Error(`no fixture "${name}" (have: ${known})`);
  }
  const metaPath = path.join(dir, ".fixture.json");
  const files = fs.existsSync(metaPath) ? fixtureFiles(JSON.parse(fs.readFileSync(metaPath, "utf8")).extends) : new Map();
  for (const f of walk(dir)) {
    if (f === ".fixture.json") continue;
    files.set(f, fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"));
  }
  return files;
}

export function materialize(name) {
  const files = fixtureFiles(name);
  const repo = path.join(BENCH, ".repos", name);
  if (!fs.existsSync(path.join(repo, ".git"))) {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-q", "--object-format=sha1", "-b", "main"]);
    git(repo, ["config", "core.autocrlf", "false"]);
  }

  // Build the expected commit through a scratch index, leaving the checkout alone until we know it differs.
  const index = path.join(repo, ".git", "bench-index");
  fs.rmSync(index, { force: true });
  const entries = [...files.keys()]
    .sort()
    .map((f) => `100644 ${git(repo, ["hash-object", "-w", "--no-filters", "--stdin"], { input: files.get(f) })}\t${f}`);
  git(repo, ["update-index", "--add", "--index-info"], { input: entries.join("\n") + "\n", env: { GIT_INDEX_FILE: index } });
  const tree = git(repo, ["write-tree"], { env: { GIT_INDEX_FILE: index } });
  fs.rmSync(index, { force: true });
  const commit = git(repo, ["commit-tree", tree, "-m", `fixture ${name}`], { env: IDENTITY });

  let current = "";
  try {
    current = git(repo, ["rev-parse", "-q", "--verify", "refs/heads/main"]);
  } catch {}
  let onMain = false;
  try {
    onMain = git(repo, ["symbolic-ref", "-q", "HEAD"]) === "refs/heads/main";
  } catch {}
  if (current === commit && onMain && git(repo, ["status", "--porcelain", "--untracked-files=all"]) === "") return { repo, commit };

  git(repo, ["update-ref", "refs/heads/main", commit]);
  git(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(repo, ["reset", "-q", "--hard", "main"]);
  git(repo, ["clean", "-qfdx"]);
  return { repo, commit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: node bench/materialize.mjs <fixture>");
    process.exit(2);
  }
  try {
    console.log(materialize(name).repo.replace(/\\/g, "/"));
  } catch (err) {
    console.error(`materialize: ${err.message}`);
    process.exit(1);
  }
}

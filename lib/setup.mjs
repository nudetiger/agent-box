// `delegate.sh setup <repo>`: first-time files for a project, from the stacks its manifests show
// (package.json, go.mod, Cargo.toml, CMakeLists.txt, Gradle, Maven, Python), at the root or one or two
// folders down. Writes only files that do not exist yet:
//   projects/<name>.env           setup and test commands, caches, syntax checks; the key left empty
//   projects/<name>.Dockerfile    the toolchains the base image lacks (none for a Node-only project)
//   projects/<name>.context.yaml  test globs, the single-file test command, docs every worker reads
// Everything it writes is a starting point to read and correct.
//
//   node lib/setup.mjs <repo> [--dry-run]
//   node lib/setup.mjs --example > projects/example.Dockerfile    (every block, commented out)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// One block per toolchain. Official images supply the toolchains (COPY --from), so no version is
// guessed here; the tags float with upstream. Each cache folder exists and belongs to node, or the
// named volume would mount root-owned. PATH goes in /etc/profile.d too: every command runs in a
// login shell (bash -lc), and Debian's /etc/profile resets PATH.
export const DOCKER = {
  go: `# Go (official image). CACHES: go, gobuild.
COPY --from=golang:1-bookworm /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH
RUN echo 'export PATH=/usr/local/go/bin:/home/node/go/bin:$PATH' > /etc/profile.d/go.sh \\
 && mkdir -p /home/node/go /home/node/.cache/go-build && chown -R node:node /home/node/go /home/node/.cache`,
  rust: `# Rust (official image): the toolchain read-only, the cargo home writable. CACHES: cargo.
COPY --from=rust:1-bookworm /usr/local/rustup /usr/local/rustup
COPY --from=rust:1-bookworm /usr/local/cargo/bin /usr/local/cargo/bin
# target/ outside the repo, so a build never shows up as the worker's change.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/home/node/.cargo CARGO_TARGET_DIR=/tmp/cargo-target PATH=/usr/local/cargo/bin:$PATH
RUN echo 'export PATH=/usr/local/cargo/bin:$PATH' > /etc/profile.d/rust.sh && rustup component add rustfmt \\
 && mkdir -p /home/node/.cargo/registry && chown -R node:node /home/node/.cargo`,
  cmake: `# C/C++ with CMake (g++ and make are in the base).
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build && rm -rf /var/lib/apt/lists/*`,
  jdk: `# A JDK to launch Gradle or Maven; a build's toolchain JDK downloads into the cache. CACHES: gradle or m2.
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /home/node/.gradle /home/node/.m2 && chown -R node:node /home/node/.gradle /home/node/.m2`,
  maven: `# Maven, with the JDK block above.
RUN apt-get update && apt-get install -y --no-install-recommends maven && rm -rf /var/lib/apt/lists/*`,
  python: `# Python: a venv per run under /tmp. CACHES: pip.
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv python3-pip && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /home/node/.cache/pip && chown -R node:node /home/node/.cache`,
};

const tracked = (repo) => execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const inDir = (dir, cmd) => (dir === "." ? cmd : `(cd ${dir} && ${cmd})`);
// {files} and {dirs} name paths from the repo root, so a stack in a subfolder runs its whole test.
const narrow = (dir, cmd, whole) => (dir === "." ? cmd : inDir(dir, whole));

// The stacks in a repo: [{stack, dir, ...}], shallowest first. Vendored and generated trees are skipped.
export function detect(repo, files = tracked(repo)) {
  const skip = /(^|\/)(node_modules|vendor|third_party|external|build|dist|target|\.git)\//;
  const shallow = files.filter((f) => !skip.test(f) && f.split("/").length <= 3);
  const has = (re) => shallow.filter((f) => re.test(f)).map((f) => path.posix.dirname(f));
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const out = [];
  for (const dir of uniq(has(/(^|\/)package\.json$/))) {
    const pkg = readJson(path.join(repo, dir, "package.json")) ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const at = (f) => files.includes(dir === "." ? f : `${dir}/${f}`);
    const pm = String(pkg.packageManager ?? "");
    const tool = pm.startsWith("pnpm") || at("pnpm-lock.yaml") ? "pnpm" : pm.startsWith("yarn") || at("yarn.lock") ? "yarn" : "npm";
    const runner = deps.vitest ? "npx --no-install vitest run {files}" : deps.jest ? "npx --no-install jest {files}"
      : deps.mocha ? "npx --no-install mocha {files}" : deps.tsx ? "npx --no-install tsx --test {files}" : "node --test {files}";
    out.push({ stack: "node", dir, tool, pm, lock: at("package-lock.json"), hasTest: !!pkg.scripts?.test, runner });
  }
  for (const dir of uniq(has(/(^|\/)go\.mod$/))) out.push({ stack: "go", dir });
  for (const dir of uniq(has(/(^|\/)Cargo\.toml$/))) if (!out.some((s) => s.stack === "rust" && dir.startsWith(`${s.dir}/`))) out.push({ stack: "rust", dir });
  for (const dir of uniq(has(/(^|\/)CMakeLists\.txt$/))) if (!out.some((s) => s.stack === "cmake" && (s.dir === "." || dir.startsWith(`${s.dir}/`)))) out.push({ stack: "cmake", dir });
  for (const dir of uniq(has(/(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/))) if (!out.some((s) => s.stack === "gradle")) out.push({ stack: "gradle", dir, wrapper: files.includes(dir === "." ? "gradlew" : `${dir}/gradlew`) });
  for (const dir of uniq(has(/(^|\/)pom\.xml$/))) if (!out.some((s) => s.stack === "maven" || s.stack === "gradle")) out.push({ stack: "maven", dir });
  for (const dir of uniq(has(/(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/))) if (!out.some((s) => s.stack === "python")) {
    const at = (f) => files.includes(dir === "." ? f : `${dir}/${f}`);
    out.push({ stack: "python", dir, req: at("requirements.txt"), dev: ["requirements-dev.txt", "requirements_dev.txt", "dev-requirements.txt"].find(at) ?? null, project: at("pyproject.toml") || at("setup.py") });
  }
  return out;
}

// Commands and settings per stack, in the stack's folder.
function plan(s) {
  const d = s.dir;
  switch (s.stack) {
    case "node": {
      const via = s.pm ? `npx --yes ${s.pm.split("+")[0]}` : s.tool === "npm" ? "npm" : `npx --yes ${s.tool}`;
      const install = s.tool === "npm" ? (s.lock ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund")
        : s.tool === "pnpm" ? `${via} install --frozen-lockfile` : /yarn@[2-9]/.test(s.pm) ? `${via} install --immutable` : `${via} install --frozen-lockfile`;
      // At the root with package-lock.json the container already runs npm ci by itself.
      return { setup: d === "." && s.tool === "npm" && s.lock ? null : inDir(d, install), test: s.hasTest ? inDir(d, s.tool === "npm" ? "npm test" : `${via} test`) : null,
        file: narrow(d, s.runner, s.tool === "npm" ? "npm test" : `${via} test`), globs: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"] };
    }
    case "go": return { docker: ["go"], setup: inDir(d, "go mod download"), test: inDir(d, "go test ./..."), file: narrow(d, "go test {dirs}", "go test ./..."),
      caches: ["go:/home/node/go", "gobuild:/home/node/.cache/go-build"], syntax: { go: "gofmt -e {file} >/dev/null" }, globs: ["**/*_test.go"] };
    case "rust": return { docker: ["rust"], setup: inDir(d, "cargo fetch"), test: inDir(d, "cargo test"), file: inDir(d, "cargo test"),
      caches: ["cargo:/home/node/.cargo/registry"], syntax: { rs: "rustfmt --edition 2021 --emit stdout {file} >/dev/null" }, globs: ["**/tests/**/*.rs", "**/*_test.rs"] };
    case "cmake": {
      // The build folder outside the repo, one per source folder (the branch and a base worktree differ).
      const b = '"/tmp/cmake${PWD//\\//_}"', test = `cmake --build ${b} && ctest --test-dir ${b} --output-on-failure`;
      return { docker: ["cmake"], setup: inDir(d, `cmake -S . -B ${b} -G Ninja && cmake --build ${b}`), test: inDir(d, test), file: inDir(d, test), globs: ["**/*_test.cc", "**/*_test.cpp", "**/test_*.cc", "**/test_*.cpp", "**/tests/**", "**/test/**"] };
    }
    case "gradle": {
      const g = s.wrapper ? "bash ./gradlew --console=plain" : "gradle --console=plain";
      return { docker: ["jdk"], setup: inDir(d, `${g} testClasses`), test: inDir(d, `${g} test`), file: inDir(d, `${g} test {tests}`), caches: ["gradle:/home/node/.gradle"], globs: ["src/test/**", "**/src/test/**"] };
    }
    case "maven": return { docker: ["jdk", "maven"], setup: inDir(d, "mvn -q -B -DskipTests test-compile"), test: inDir(d, "mvn -q -B test"), file: inDir(d, "mvn -q -B test"),
      caches: ["m2:/home/node/.m2"], globs: ["src/test/**", "**/src/test/**"] };
    case "python": {
      const pip = "/tmp/venv/bin/pip install -q";
      const inst = [s.req ? `${pip} -r requirements.txt` : null, s.dev ? `${pip} -r ${s.dev}` : null, !s.req && s.project ? `${pip} -e .` : null, `${pip} pytest`].filter(Boolean).join(" && ");
      return { docker: ["python"], setup: inDir(d, `python3 -m venv /tmp/venv && ${inst}`), test: inDir(d, "/tmp/venv/bin/python -m pytest -q"),
        file: narrow(d, "/tmp/venv/bin/python -m pytest -q {files}", "/tmp/venv/bin/python -m pytest -q"), caches: ["pip:/home/node/.cache/pip"], globs: ["**/test_*.py", "**/*_test.py", "**/tests/**"] };
    }
  }
  return {};
}

// The three files' text for a repo's stacks.
export function render(name, stacks, docs = []) {
  const ps = stacks.map((s) => ({ ...s, ...plan(s) }));
  const join = (k) => ps.map((p) => p[k]).filter(Boolean).join(" && ");
  const docker = [...new Set(ps.flatMap((p) => p.docker ?? []))];
  const caches = [...new Set(ps.flatMap((p) => p.caches ?? []))];
  const syntax = Object.assign({}, ...ps.map((p) => p.syntax ?? {}));
  const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
  const env = [`# ${name}: written by delegate.sh setup from ${ps.map((p) => `${p.stack}${p.dir === "." ? "" : ` (${p.dir})`}`).join(", ") || "no known manifest"}.`,
    "# Shell syntax. Holds a secret: never leaves this folder. Every option: projects/example.env.", "",
    "OMNIROUTE_API_KEY=", "DEFAULT_MODEL=", "",
    join("setup") ? `SETUP_CMD=${q(join("setup"))}` : "# SETUP_CMD: none needed (npm ci runs by itself when package-lock.json is at the root)",
    join("test") ? `TEST_CMD=${q(join("test"))}` : "# TEST_CMD=  (no test command found; the default is npm test)",
    ...(caches.length ? [`CACHES=${q(caches.join(" "))}`] : []),
    ...Object.entries(syntax).map(([ext, cmd]) => `SYNTAX_${ext}=${q(cmd)}`), ""].join("\n");
  const dockerfile = docker.length ? ["# Written by delegate.sh setup. Build with: delegate.sh build <repo>", "FROM agent-box:latest", "USER root", "",
    ...docker.map((k) => `${DOCKER[k]}\n`), "USER node", ""].join("\n") : null;
  const files = ps.filter((p) => p.file);
  const globs = [...new Set(ps.flatMap((p) => p.globs ?? []))];
  const yaml = [`# Context map for ${name}: written by delegate.sh setup. Add areas (paths -> docs, tests, traps) as you`,
    "# learn the code; see projects/lykos.context.yaml for a full one, and delegate.sh context-check.", "",
    ...(docs.length ? ["always:", ...docs.map((d) => `  - "${d}"`), ""] : []),
    "test_globs:", ...globs.map((g) => `  - "${g}"`), "",
    ...(files.length ? [`# The narrowest check for named test files. {files}, {dirs} (./dir), {tests} (Gradle filters).${files.length > 1 ? " Other stacks:" : ""}`,
      ...files.slice(1).map((p) => `#   ${p.stack}: ${p.file}`), `test_file_command: '${files[0].file.replace(/'/g, "''")}'`, ""] : []),
    "areas: []", ""].join("\n");
  return { env, dockerfile, yaml };
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const [repoArg, ...flags] = process.argv.slice(2);
  if (repoArg === "--example") {
    console.log(["# Copy to projects/<repo>.Dockerfile and uncomment what the project needs, or let `delegate.sh setup <repo>`",
      "# write it. Then: delegate.sh build <repo>. The build sees only this file. Generated: node lib/setup.mjs --example",
      "FROM agent-box:latest", "USER root", "", ...Object.values(DOCKER).map((b) => `${b.replace(/^(?!#)/gm, "# ")}\n`), "USER node"].join("\n"));
    process.exit(0);
  }
  if (!repoArg) { console.error("usage: setup <repo> [--dry-run]"); process.exit(2); }
  const repo = execFileSync("git", ["-C", repoArg, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const name = path.basename(repo).toLowerCase(), files = tracked(repo);
  const docs = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "CODING_STANDARDS.md", "GLOSSARY.md"].filter((f) => files.includes(f));
  const stacks = detect(repo, files);
  const { env, dockerfile, yaml } = render(name, stacks, docs);
  const dry = flags.includes("--dry-run");
  console.log(`setup ${name}: ${stacks.map((s) => `${s.stack}${s.dir === "." ? "" : ` (${s.dir})`}`).join(", ") || "no known manifest"}`);
  for (const [f, text] of [[`${name}.env`, env], [`${name}.Dockerfile`, dockerfile], [`${name}.context.yaml`, yaml]]) {
    if (text === null) { console.log(`  ${f}: not needed (the base image has Node)`); continue; }
    const p = path.join(BOX, "projects", f);
    if (fs.existsSync(p)) { console.log(`  ${f}: exists, left alone`); continue; }
    if (dry) { console.log(`  ${f}: would write\n${text.replace(/^/gm, "    | ")}`); continue; }
    fs.writeFileSync(p, text);
    console.log(`  ${f}: written`);
  }
  if (!dry) console.log(["next:", `  1. Fill OMNIROUTE_API_KEY and DEFAULT_MODEL in projects/${name}.env; read the commands it guessed.`,
    ...(dockerfile ? [`  2. delegate.sh build ${repoArg}`] : []), `  ${dockerfile ? 3 : 2}. delegate.sh baseline ${repoArg}   (setup and tests, no model: the guesses work or not)`].join("\n"));
}

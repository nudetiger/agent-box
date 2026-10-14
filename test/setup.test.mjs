// delegate.sh setup (lib/setup.mjs): stacks from manifests, and the files it would write.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detect, render } from "../lib/setup.mjs";

const repo = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ab-setup-"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return { d, files: Object.keys(files) };
};

test("setup: Go, Rust and CMake in subfolders; vendored trees skipped; whole-stack tests for subfolders", () => {
  const r = repo({ "go/go.mod": "", "rust/Cargo.toml": "", "rust/sub/Cargo.toml": "", "cpp/CMakeLists.txt": "", "cpp/lib/CMakeLists.txt": "", "vendor/x/go.mod": "" });
  const s = detect(r.d, r.files);
  assert.deepEqual(s.map((x) => `${x.stack}:${x.dir}`), ["go:go", "rust:rust", "cmake:cpp"]);
  const { env, dockerfile, yaml } = render("poly", s);
  assert.ok(env.includes(`SETUP_CMD='(cd go && go mod download) && (cd rust && cargo fetch) && (cd cpp && cmake -S . -B "/tmp/cmake\${PWD//\\//_}" -G Ninja`), env);
  assert.match(env, /^CACHES='go:\/home\/node\/go gobuild:\/home\/node\/\.cache\/go-build cargo:\/home\/node\/\.cargo\/registry'$/m);
  assert.match(env, /^SYNTAX_go='gofmt -e \{file\} >\/dev\/null'$/m);
  assert.match(env, /^OMNIROUTE_API_KEY=$/m);
  assert.match(dockerfile, /COPY --from=golang:1-bookworm[\s\S]*profile\.d\/go\.sh[\s\S]*COPY --from=rust:1-bookworm[\s\S]*CARGO_TARGET_DIR=\/tmp\/cargo-target[\s\S]*cmake ninja-build[\s\S]*USER node\n$/);
  assert.match(yaml, /^test_file_command: '\(cd go && go test \.\/\.\.\.\)'$/m, "a subfolder stack runs its whole test: {dirs} are repo paths");
});

test("setup: Node at the root needs no image and no setup line; the runner comes from the dependencies", () => {
  const r = repo({ "package.json": JSON.stringify({ scripts: { test: "vitest" }, devDependencies: { vitest: "1" } }), "package-lock.json": "{}", "AGENTS.md": "" });
  const s = detect(r.d, r.files);
  assert.deepEqual(s.map((x) => x.stack), ["node"]);
  const { env, dockerfile, yaml } = render("web", s, ["AGENTS.md"]);
  assert.equal(dockerfile, null);
  assert.match(env, /# SETUP_CMD: none needed/);
  assert.match(env, /^TEST_CMD='npm test'$/m);
  assert.match(yaml, /^always:\n {2}- "AGENTS\.md"$/m);
  assert.match(yaml, /^test_file_command: 'npx --no-install vitest run \{files\}'$/m);
});

test("setup: pnpm from packageManager, Gradle with its wrapper, Python with requirements", () => {
  const r = repo({ "package.json": JSON.stringify({ packageManager: "pnpm@9.1.0+sha256.x", scripts: { test: "x" } }), "pnpm-lock.yaml": "", "build.gradle.kts": "", "gradlew": "", "requirements.txt": "" });
  const { env, dockerfile } = render("mix", detect(r.d, r.files));
  assert.match(env, /npx --yes pnpm@9\.1\.0 install --frozen-lockfile/);
  assert.match(env, /bash \.\/gradlew --console=plain testClasses/);
  assert.match(env, /python3 -m venv \/tmp\/venv && \/tmp\/venv\/bin\/pip install -q -r requirements\.txt && \/tmp\/venv\/bin\/pip install -q pytest/);
  assert.match(dockerfile, /openjdk-17-jdk-headless[\s\S]*python3-venv/);
});

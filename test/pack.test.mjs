// lib/pack.mjs on a throwaway git repo: what lands in the task body the worker and reviewers read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "./tmp.mjs";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/pack.mjs");

function repo() {
  const dir = tmp("ab-pack-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  fs.mkdirSync(path.join(dir, "src/ledger"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/tui"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/ledger/db.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(dir, "src/tui/view.ts"), "export const y = 2;\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  fs.writeFileSync(path.join(dir, "map.yaml"), [
    "requires:", '  - "New term: add it to GLOSSARY.md."',
    "areas:",
    "  - name: ledger", '    paths: ["src/ledger/**"]', "    requires:", '      - "Schema change: update docs/schema.md."',
    "  - name: tui", '    paths: ["src/tui/**"]', "    requires:", '      - "New key binding: update docs/keys.md."',
  ].join("\n") + "\n");
  return dir;
}

function pack(dir, task) {
  const t = path.join(dir, "task.md"), out = path.join(dir, "out");
  fs.writeFileSync(t, task);
  execFileSync(process.execPath, [PACK, dir, t, path.join(dir, "map.yaml"), out], { encoding: "utf8" });
  return fs.readFileSync(path.join(out, "task-body.md"), "utf8");
}

test("doc duties: the top-level ones and the hit area's, not another area's", () => {
  const body = pack(repo(), "---\nfiles: [src/ledger/db.ts]\n---\nAdd a column.\n");
  assert.match(body, /## Definition of done: documentation/);
  assert.match(body, /- New term: add it to GLOSSARY.md\./);
  assert.match(body, /- Schema change: update docs\/schema.md\./);
  assert.doesNotMatch(body, /key binding/);
  assert.ok(body.indexOf("Add a column.") < body.indexOf("Definition of done"), "the duties follow the task");
});

test("doc duties: a body that already has them does not get them twice", () => {
  const dir = repo();
  const once = pack(dir, "---\nfiles: [src/ledger/db.ts]\n---\nAdd a column.\n");
  const twice = pack(dir, once);
  assert.equal(twice.split("Definition of done").length, 2);
});

test("doc duties: a map without requires adds nothing", () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "map.yaml"), 'areas:\n  - name: ledger\n    paths: ["src/ledger/**"]\n');
  const body = pack(dir, "---\nfiles: [src/ledger/db.ts]\n---\nAdd a column.\n");
  assert.equal(body, "Add a column.\n");
});

test("docs: bare paths and {path, reason} both listed; area docs and duty paths are in scope, always docs are not", () => {
  const dir = repo();
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  for (const f of ["AGENTS.md", "GLOSSARY.md", "docs/ledger.md", "docs/schema.md"]) fs.writeFileSync(path.join(dir, f), "x\n");
  git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "docs");
  fs.writeFileSync(path.join(dir, "map.yaml"), [
    "always:", '  - "AGENTS.md"',
    "requires:", '  - "New term: add it to GLOSSARY.md."',
    "areas:", "  - name: ledger", '    paths: ["src/ledger/**"]',
    "    docs:", '      - path: "docs/ledger.md"', '        reason: "How the ledger works."',
    "    requires:", '      - "Schema change: update docs/schema.md."',
  ].join("\n") + "\n");
  const t = path.join(dir, "task.md"), out = path.join(dir, "out");
  fs.writeFileSync(t, "---\nfiles: [src/ledger/db.ts]\n---\nAdd a column.\n");
  const meta = JSON.parse(execFileSync(process.execPath, [PACK, dir, t, path.join(dir, "map.yaml"), out], { encoding: "utf8" }));
  const ctx = fs.readFileSync(path.join(out, "context.md"), "utf8");
  assert.match(ctx, /- `AGENTS\.md`\n- `docs\/ledger\.md`: How the ledger works\./);
  assert.doesNotMatch(ctx, /undefined/);
  for (const p of ["docs/ledger.md", "GLOSSARY.md", "docs/schema.md"]) assert.ok(meta.scope.includes(p), p);
  assert.ok(!meta.scope.includes("AGENTS.md"));
});

// Fast syntax check of one edited file, run by the agent-box OpenCode plugin after every edit.
// Prints the error and exits 1 when the file does not parse; prints nothing and exits 0 otherwise,
// or when the language is not covered. Built in: parse only, no type check, no imports resolved.
//
//   node syntax-check.mjs <file>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";

const file = process.argv[2];
let src;
try { src = fs.readFileSync(file, "utf8"); } catch { process.exit(0); }
const ext = path.extname(file).toLowerCase();

function nodeCheck(code, suffix) {
  const tmp = path.join(os.tmpdir(), `syntax-${process.pid}${suffix}`);
  fs.writeFileSync(tmp, code);
  try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe", timeout: 10000 }); }
  catch (e) { fail(String(e.stderr || e.message).replaceAll(tmp, file)); }
  finally { fs.rmSync(tmp, { force: true }); }
}
function fail(msg) {
  console.log(msg.split("\n").filter((l) => l.trim() && !/^\s*at |^Node\.js v/.test(l)).join("\n").trim().slice(0, 1500));
  process.exit(1);
}

// A project's own check for an extension wins: SYNTAX_<ext>="gofmt -e {file} >/dev/null" in
// projects/<repo>.env. It fails the edit when it exits non-zero; its output is the message.
const custom = ext && process.env[`SYNTAX_${ext.slice(1)}`];
if (custom) {
  try { execFileSync("bash", ["-c", custom.replaceAll("{file}", '"$AB_FILE"')], { stdio: "pipe", timeout: 60000, env: { ...process.env, AB_FILE: file } }); }
  catch (e) { fail(`${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim() || e.message); }
  process.exit(0);
}

try {
  if ([".js", ".mjs", ".cjs"].includes(ext)) nodeCheck(src, ext === ".cjs" ? ".cjs" : ext === ".js" && !/^\s*(import|export)\s/m.test(src) ? ".cjs" : ".mjs");
  else if ([".ts", ".mts", ".cts"].includes(ext)) nodeCheck(stripTypeScriptTypes(src, { mode: "transform" }), ext === ".cts" ? ".cjs" : ".mjs");
  else if (ext === ".json" && !/tsconfig|jsconfig/.test(path.basename(file))) JSON.parse(src);
  // ast.parse, not py_compile: py_compile would leave __pycache__ in the repo.
  else if (ext === ".py") execFileSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])", file], { stdio: "pipe", timeout: 10000 });
} catch (e) {
  fail(String(e.stderr || e.message));
}

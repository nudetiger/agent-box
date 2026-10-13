// Per-project role overrides: a ROLE_* line in projects/<repo>.env wins over agent-box.conf, in
// delegate.sh (run, review, ask resolve roles after loading the project) and in ticket mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectSettings, conf } from "../lib/ticket.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("delegate.sh roles: the project file overrides one role and keeps the rest", () => {
  // A repo with no projects/<name>.env of its own: AGENT_BOX_PROJECT_ENV names the settings file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-roles-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, 'ROLE_review_spec="cursor/kimi-k3-high"   # spec review on another family\nREVIEW_ROLES="review-spec"\n');
  const out = execFileSync("bash", [path.join(BOX, "delegate.sh"), "roles", dir],
    { encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env } });
  const row = (n) => out.split("\n").find((l) => l.split(/\s+/)[0] === n)?.split(/\s+/);
  assert.deepEqual(row("review-spec"), ["review-spec", "project", "cursor/kimi-k3-high"]);
  assert.deepEqual(row("REVIEW_ROLES"), ["REVIEW_ROLES", "project", "review-spec"]);
  const global = conf("ROLE_implement").split(" ")[0];
  assert.equal(row("implement")?.slice(0, 3).join(" "), `implement conf ${global}`);
});

test("ticket mode: project settings parse as bash reads them and win over agent-box.conf", () => {
  const env = projectSettings([
    'ROLE_escalate="x/opus high"  # comment',
    "export TICKET_ESCALATE_ROLE=implement-hard # bare value, comment cut",
    "TEST_CMD='npm test -- --grep \"a b\"'",
    'LAND_TRAILERS="Co-Authored-By: A <a@a>\\nCo-Authored-By: B <b@b>"',
    "OMNIROUTE_API_KEY=never-read",
  ].join("\n"));
  assert.deepEqual(env, {
    ROLE_escalate: "x/opus high",
    TICKET_ESCALATE_ROLE: "implement-hard",
    TEST_CMD: 'npm test -- --grep "a b"',
    LAND_TRAILERS: "Co-Authored-By: A <a@a>\\nCo-Authored-By: B <b@b>",
  });
  const P = { env };
  assert.equal(conf("TICKET_ESCALATE_ROLE", P), "implement-hard");
  assert.equal(conf("ROLE_escalate", P), "x/opus high");
  assert.equal(conf("ROLE_implement", P), conf("ROLE_implement"), "an unset key falls back to agent-box.conf");
});

test("review relaunches delegate.sh by its absolute path, also when called as a relative 'delegate.sh'", () => {
  // No OmniRoute key: the relaunched run stops at need_key, so no container and no model is involved.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-self-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  git("branch", "agent/x");
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, "OMNIROUTE_API_KEY=\n");
  const runs = path.join(BOX, "runs", path.basename(dir).toLowerCase());
  try {
    execFileSync("bash", ["delegate.sh", "review", dir, "agent/x", "--roles", "review-spec"],
      { cwd: BOX, encoding: "utf8", stdio: "pipe", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env, AGENT_BOX_HERDR: "0" } });
    const log = fs.readdirSync(runs).filter((f) => /^\.rv-.*-review-spec\.log$/.test(f)).map((f) => fs.readFileSync(path.join(runs, f), "utf8")).join("");
    assert.doesNotMatch(log, /command not found/);
    assert.match(log, /OMNIROUTE_API_KEY is empty/, "the relaunched run started and reached its own checks");
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test("spec reviewer: never the implementer's family", async () => {
  const { family, specRole } = await import("../lib/family.mjs");
  assert.equal(family("antigravity/claude-opus-4-6-thinking"), "anthropic");
  assert.equal(family("gemini-3.8-flash-tiered high"), "google");
  assert.equal(family("antigravity/gemini-3.1-pro-high"), "google");
  const ds = "deepseek/deepseek-flash-max", opus = "antigravity/claude-opus-4-6-thinking";
  assert.equal(specRole("gemini-3.8-flash-tiered", ds, opus), "review-spec");
  assert.equal(specRole("deepseek/deepseek-flash", ds, opus), "review-spec-alt");
  assert.equal(specRole(undefined, ds, opus), "review-spec", "a branch agent-box did not make keeps the default");
  assert.equal(specRole(ds, ds, "deepseek/deepseek-pro"), "review-spec", "an alt of the same family is no better");
});

test("review: a branch DeepSeek wrote gets review-spec-alt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-alt-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  git("branch", "agent/ds-run");
  const env = path.join(dir, "settings.env");
  fs.writeFileSync(env, "OMNIROUTE_API_KEY=\n");
  const runs = path.join(BOX, "runs", path.basename(dir).toLowerCase());
  fs.mkdirSync(path.join(runs, "ds-run"), { recursive: true });
  fs.writeFileSync(path.join(runs, "ds-run", "summary.json"), JSON.stringify({ model: "deepseek/deepseek-flash-max" }, null, 2));
  try {
    const r = spawnSync("bash", ["delegate.sh", "review", dir, "agent/ds-run"],
      { cwd: BOX, encoding: "utf8", env: { ...process.env, AGENT_BOX_PROJECT_ENV: env, AGENT_BOX_HERDR: "0" } });
    assert.match(r.stderr, /spec review goes to review-spec-alt/);
    const logs = fs.readdirSync(runs).filter((f) => f.endsWith(".log"));
    assert.ok(logs.some((f) => /-review-spec-alt\.log$/.test(f)), logs.join(", "));
    assert.ok(logs.some((f) => /-review-std\.log$/.test(f)), "the standards axis is unchanged");
    assert.ok(!logs.some((f) => /-review-spec\.log$/.test(f)), "no same-family spec review");
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test("ticket mode's red command: patterns grep -E accepts, matching test paths only", async () => {
  const { redCommand } = await import("../lib/ticket.mjs");
  const cmd = redCommand({ map: { test_file_command: "npx tsx --test {files}" }, testGlobs: ["**/*.test.*", "src/test/**"] });
  assert.doesNotMatch(cmd, /\(\?:/);
  const pats = [...cmd.matchAll(/'(\(\^\|\/\)[^']*)'/g)].map((m) => m[1]);
  assert.equal(pats.length, 2);
  const r = spawnSync("grep", ["-E", ...pats.flatMap((p) => ["-e", p])], { input: "a/b.test.ts\na/b.ts\nsrc/test/X.java\n", encoding: "utf8" });
  assert.equal(r.stderr, "");
  assert.deepEqual(r.stdout.trim().split("\n"), ["a/b.test.ts", "src/test/X.java"]);
});

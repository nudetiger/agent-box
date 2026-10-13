// Per-project role overrides: a ROLE_* line in projects/<repo>.env wins over agent-box.conf, in
// delegate.sh (run, review, ask resolve roles after loading the project) and in ticket mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

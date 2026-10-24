// Lessons for implementers (lib/examples.mjs lessons), the OpenCode config limits (image/make-config.mjs)
// and disk cleanup (lib/gc.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "./tmp.mjs";
import { lessons } from "../lib/examples.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const review = (id, ts, findings) => ({ v: 1, id, ts, type: "review", project: "p", run: `rv-${id}`,
  findings: findings.map(([category, issue], i) => ({ n: i + 1, severity: "medium", category, issue })) });
const label = (refs, cause, ts) => ({ v: 1, id: `l-${refs[0]}`, ts, type: "label", project: "p", refs, cause, source: "harness" });

const events = [
  review("r1", "2026-10-01T00:00:00Z", [["edge_case", "old edge"], ["standard", "never accepted"]]),
  label(["r1#1"], "worker_careless", "2026-10-01T00:01:00Z"),
  review("r2", "2026-10-05T00:00:00Z", [["logic", "newer logic"]]),
  label(["r2#1"], "worker_careless", "2026-10-05T00:01:00Z"),
  review("r3", "2026-10-09T00:00:00Z", [["security", "false alarm"]]),
  label(["r3#1"], "review_false_positive", "2026-10-09T00:01:00Z"),
];

test("lessons: accepted findings newest first, rejected ones left out, kinds counted", () => {
  const t = lessons(events, "p");
  assert.match(t, /## What reviews of this project keep finding/);
  assert.ok(t.indexOf("newer logic") < t.indexOf("old edge"));
  assert.doesNotMatch(t, /false alarm/);
  assert.doesNotMatch(t, /never accepted\n/);
  assert.match(t, /Most frequent kinds: /);
});

test("lessons: before keeps out what was learned later; no events, no section", () => {
  const t = lessons(events, "p", 6, "2026-10-03T00:00:00Z");
  assert.match(t, /old edge/);
  assert.doesNotMatch(t, /newer logic/);
  assert.equal(lessons(events, "nobody"), "");
});

function config(env) {
  const home = tmp("ab-cfg-");
  const list = path.join(home, "models.json");
  fs.writeFileSync(list, JSON.stringify({ data: [{ id: "m-small", context_length: 64000 }, { id: "m-big", context_length: 1000000 }] }));
  execFileSync("node", [path.join(ROOT, "image", "make-config.mjs")], { env: { ...process.env, HOME: home, USERPROFILE: home, MODELS_JSON: list, ...env } });
  return JSON.parse(fs.readFileSync(path.join(home, ".config", "opencode", "opencode.json"), "utf8"));
}

test("make-config: only the run's models, each with limits that compact at COMPACT_AT", () => {
  const c = config({ MODEL: "m-big", SCOUT_MODEL: "m-small", COMPACT_AT: "100000", EFFORT: "high" });
  assert.deepEqual(Object.keys(c.provider.omniroute.models).sort(), ["m-big", "m-small"]);
  assert.deepEqual(c.provider.omniroute.models["m-big"].limit, { context: 132000, output: 32000 });
  // A model whose real window is smaller keeps its real window.
  assert.equal(c.provider.omniroute.models["m-small"].limit.context, 64000);
  assert.equal(c.provider.omniroute.models["m-big"].options.reasoningEffort, "high");
  assert.deepEqual(c.compaction, { auto: true, prune: true, preserve_recent_tokens: 40000 });
});

test("make-config: COMPACT_AT=0 keeps the real window and turns compaction and pruning off", () => {
  const c = config({ MODEL: "m-big", COMPACT_AT: "0" });
  assert.equal(c.provider.omniroute.models["m-big"].limit.context, 1000000);
  assert.deepEqual(c.compaction, { auto: false, prune: false });
});

test("gc: dry run lists, --yes removes model lists and old archives, parked runs untouched", () => {
  const runs = tmp("ab-gc-");
  const mk = (rel, body = "x", old = false) => {
    const f = path.join(runs, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
    if (old) { const t = new Date(Date.now() - 30 * 86400e3); fs.utimesSync(f, t, t); }
    return f;
  };
  const models = mk("p/r1/models.json", "{}");
  const oldTgz = mk("p/r1/opencode-data.tgz", "z", true);
  const newTgz = mk("p/r2/opencode-data.tgz", "z");
  const parked = mk("p/r3/opencode-data.tgz", "z", true); mk("p/r3/parked", "c img");
  const summary = mk("p/r1/summary.json", "{}");
  const gc = (...a) => execFileSync("node", [path.join(ROOT, "lib", "gc.mjs"), runs, ...a], { encoding: "utf8", env: { ...process.env, AGENT_BOX_GC_TMP: tmp("ab-gct-") } });
  assert.match(gc(), /dry run/);
  assert.ok(fs.existsSync(models) && fs.existsSync(oldTgz));
  gc("--yes");
  assert.ok(!fs.existsSync(models) && !fs.existsSync(oldTgz));
  assert.ok(fs.existsSync(newTgz) && fs.existsSync(parked) && fs.existsSync(summary));
});

test("gc: old agent/* branches, scratch and system temp leftovers go; recent and parked stay", () => {
  const runs = tmp("ab-gcb-"), sysTmp = tmp("ab-gct-"), repo = tmp("ab-gcr-");
  const old = new Date(Date.now() - 30 * 86400e3);
  const mk = (f, body = "x", aged = false) => {
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
    if (aged) fs.utimesSync(f, old, old);
    return f;
  };
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: old.toISOString() } });
  g("init", "-q"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c");
  for (const b of ["old", "new", "gone", "kept"]) g("branch", `agent/${b}`);
  mk(path.join(runs, "p", ".repo"), repo);
  mk(path.join(runs, "p", "old", "ended"), "1", true);
  mk(path.join(runs, "p", "new", "ended"), "1");
  mk(path.join(runs, "p", "kept", "ended"), "1", true); mk(path.join(runs, "p", "kept", "parked"), "c img");
  const oldScratch = mk(path.join(runs, ".tmp", "message.abc123"), "m", true);
  const newScratch = mk(path.join(runs, ".tmp", "message.def456"), "m");
  const leftover = mk(path.join(sysTmp, "ab-loop-Xy12Zq"), "t", true);
  const notOurs = mk(path.join(sysTmp, "ab-build.sh"), "t", true);
  const gc = (...a) => execFileSync("node", [path.join(ROOT, "lib", "gc.mjs"), runs, ...a], { encoding: "utf8", env: { ...process.env, AGENT_BOX_GC_TMP: sysTmp } });
  assert.match(gc(), /2 .*agent\/\* branches older than 14 days/);
  gc("--yes");
  assert.deepEqual(g("branch", "--list", "agent/*", "--format=%(refname:short)").trim().split("\n"), ["agent/kept", "agent/new"]);
  assert.ok(!fs.existsSync(oldScratch) && !fs.existsSync(leftover));
  assert.ok(fs.existsSync(newScratch) && fs.existsSync(notOurs));
});

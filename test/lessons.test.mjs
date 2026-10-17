// Lessons for implementers (lib/examples.mjs lessons), the OpenCode config limits (image/make-config.mjs)
// and disk cleanup (lib/gc.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-cfg-"));
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
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "ab-gc-"));
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
  const gc = (...a) => execFileSync("node", [path.join(ROOT, "lib", "gc.mjs"), runs, ...a], { encoding: "utf8" });
  assert.match(gc(), /dry run/);
  assert.ok(fs.existsSync(models) && fs.existsSync(oldTgz));
  gc("--yes");
  assert.ok(!fs.existsSync(models) && !fs.existsSync(oldTgz));
  assert.ok(fs.existsSync(newTgz) && fs.existsSync(parked) && fs.existsSync(summary));
});

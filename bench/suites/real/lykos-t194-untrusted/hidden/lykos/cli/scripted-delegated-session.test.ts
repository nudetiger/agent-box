// T180 (spec #22, stories 1-6, 29-36, 74): a delegated session is an ordinary
// Lykos session whose containment defaults to `auto`, under a floor.
//
// Seam 1: the scripted-model session with a stand-in container runtime. The
// session is the real one (`runStandaloneTask`, the engine `lykos run` calls);
// only the model and the runtime are stand-ins. The credential line is proved
// in delegated-session-credential.test.ts, which needs a process of its own.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defaultExtensionVersion } from "../extensions/defaults/index.js";
import { REPO_MAP_HEADING } from "../context/repo-map.js";
import { scaffoldLykosDir } from "../config/scaffold.js";
import { standInRuntime } from "./scripted-container.js";
import { call, reply, runScriptedSession, say, scriptedPiHost } from "./scripted-session.js";

// T194: a project the store does not trust cannot set its own commands or lower containment, and these tests are
// about the project config doing exactly that. The untrusted case is scripted-untrusted-project-commands.test.ts.
const DELEGATED = { delegated: true, trustSource: "stored" } as const;

/** A command that leaves `LOCAL-<name>` behind if it is run for real on this machine. */
const canary = (name: string): string => `node -e "require('fs').writeFileSync('LOCAL-${name}','x')"`;

/** The user's config file in the scripted world's throwaway home. */
const userConfig = (): string => join(dirname(scriptedPiHost()), "config.yaml");
afterEach(() => rmSync(userConfig(), { force: true }));

const EXTENSIONS = [
  "extensions:",
  "  - { name: pi-cache-optimizer, version: 2.8.6 }",
  "  - { name: pi-hashline-edit, version: 0.8.3 }",
  `  - { name: lykos-repo-map, version: ${defaultExtensionVersion()} }`,
  "",
].join("\n");

const FILES = { "package.json": "{}\n", "src/util.ts": "export const two = 2;\n" };
const EDIT_SCRIPT = () => [
  reply(call("read", { path: "src/util.ts" })),
  reply(call("write", { path: "src/util.ts", content: "export const two = 3;\n" })),
  reply(say("done")),
];

function messageOf(run: { result: { status: string; message?: string } }): string {
  return run.result.status === "error" ? (run.result.message ?? "") : "";
}

describe("a delegated session is the standalone session (T180)", () => {
  it("fires default extensions, the post-edit loop and checkpoints, and `lykos show` reads it as it reads a standalone one", async () => {
    const config = `${EXTENSIONS}feedback:\n  command: ${JSON.stringify(canary("post-edit"))}\ngate:\n  enabled: false\n`;
    const runtime = standInRuntime();
    const delegated = await runScriptedSession({
      files: FILES,
      config,
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: EDIT_SCRIPT(),
    });
    const standalone = await runScriptedSession({ files: FILES, config, script: EDIT_SCRIPT() });
    for (const run of [delegated, standalone]) assert.equal(run.result.status, "ok", JSON.stringify(run.result));

    // The default extension: the outline rides the head.
    assert.equal((delegated.sent[0]!.systemPrompt ?? "").split(REPO_MAP_HEADING).length - 1, 1, "the repo map is in the prompt");
    assert.match(delegated.show(), /lykos-repo-map/);
    // The post-edit loop ran (in the container, which is where a delegated session's commands go).
    const row = delegated.session();
    assert.equal(row.post_edit_runs, 1);
    assert.equal(existsSync(join(delegated.workspace, "LOCAL-post-edit")), false, "the check ran in the container");
    // Checkpoints, visible in show exactly as in a standalone session.
    assert.match(delegated.show(), /edits\s+1 turn\(s\) changed files; every one has a checkpoint/);
    for (const key of ["checkpoints_written", "post_edit_runs", "flag_retrieval", "edited_file_count"] as const) {
      assert.equal(row[key], standalone.session()[key], key);
    }
    assert.equal(row.execution_shape, standalone.session().execution_shape);
  });

  it("a project made by `lykos init` runs a delegated session at auto, because the scaffold leaves the level unset", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      setup: (workspace) => {
        scaffoldLykosDir(workspace);
      },
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.session().containment_requested, "auto");
    assert.equal(run.session().containment_used, "auto");
  });

  it("the spend guard stops a delegated session through the same path, before anything boots", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      config: "budget:\n  per_day_usd: 0\n",
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(say("never reached"))],
    });
    assert.equal(run.result.status, "blocked");
    assert.match(run.result.status === "blocked" ? run.result.reason : "", /daily spend cap reached/);
    assert.equal(run.modelCalls, 0);
    assert.deepEqual(runtime.operations, [], "no container was looked for or started");
  });
});

describe("the containment level of a delegated session (T180, stories 29-33)", () => {
  it("auto, the default, contains the commands when a runtime answers, and the result and ledger say so", async () => {
    const runtime = standInRuntime({ name: "docker", version: "29.0.0" });
    const run = await runScriptedSession({
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(call("bash", { command: canary("auto") })), reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(existsSync(join(run.workspace, "LOCAL-auto")), false, "the command did not run here");
    const containment = run.result.status === "ok" ? run.result.containment : undefined;
    assert.equal(containment?.requested, "auto");
    assert.equal(containment?.used, "auto");
    assert.equal(containment?.runtime, "docker");
    assert.equal(run.session().containment_requested, "auto");
    assert.equal(run.session().containment_used, "auto");
    assert.equal(run.session().container_runtime, "docker");
    assert.match(run.show(), /commands in docker/);
  });

  it("auto with no runtime runs uncontained, and the result, the ledger and stderr say so", async () => {
    const runtime = standInRuntime({ available: false });
    const run = await runScriptedSession({
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(call("bash", { command: canary("fallback") })), reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(existsSync(join(run.workspace, "LOCAL-fallback")), true, "it ran here");
    assert.deepEqual(run.result.status === "ok" ? run.result.containment : undefined, { requested: "auto", used: "off" });
    assert.equal(run.session().containment_requested, "auto");
    assert.equal(run.session().containment_used, "off");
    assert.match(run.stderr, /containment\.level is "auto" and no container runtime is available/);
  });

  it("a standalone session still defaults to off and never looks for a runtime", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({ extra: { containmentDrivers: [runtime.driver] }, script: [reply(say("done"))] });
    assert.equal(run.result.status, "ok");
    assert.deepEqual(runtime.operations, []);
  });

  it("required with no runtime refuses before the model is asked", async () => {
    const runtime = standInRuntime({ available: false });
    const run = await runScriptedSession({
      extra: { ...DELEGATED, containmentLevel: "required", containmentDrivers: [runtime.driver] },
      script: [reply(say("never reached"))],
    });
    assert.equal(run.result.status, "error");
    assert.match(messageOf(run), /containment\.level is "required" but no container runtime is available/);
    assert.equal(run.modelCalls, 0);
  });

  it("off runs the commands on the host and never looks for a runtime", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      extra: { ...DELEGATED, containmentLevel: "off", containmentDrivers: [runtime.driver] },
      script: [reply(call("bash", { command: canary("off") })), reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(existsSync(join(run.workspace, "LOCAL-off")), true);
    assert.deepEqual(runtime.operations, []);
    assert.deepEqual(run.result.status === "ok" ? run.result.containment : undefined, { requested: "off", used: "off" });
  });

  it("the argument beats config, and --network reaches the runtime", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      config: "containment:\n  level: off\n  network: open\n",
      extra: { ...DELEGATED, containmentLevel: "required", containmentNetwork: "none", containmentDrivers: [runtime.driver] },
      script: [reply(call("bash", { command: "true" })), reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    const start = runtime.operations.find((o) => o.op === "start");
    assert.equal(start?.op === "start" && start.spec.network, "none");
    assert.equal(run.session().containment_used, "required");
  });

  it("project config beats the delegated default; a specialist beats project config; the argument beats the specialist", async () => {
    const runtime = standInRuntime();
    const config = "containment:\n  level: off\n";
    const projectOnly = await runScriptedSession({
      config,
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(projectOnly.session().containment_requested, "off", "config said off; the default auto does not override it");

    const specialist = (level: string) => (workspace: string) => {
      const dir = join(workspace, ".lykos", "specialists");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "boxed.yaml"), `description: boxed
containment:
  level: ${level}
`);
    };
    const bySpecialist = await runScriptedSession({
      config,
      setup: specialist("required"),
      extra: { ...DELEGATED, specialist: "boxed", containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(bySpecialist.session().containment_requested, "required", "the specialist beats project config");
    const byArgument = await runScriptedSession({
      config,
      setup: specialist("required"),
      extra: { ...DELEGATED, specialist: "boxed", containmentLevel: "auto", containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(byArgument.session().containment_requested, "auto", "the orchestrator's choice beats the specialist's");
  });
});

describe("containment.minimum, the floor (T180, stories 34-35)", () => {
  it("a floor of required refuses --containment off and auto, naming the floor and the file, before anything starts", async () => {
    const runtime = standInRuntime();
    for (const level of ["off", "auto"] as const) {
      const run = await runScriptedSession({
        config: "containment:\n  minimum: required\n",
        extra: { ...DELEGATED, containmentLevel: level, containmentDrivers: [runtime.driver] },
        script: [reply(say("never reached"))],
      });
      assert.equal(run.result.status, "error", level);
      const message = messageOf(run);
      assert.match(message, new RegExp(`containment level "${level}" \\(from --containment\\) is below the floor "required"`));
      assert.ok(message.includes(join(run.workspace, ".lykos", "config.yaml")), `names the project file: ${message}`);
      assert.equal(run.modelCalls, 0);
    }
    assert.deepEqual(runtime.operations, []);
  });

  it("the delegated default (auto) is refused by a floor of required, and required is allowed", async () => {
    const runtime = standInRuntime();
    const config = "containment:\n  minimum: required\n";
    const byDefault = await runScriptedSession({ config, extra: { ...DELEGATED, containmentDrivers: [runtime.driver] }, script: [reply(say("x"))] });
    assert.match(messageOf(byDefault), /\(from the default\) is below the floor "required"/);
    const allowed = await runScriptedSession({
      config,
      extra: { ...DELEGATED, containmentLevel: "required", containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(allowed.result.status, "ok", JSON.stringify(allowed.result));
    assert.equal(allowed.session().containment_used, "required");
  });

  it("an auto that would fall back counts as off against the floor", async () => {
    const runtime = standInRuntime({ available: false });
    const run = await runScriptedSession({
      config: "containment:\n  minimum: auto\n",
      extra: { ...DELEGATED, containmentDrivers: [runtime.driver] },
      script: [reply(say("never reached"))],
    });
    assert.equal(run.result.status, "error");
    assert.match(messageOf(run), /containment\.minimum is "auto" \(set in .*config\.yaml\) and no container runtime is available.*counts as "off"/);
    assert.equal(run.modelCalls, 0);

    const withRuntime = await runScriptedSession({
      config: "containment:\n  minimum: auto\n",
      extra: { ...DELEGATED, containmentDrivers: [standInRuntime().driver] },
      script: [reply(say("done"))],
    });
    assert.equal(withRuntime.result.status, "ok", "auto that finds a runtime meets a floor of auto");
  });

  it("the user's config sets a floor too, names its own file, and a project cannot lower it", async () => {
    writeFileSync(userConfig(), "containment:\n  minimum: required\n");
    const run = await runScriptedSession({
      config: "containment:\n  minimum: off\n",
      extra: { ...DELEGATED, containmentLevel: "off", containmentDrivers: [standInRuntime().driver] },
      script: [reply(say("never reached"))],
    });
    assert.equal(run.result.status, "error");
    assert.ok(messageOf(run).includes(userConfig()), messageOf(run));
    assert.match(messageOf(run), /floor "required"/);
  });

  it("a specialist cannot set the floor", async () => {
    // A specialist may not carry the key at all (ADR-0037 gives it level, network and image).
    const run = await runScriptedSession({
      setup: (workspace) => {
        const dir = join(workspace, ".lykos", "specialists");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "sneaky.yaml"), ["description: x", "containment:", "  minimum: off", ""].join("\n"));
      },
      config: "containment:\n  minimum: required\n",
      extra: { ...DELEGATED, specialist: "sneaky", containmentDrivers: [standInRuntime().driver] },
      script: [reply(say("never reached"))],
    });
    assert.equal(run.result.status, "error");
    assert.match(messageOf(run), /containment\.minimum is not a specialist setting/);
  });

  it("a minimum that is not one of the three levels is an error, not a floor of off", async () => {
    const run = await runScriptedSession({ config: "containment:\n  minimum: strict\n", extra: DELEGATED, script: [reply(say("x"))] });
    assert.equal(run.result.status, "error");
    assert.match(messageOf(run), /containment\.minimum must be one of off, auto, required; got "strict"/);
  });
});

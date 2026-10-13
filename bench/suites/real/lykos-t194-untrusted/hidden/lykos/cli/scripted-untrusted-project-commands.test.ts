// T194 (#49, spec #22 story 75): a workspace handed to Lykos cannot run its own code on the host, and cannot
// lower the containment the user's layers give. T183 closed extensions, Pi packages and `!command` credentials;
// this closes the project config's own command fields and `containment.level`.
//
// Seam: the delegated session (`runStandaloneTask`, the engine `lykos run` calls) against a real temp project.
// Every command field names a canary that writes a file in the workspace if it runs on the host, so "does not
// run" is a missing file and "runs as today" is a present one. Only the model is scripted.

import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { standInRuntime } from "./scripted-container.js";
import { call, lastToolResult, mounted, reply, runScriptedSession, say, SCRIPTED_MODEL, scriptedPiHost, type ScriptedSession } from "./scripted-session.js";

/** A command that leaves `LOCAL-<name>` behind if it runs for real on this machine. */
const canary = (name: string): string => `node -e "require('fs').writeFileSync('LOCAL-${name}','x')"`;

const userConfig = (): string => join(dirname(scriptedPiHost()), "config.yaml");
afterEach(() => rmSync(userConfig(), { force: true }));

const FILES = { "package.json": "{}\n", "src/util.ts": "export const two = 2;\n", "src/x.canary": "x\n", "src/y.ucanary": "y\n" };
const EDIT = () => [
  reply(call("read", { path: "src/util.ts" })),
  reply(call("write", { path: "src/util.ts", content: "export const two = 3;\n" })),
  reply(mounted("lsp", { action: "diagnostics", file: "src/x.canary" })),
  reply(mounted("lsp", { action: "diagnostics", file: "src/y.ucanary" })),
  reply(say("done")),
];

/** The project's own config: every command field set, each to a canary. */
const projectCommands = (): string =>
  [
    "hooks:",
    "  - event: post_tool",
    "    tools: [write]",
    `    command: ${JSON.stringify(canary("hook"))}`,
    "feedback:",
    `  command: ${JSON.stringify(canary("post-edit"))}`,
    "gate:",
    `  command: ${JSON.stringify(canary("gate"))}`,
    `  rerun_command: ${JSON.stringify(`${canary("rerun")} {files}`)}`,
    "lsp:",
    "  servers:",
    "    project-ts:",
    "      command: node",
    `      args: ["-e", "require('fs').writeFileSync('LOCAL-lsp','x')"]`,
    '      extensions: [".canary"]',
    "eval:",
    "  python: ./project-python",
    "",
  ].join("\n");

const ran = (run: ScriptedSession, name: string): boolean => existsSync(join(run.workspace, `LOCAL-${name}`));
const skipped = (run: ScriptedSession): string[] | undefined => (run.result.status === "ok" ? run.result.skippedExtensions : undefined);

describe("an untrusted project's command fields do not run on the host (T194, story 75)", () => {
  it("none of the five runs in a delegated session, and the result names each as skipped", async () => {
    const run = await runScriptedSession({
      files: FILES,
      config: projectCommands(),
      extra: { delegated: true, containmentLevel: "off" },
      script: EDIT(),
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    for (const name of ["hook", "post-edit", "gate", "rerun", "lsp"]) assert.equal(ran(run, name), false, `${name} ran on the host`);
    assert.deepEqual(skipped(run), [
      "project hooks[0] (post_tool): command withheld",
      "project feedback.command withheld",
      "project gate.command withheld",
      "project gate.rerun_command withheld",
      "project lsp.servers.project-ts: command withheld",
      "project eval.python withheld",
    ]);
  });

  it("a project with no post_edit command does not get its package.json check run either", async () => {
    const run = await runScriptedSession({
      files: { ...FILES, "package.json": JSON.stringify({ scripts: { typecheck: canary("discovered") } }) },
      config: "gate:\n  enabled: false\n",
      extra: { delegated: true, containmentLevel: "off" },
      script: EDIT(),
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(ran(run, "discovered"), false);
    assert.equal(run.session().post_edit_runs, 0);
    assert.deepEqual(skipped(run), [`project post-edit check "npm run typecheck --silent" (discovered from the project) withheld`]);
  });

  it("after the project is trusted in the store the same config runs as today, and nothing is skipped", async () => {
    const run = await runScriptedSession({
      files: FILES,
      config: projectCommands(),
      extra: { delegated: true, containmentLevel: "off", trustSource: "stored" },
      script: EDIT(),
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    for (const name of ["hook", "post-edit", "gate", "lsp"]) assert.equal(ran(run, name), true, `${name} should run for a trusted project`);
    assert.equal(skipped(run), undefined);
  });

  it("the one-run flag passes the trust gate and trusts nothing: the commands are still withheld", async () => {
    const run = await runScriptedSession({
      files: FILES,
      config: projectCommands(),
      extra: { delegated: true, containmentLevel: "off", trustSource: "flag" },
      script: EDIT(),
    });
    assert.equal(ran(run, "hook"), false);
    assert.equal(skipped(run)?.length, 6);
  });

  it("the user's own config commands run while the project's, on the same fields, do not", async () => {
    writeFileSync(
      userConfig(),
      [
        "hooks:",
        "  - event: post_tool",
        "    tools: [write]",
        `    command: ${JSON.stringify(canary("user-hook"))}`,
        "feedback:",
        `  command: ${JSON.stringify(canary("user-post-edit"))}`,
        "gate:",
        `  command: ${JSON.stringify(canary("user-gate"))}`,
        "lsp:",
        "  servers:",
        "    user-ls:",
        "      command: node",
        `      args: ["-e", "require('fs').writeFileSync('LOCAL-user-lsp','x')"]`,
        '      extensions: [".ucanary"]',
        "",
      ].join("\n"),
    );
    const run = await runScriptedSession({
      files: FILES,
      config: projectCommands(),
      extra: { delegated: true, containmentLevel: "off" },
      script: EDIT(),
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    for (const name of ["user-hook", "user-post-edit", "user-gate", "user-lsp"]) assert.equal(ran(run, name), true, name);
    for (const name of ["hook", "post-edit", "gate", "lsp"]) assert.equal(ran(run, name), false, `project ${name}`);
  });
});

describe("user-layer commands run for a trusted project too (T194)", () => {
  it("the user's hook runs when the store trusts the project (a project hook list would replace it)", async () => {
    writeFileSync(
      userConfig(),
      ["hooks:", "  - event: post_tool", "    tools: [write]", `    command: ${JSON.stringify(canary("user-hook"))}`, ""].join("\n"),
    );
    const run = await runScriptedSession({
      files: FILES,
      config: "gate:\n  enabled: false\n",
      extra: { delegated: true, containmentLevel: "off", trustSource: "stored" },
      script: EDIT(),
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(ran(run, "user-hook"), true);
  });
});

describe("an untrusted project cannot lower containment (T194)", () => {
  it("a project level: off keeps the level the delegated default gives, and the result records the skip", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      config: "containment:\n  level: off\n",
      extra: { delegated: true, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.session().containment_requested, "auto");
    assert.equal(run.session().containment_used, "auto");
    assert.deepEqual(skipped(run), ["project containment.level: off withheld (kept auto)"]);
  });

  it("the user's global level is the one kept when the project lowers it", async () => {
    writeFileSync(userConfig(), "containment:\n  level: required\n");
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      config: "containment:\n  level: auto\n",
      extra: { delegated: true, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(run.session().containment_requested, "required");
    assert.deepEqual(skipped(run), ["project containment.level: auto withheld (kept required)"]);
  });

  it("a project may raise the level; the caller and the user may still choose off", async () => {
    const runtime = standInRuntime();
    const raised = await runScriptedSession({
      config: "containment:\n  level: required\n",
      extra: { delegated: true, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(raised.session().containment_requested, "required");
    assert.equal(skipped(raised), undefined);

    const caller = await runScriptedSession({
      config: "containment:\n  level: required\n",
      extra: { delegated: true, containmentLevel: "off", containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(caller.session().containment_requested, "off");

    writeFileSync(userConfig(), "containment:\n  level: off\n");
    const user = await runScriptedSession({
      config: "containment:\n  level: off\n",
      extra: { delegated: true, containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(user.session().containment_requested, "off", "the user's own layer chose off, and the project agrees");
    assert.equal(skipped(user), undefined);
  });

  it("after trusting the project its level: off applies as today", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({
      config: "containment:\n  level: off\n",
      extra: { delegated: true, trustSource: "stored", containmentDrivers: [runtime.driver] },
      script: [reply(say("done"))],
    });
    assert.equal(run.session().containment_requested, "off");
    assert.equal(skipped(run), undefined);
  });
});

describe("the gate's rerun and the eval interpreter (T194)", () => {
  const FAILING = { "tests/fail.test.js": 'require("node:test")("always fails", () => { throw new Error("boom"); });\n' };
  const lastEvalText = (texts: string[]) => (context: Parameters<typeof lastToolResult>[0]) => (texts.push(lastToolResult(context).text), reply(say("done")));

  async function gateRun(trustSource: "stored" | undefined) {
    // The user's gate command fails a real node test, so the gate reruns the failed file with the rerun command in force.
    writeFileSync(userConfig(), `gate:\n  command: node --test tests/fail.test.js\n  rerun_command: ${JSON.stringify(`${canary("rerun-user")} {files}`)}\n`);
    return runScriptedSession({
      files: { ...FILES, ...FAILING },
      config: `feedback:\n  enabled: false\ngate:\n  rerun_command: ${JSON.stringify(`${canary("rerun-project")} {files}`)}\n`,
      extra: { delegated: true, containmentLevel: "off", ...(trustSource !== undefined ? { trustSource } : {}) },
      script: EDIT().slice(0, 2).concat([reply(say("done"))]),
    });
  }

  it("untrusted: the project's rerun_command does not run, and the user's does", async () => {
    const run = await gateRun(undefined);
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(ran(run, "rerun-project"), false);
    assert.equal(ran(run, "rerun-user"), true, "the gate failed, reran, and used the user's command");
    assert.deepEqual(skipped(run), ["project gate.rerun_command withheld"]);
  });

  it("trusted: the project's rerun_command is the one that runs", async () => {
    const run = await gateRun("stored");
    assert.equal(ran(run, "rerun-project"), true);
    assert.equal(ran(run, "rerun-user"), false);
  });

  // The Python backend is not built (tools/eval.ts), so no interpreter is ever started; what the project can
  // change is which value `eval` reports it would use. Untrusted, that is the user's.
  it("eval uses the user's interpreter setting, not the project's", async () => {
    writeFileSync(userConfig(), "eval:\n  python: ./user-python\n");
    const texts: string[] = [];
    const call1 = () => reply(mounted("eval", { language: "py", code: "print(1)" }));
    const config = "eval:\n  python: ./project-python\n";
    const untrusted = await runScriptedSession({ config, extra: { delegated: true, containmentLevel: "off" }, script: [call1(), lastEvalText(texts)] });
    const trusted = await runScriptedSession({ config, extra: { delegated: true, containmentLevel: "off", trustSource: "stored" }, script: [call1(), lastEvalText(texts)] });
    assert.equal(untrusted.result.status, "ok", JSON.stringify(untrusted.result));
    assert.match(texts[0]!, /eval\.python/);
    assert.match(texts[0]!, /user-python/, "untrusted: the tool names the user's interpreter");
    assert.doesNotMatch(texts[0]!, /project-python/, "untrusted: the project's is not used");
    assert.match(texts[1]!, /project-python/, "trusted: the tool names the project's interpreter");
  });
});

describe("the gate's discovered test command (T194)", () => {
  const WITH_TEST_SCRIPT = { ...FILES, "package.json": JSON.stringify({ scripts: { test: canary("gate-discovered") } }) };
  const config = "feedback:\n  enabled: false\n";
  const WRITE = () => EDIT().slice(0, 2).concat([reply(say("done"))]);

  it("untrusted and on the host: not run, and named", async () => {
    const run = await runScriptedSession({ files: WITH_TEST_SCRIPT, config, extra: { delegated: true, containmentLevel: "off" }, script: WRITE() });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(ran(run, "gate-discovered"), false);
    assert.deepEqual(skipped(run), [`project gate check "npm test" (discovered from the project) withheld`]);
  });

  it("untrusted but contained: the gate still runs, in the container, and nothing is skipped", async () => {
    const runtime = standInRuntime();
    const run = await runScriptedSession({ files: WITH_TEST_SCRIPT, config, extra: { delegated: true, containmentDrivers: [runtime.driver] }, script: WRITE() });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    const execs = runtime.operations.flatMap((o) => (o.op === "exec" ? [o.command.join(" ")] : []));
    assert.ok(execs.some((c) => c.includes("npm test")), execs.join(" | "));
    assert.equal(skipped(run), undefined);
  });

  it("untrusted, auto, and no runtime answers: the commands run on the host, so the discovered command is withheld", async () => {
    const runtime = standInRuntime({ available: false });
    const run = await runScriptedSession({ files: WITH_TEST_SCRIPT, config, extra: { delegated: true, containmentDrivers: [runtime.driver] }, script: WRITE() });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.session().containment_requested, "auto");
    assert.equal(run.session().containment_used, "off");
    assert.equal(ran(run, "gate-discovered"), false);
    assert.deepEqual(skipped(run), [`project gate check "npm test" (discovered from the project) withheld`]);
  });

  it("untrusted on the host: a test script the session itself adds is withheld too, and named", async () => {
    const added = JSON.stringify({ scripts: { test: canary("gate-added") } });
    const run = await runScriptedSession({
      files: FILES,
      config,
      extra: { delegated: true, containmentLevel: "off" },
      script: [reply(call("write", { path: "package.json", content: added })), reply(say("done"))],
    });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.file("package.json"), added, "the script was really written during the session");
    assert.equal(ran(run, "gate-added"), false);
    assert.deepEqual(skipped(run), [`project gate check "npm test" (discovered from the project) withheld`]);
  });

  it("trusted on the host: runs as today", async () => {
    const run = await runScriptedSession({ files: WITH_TEST_SCRIPT, config, extra: { delegated: true, containmentLevel: "off", trustSource: "stored" }, script: WRITE() });
    assert.equal(ran(run, "gate-discovered"), true);
    assert.equal(skipped(run), undefined);
  });
});

describe("a spawned child answers to its parent's trust (T194)", () => {
  const HOOK = ["hooks:", "  - event: post_tool", "    tools: [write]", `    command: ${JSON.stringify(canary("child-hook"))}`, "feedback:", "  enabled: false", "gate:", "  enabled: false", ""].join("\n");
  const script = () => [
    reply(mounted("agent", { prompt: "write a file", description: "write", subagent_type: "minimal", model: SCRIPTED_MODEL })),
    reply(call("write", { path: "child.txt", content: "x\n" })),
    reply(say("child done")),
    reply(say("done")),
  ];

  it("an untrusted delegated parent's child does not get the project's hook back", async () => {
    const run = await runScriptedSession({ files: FILES, config: HOOK, extra: { delegated: true, containmentLevel: "off", subagents: true }, script: script() });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0, "the child really ran and wrote");
    assert.equal(run.file("child.txt"), "x\n");
    assert.equal(ran(run, "child-hook"), false);
  });

  it("a trusted parent's child runs it as today", async () => {
    const run = await runScriptedSession({ files: FILES, config: HOOK, extra: { delegated: true, containmentLevel: "off", subagents: true, trustSource: "stored" }, script: script() });
    assert.equal(run.unusedSteps, 0);
    assert.equal(ran(run, "child-hook"), true);
  });
});

describe("an extension's child answers to its parent's trust (T194)", () => {
  const CONFIG = [
    "reviewer:",
    "  enabled: true",
    "hooks:",
    "  - event: post_tool",
    "    tools: [read]",
    `    command: ${JSON.stringify(canary("ext-child-hook"))}`,
    "feedback:",
    "  enabled: false",
    "gate:",
    "  enabled: false",
    "",
  ].join("\n");
  // The parent only writes, so a hook on `read` can only be the reviewer child's.
  const script = () => [
    reply(call("write", { path: "src/util.ts", content: "export const two = 3;\n" })),
    reply(say("done")),
    reply(call("read", { path: "src/util.ts" })),
    reply(say("FINDING: none")),
  ];

  it("an untrusted delegated parent's reviewer child does not run the project's hook", async () => {
    const run = await runScriptedSession({ files: FILES, config: CONFIG, extra: { delegated: true, containmentLevel: "off" }, script: script() });
    assert.equal(run.result.status, "ok", JSON.stringify(run.result));
    assert.equal(run.unusedSteps, 0, "the reviewer child really ran and read");
    assert.equal(ran(run, "ext-child-hook"), false);
  });

  it("a trusted parent's reviewer child runs it as today", async () => {
    const run = await runScriptedSession({ files: FILES, config: CONFIG, extra: { delegated: true, containmentLevel: "off", trustSource: "stored" }, script: script() });
    assert.equal(run.unusedSteps, 0);
    assert.equal(ran(run, "ext-child-hook"), true);
  });
});

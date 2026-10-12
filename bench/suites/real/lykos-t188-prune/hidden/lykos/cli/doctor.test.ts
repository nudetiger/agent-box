// T29.5 tests — docs/10-phase2-tasks.md T29.5, 06-extension-policy.md §1 bar
// 5, problems/13-separation-from-pi.md mitigation 4. Covers only the two
// functions this task added: the Dockerfile install-line parser and the pure
// reconciliation between declared (config.yaml) and installed (the image).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveExtensions, type ResolvedExtension } from "../config/extensions.js";
import {
  checkContainerRuntime,
  checkCredentialPools,
  checkFeedbackLoop,
  checkPruneExtension,
  checkPiHost,
  checkProviderMatrix,
  checkGit,
  checkRetryPolicy,
  checkSkills,
  findRepoRoot,
  formatProviderMatrixRow,
  parseDockerfileArgs,
  parseInstalledExtensions,
  probeConfiguredRuntimes,
  probeContainerRuntimes,
  reconcileExtensions,
  reconcileHostExtensions,
} from "./doctor.js";
import { gitVersion } from "../git/host-git.js";
import type { ContainerRuntimeDriver } from "../containment/runtime.js";
import { openCredentialDb, upsertCooldown } from "../credentials/db.js";
import { disableCredential, upsertCredential } from "../credentials/pool.js";

function ext(name: string, version: string): ResolvedExtension {
  return { name, version, scope: ["hop0"], path: `/whatever/${name}`, hop0: true };
}

describe("parseInstalledExtensions", () => {
  it("finds what the real docker/Dockerfile installs into Pi's package prefix", () => {
    const repoRoot = findRepoRoot();
    const dockerfilePath = join(repoRoot, "docker", "Dockerfile");
    const args = parseDockerfileArgs(dockerfilePath);
    const result = parseInstalledExtensions(dockerfilePath);
    assert.ok(!("error" in result), `expected packages, got error: ${"error" in result ? result.error : ""}`);
    if ("error" in result) return;
    // Doubles as a drift guard: if the install line ever stops naming one of
    // these two packages, this test fails alongside the doctor check.
    assert.equal(result.packages["@tintinweb/pi-subagents"], args.PI_SUBAGENTS_VERSION);
    assert.equal(result.packages["pi-cache-optimizer"], args.PI_CACHE_OPTIMIZER_VERSION);
  });

  it("parses a scoped package name on the LAST @, not the first", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-doctor-"));
    const dockerfilePath = join(dir, "Dockerfile");
    writeFileSync(
      dockerfilePath,
      [
        "ARG PI_CODING_AGENT_DIR=/home/node/.pi/agent",
        "ARG FOO_VERSION=1.2.3",
        'RUN npm install --prefix "${PI_CODING_AGENT_DIR}/npm" --no-fund --no-audit \\',
        '      "@scope/pkg-name@${FOO_VERSION}" \\',
        '      "plain-pkg@9.9.9" \\',
        " && echo done",
      ].join("\n"),
    );
    const result = parseInstalledExtensions(dockerfilePath);
    assert.ok(!("error" in result), `expected packages, got error: ${"error" in result ? result.error : ""}`);
    if ("error" in result) return;
    assert.equal(result.packages["@scope/pkg-name"], "1.2.3");
    assert.equal(result.packages["plain-pkg"], "9.9.9");
    assert.equal(Object.keys(result.packages).length, 2);
  });

  it("reports an error, not an empty object, when the install line is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-doctor-"));
    const dockerfilePath = join(dir, "Dockerfile");
    writeFileSync(dockerfilePath, "FROM node:24-bookworm-slim\nARG PI_VERSION=0.84.3\n");
    const result = parseInstalledExtensions(dockerfilePath);
    assert.ok("error" in result);
    if (!("error" in result)) return;
    assert.match(result.error, /no npm install --prefix/);
  });
});

describe("reconcileExtensions", () => {
  it("ok: declared and installed at the same exact version", () => {
    const checks = reconcileExtensions(
      { extensions: [ext("pi-cache-optimizer", "2.8.6")], errors: [] },
      { "pi-cache-optimizer": "2.8.6" },
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "ok");
    assert.match(checks[0]!.label, /pi-cache-optimizer@2\.8\.6 pinned and installed in the image/);
  });

  it("fail: declared and installed, but at a different version", () => {
    const checks = reconcileExtensions(
      { extensions: [ext("pi-cache-optimizer", "2.8.6")], errors: [] },
      { "pi-cache-optimizer": "2.8.7" },
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "fail");
    assert.match(checks[0]!.label, /declares 2\.8\.6/);
    assert.match(checks[0]!.label, /installs 2\.8\.7/);
    assert.match(checks[0]!.label, /declared pin is not what loads/);
  });

  it("fail: declared but not installed in the image at all", () => {
    const checks = reconcileExtensions({ extensions: [ext("pi-hashline-edit", "0.8.3")], errors: [] }, {});
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "fail");
    assert.match(checks[0]!.label, /not installed in the image/);
    assert.match(checks[0]!.label, /docker\/Dockerfile/);
    assert.match(checks[0]!.label, /sandbox:build/);
  });

  it("warn: installed in the image but not declared", () => {
    const checks = reconcileExtensions({ extensions: [], errors: [] }, { "@tintinweb/pi-subagents": "0.19.0" });
    // The "nothing declared at all" warn also fires alongside it — both are
    // true and neither implies the other.
    assert.equal(checks.length, 2);
    assert.ok(checks.every((c) => c.status === "warn"));
    const undeclaredRow = checks.find((c) => /not declared in config\.yaml/.test(c.label));
    assert.ok(undeclaredRow, "expected a row naming the undeclared installed package");
    assert.match(undeclaredRow!.label, /@tintinweb\/pi-subagents@0\.19\.0/);
    assert.match(undeclaredRow!.label, /costs image size/);
  });

  it("warn: nothing declared at all is a legitimate but reportable state", () => {
    const checks = reconcileExtensions({ extensions: [], errors: [] }, {});
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "warn");
    assert.match(checks[0]!.label, /no extensions declared/);
    assert.match(checks[0]!.label, /pi-cache-optimizer/);
  });

  it("fail: surfaces resolveExtensions validation errors as their own rows", () => {
    const checks = reconcileExtensions(
      { extensions: [], errors: ['extensions[0] (foo): version must be exact, got "^1.0.0"'] },
      {},
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "fail");
    assert.match(checks[0]!.label, /version must be exact/);
  });

  it("integration: a floating version rejected by resolveExtensions flows through as a fail row", () => {
    const resolution = resolveExtensions([{ name: "pi-hashline-edit", version: "^0.8.3" }]);
    const checks = reconcileExtensions(resolution, {});
    assert.ok(
      checks.some((c) => c.status === "fail" && /version must be exact/.test(c.label)),
      "expected the rejected declaration to appear as a fail row",
    );
  });

  it("handles a mix: one ok, one version mismatch, one missing, one undeclared", () => {
    const checks = reconcileExtensions(
      {
        extensions: [
          ext("pi-cache-optimizer", "2.8.6"),
          ext("pi-hashline-edit", "0.8.3"),
          ext("pi-missing", "1.0.0"),
        ],
        errors: [],
      },
      { "pi-cache-optimizer": "2.8.6", "pi-hashline-edit": "0.8.4", "@tintinweb/pi-subagents": "0.19.0" },
    );
    const byStatus = (s: "ok" | "warn" | "fail") => checks.filter((c) => c.status === s);
    assert.equal(byStatus("ok").length, 1);
    assert.equal(byStatus("fail").length, 2); // version mismatch + not installed
    assert.equal(byStatus("warn").length, 1); // pi-subagents installed but undeclared
  });
});

describe("formatProviderMatrixRow (T36.4)", () => {
  it("separates reachable from priced, and redacts a planted token", () => {
    const planted = "sk-ant-api03-abcdefghijklmnopqrstuvPLANTED";
    const check = formatProviderMatrixRow({
      name: "openrouter",
      auth: "api_key",
      reach: "reachable",
      reachReason: `OPENROUTER_API_KEY present (${planted})`,
      priced: false,
      priceNote: "UNPRICED → excluded from cost claims",
    });
    assert.equal(check.status, "ok");
    assert.match(check.label, /provider openrouter:/);
    assert.match(check.label, /reachable/);
    assert.match(check.label, /UNPRICED/);
    assert.equal(check.label.includes(planted), false);
    assert.equal(check.label.includes("sk-ant-"), false);
  });

  it("does not warn on oauth_subscription when reach is unknown", () => {
    const check = formatProviderMatrixRow({
      name: "anthropic",
      auth: "oauth_subscription",
      reach: "unknown",
      reachReason: "1 credential(s) in the Lykos store (contents not inspected)",
      priced: true,
      priceNote: "priced (rates and cache semantics verified in prices.yaml)",
      overflowBilling: "unset",
    });
    assert.equal(check.status, "ok");
    assert.match(check.label, /reach unknown/);
    assert.match(check.label, /overflow billing unset/);
  });
});

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(payload)}.signature`;
}

describe("checkCredentialPools (D3 / D7.2)", () => {
  it("warns on empty or absent store", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-doc-absent-"));
    const dbPath = join(dir, "empty.db");
    const checks = checkCredentialPools({}, dbPath);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "warn");
    assert.match(checks[0]!.label, /no credentials in the Lykos store/);
  });

  it("reports pool counts for seeded store and never prints secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-doc-seeded-"));
    const dbPath = join(dir, "creds.db");
    const db = openCredentialDb(dbPath, { create: true })!;

    const secretOAuth = "oauth-secret-token-DO-NOT-PRINT";
    const secretApiKey = "sk-test-DO-NOT-PRINT";

    // 1 OAuth row
    upsertCredential(db, "google-antigravity", {
      type: "oauth",
      access: jwt({ email: "user@example.com", token: secretOAuth }),
      refresh: "ref-tok",
      expires: Date.now() + 3_600_000,
    });

    // 1 api_key literal row
    const row2 = upsertCredential(db, "anthropic", {
      type: "api_key",
      key: secretApiKey,
    });

    // 1 cooling row
    const row3 = upsertCredential(db, "anthropic", {
      type: "api_key",
      key: "env:ANTHROPIC_KEY_2",
    });
    upsertCooldown(db, row3.row.id, Date.now() + 60_000, { reason: "usage_limit" });

    // 1 disabled row
    const row4 = upsertCredential(db, "anthropic", {
      type: "api_key",
      key: "env:ANTHROPIC_KEY_3",
    });
    disableCredential(db, row4.row.id, "revoked_by_user");

    db.close();

    const checks = checkCredentialPools({}, dbPath);
    // google-antigravity has 1 usable, 0 cooling, 0 disabled -> status ok
    const gCheck = checks.find((c) => c.label.includes("google-antigravity"))!;
    assert.ok(gCheck);
    assert.equal(gCheck.status, "ok");
    assert.match(gCheck.label, /1 usable, 0 cooling, 0 disabled/);

    // anthropic has 2 enabled (1 cooling, 1 uncooled), 1 disabled -> 2 usable, 1 cooling, 1 disabled -> status ok (2 - 1 = 1 > 0)
    const aCheck = checks.find((c) => c.label.includes("anthropic"))!;
    assert.ok(aCheck);
    assert.equal(aCheck.status, "ok");
    assert.match(aCheck.label, /2 usable, 1 cooling, 1 disabled/);

    // Verify secrets are NOT in any label
    const combined = checks.map((c) => c.label).join(" ");
    assert.equal(combined.includes(secretOAuth), false);
    assert.equal(combined.includes(secretApiKey), false);
    assert.equal(combined.includes("DO-NOT-PRINT"), false);
  });

  it("warns when enabled - cooling === 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-doc-cooling-"));
    const dbPath = join(dir, "creds.db");
    const db = openCredentialDb(dbPath, { create: true })!;
    const row = upsertCredential(db, "deepseek", {
      type: "api_key",
      key: "env:DEEPSEEK_KEY",
    });
    upsertCooldown(db, row.row.id, Date.now() + 60_000, { reason: "auth_401" });
    db.close();

    const checks = checkCredentialPools({}, dbPath);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "warn");
    assert.match(checks[0]!.label, /1 usable, 1 cooling, 0 disabled/);
  });
});

describe("T188 checkPruneExtension", () => {
  const on = { supersede_reads: true, drop_useless: true };
  it("warns when a rule is on and the resolved list has no lykos-prune", () => {
    const check = checkPruneExtension(on, [{ name: "lykos-self-compact" }]);
    assert.equal(check.status, "warn");
    assert.match(check.label, /lykos-prune/);
  });
  it("is ok when it is listed, and says so when both rules are off", () => {
    assert.equal(checkPruneExtension(on, [{ name: "lykos-prune" }]).status, "ok");
    assert.equal(checkPruneExtension({ supersede_reads: false, drop_useless: false }, []).status, "ok");
  });
});

describe("T99/T100 checkFeedbackLoop", () => {
  const discover = { postEdit: () => "npm run typecheck", gate: () => "npm test" };

  it("reports both commands when the project has them", () => {
    const checks = checkFeedbackLoop(
      "/repo",
      { enabled: true, command: "" },
      { enabled: true, command: "" },
      discover,
    );
    assert.equal(checks.every((c) => c.status === "ok"), true);
    assert.match(checks[0]!.label, /after every successful edit/);
    assert.match(checks[1]!.label, /once per editing session/);
  });

  it("prefers a configured command over the discovered one", () => {
    const checks = checkFeedbackLoop(
      "/repo",
      { enabled: true, command: "make check" },
      { enabled: true, command: "make test" },
      discover,
    );
    assert.match(checks[0]!.label, /make check/);
    assert.match(checks[1]!.label, /make test/);
  });

  it("calls a project with no discoverable command ok, not broken", () => {
    const checks = checkFeedbackLoop(
      "/repo",
      { enabled: true, command: "" },
      { enabled: true, command: "" },
      { postEdit: () => undefined, gate: () => undefined },
    );
    assert.equal(checks.every((c) => c.status === "ok"), true);
    assert.match(checks[1]!.label, /records outcome_source=human/);
  });

  it("warns when either mechanism has been switched off", () => {
    const checks = checkFeedbackLoop(
      "/repo",
      { enabled: false, command: "" },
      { enabled: false, command: "" },
      discover,
    );
    assert.equal(checks.every((c) => c.status === "warn"), true);
  });
});

describe("T102 checkSkills", () => {
  it("lists the skills, and says how to get them when there are none", () => {
    assert.match(checkSkills([]).label, /lykos init/);
    assert.match(checkSkills(["a.md", "b.md"]).label, /2 skill\(s\) in \.lykos\/skills\/: a\.md, b\.md/);
  });
});

describe("P14 ticket 08 D4/D6.6: the pi host, and packages left under ~/.pi/agent", () => {
  it("states the pi-host directory and says nothing more when the home has no ~/.pi/agent packages", () => {
    const root = mkdtempSync(join(tmpdir(), "lykos-doctor-pihost-"));
    try {
      const pihost = join(root, "pi-host");
      const home = join(root, "home");
      mkdirSync(home);
      const checks = checkPiHost({ LYKOS_PI_HOST_DIR: pihost }, home);
      assert.equal(checks.length, 1);
      assert.equal(checks[0]!.status, "ok");
      assert.match(checks[0]!.label, /^pi host: /);
      assert.ok(checks[0]!.label.includes(pihost), checks[0]!.label);
      // An empty legacy directory is still nothing to warn about.
      mkdirSync(join(home, ".pi", "agent", "npm", "node_modules"), { recursive: true });
      assert.equal(checkPiHost({ LYKOS_PI_HOST_DIR: pihost }, home).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns once, by name only, that packages under ~/.pi/agent are no longer loaded, and how to install under the pi host", () => {
    const root = mkdtempSync(join(tmpdir(), "lykos-doctor-legacy-"));
    try {
      const pihost = join(root, "pi-host");
      const home = join(root, "home");
      const nm = join(home, ".pi", "agent", "npm", "node_modules");
      mkdirSync(join(nm, "@tintinweb", "pi-subagents"), { recursive: true });
      // Presence only: a package whose manifest cannot be parsed is still just a name.
      writeFileSync(join(nm, "@tintinweb", "pi-subagents", "package.json"), "{ not json");
      const checks = checkPiHost({ LYKOS_PI_HOST_DIR: pihost }, home);
      const warns = checks.filter((c) => c.status === "warn");
      assert.equal(warns.length, 1);
      const label = warns[0]!.label;
      assert.match(label, /NO LONGER LOADED/);
      assert.ok(label.includes("@tintinweb/pi-subagents"), label);
      assert.ok(label.includes(nm), label);
      assert.ok(label.includes(`npm install --prefix ${join(pihost, "npm")}`), label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reconciles declared extensions against the pi host and names the install command for it", () => {
    const pihost = join(tmpdir(), "lykos-doctor-reconcile-pihost");
    const checks = reconcileHostExtensions({ extensions: [ext("pi-cache-optimizer", "1.2.3")] }, pihost, () => false);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "warn");
    assert.ok(checks[0]!.label.includes(pihost), checks[0]!.label);
    assert.ok(checks[0]!.label.includes(`npm install --prefix ${join(pihost, "npm")}`), checks[0]!.label);
    assert.ok(checks[0]!.label.includes("pi-cache-optimizer@1.2.3"), checks[0]!.label);
  });

  it("the retry check reads the pi host's settings.json, and the generated one keeps Pi's defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "lykos-doctor-retry-"));
    try {
      const pihost = join(root, "pi-host");
      mkdirSync(pihost);
      writeFileSync(join(pihost, "settings.json"), "{}\n");
      const ok = checkRetryPolicy({ LYKOS_PI_HOST_DIR: pihost, PI_CODING_AGENT_DIR: join(root, "elsewhere") });
      assert.equal(ok.status, "ok");
      writeFileSync(join(pihost, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
      const off = checkRetryPolicy({ LYKOS_PI_HOST_DIR: pihost });
      assert.equal(off.status, "warn");
      assert.ok(off.label.includes(join(pihost, "settings.json")), off.label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("checkGit (T170)", () => {
  it("passes with the installed version and fails, in words, when git is not on PATH", () => {
    const ok = checkGit(gitVersion());
    assert.equal(ok.status, "ok");
    assert.match(ok.label, /git version/);

    const empty = mkdtempSync(join(tmpdir(), "lykos-doctor-nogit-"));
    const saved = process.env.PATH;
    process.env.PATH = empty;
    try {
      const missing = checkGit(gitVersion());
      assert.equal(missing.status, "fail");
      assert.match(missing.label, /git is not installed/);
    } finally {
      process.env.PATH = saved;
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("T178 container runtime check (spec #22 story 62)", () => {
  const ok = { available: true as const, version: "6.1.3" };

  it("reports the runtime, its version and a pass for the limited container", () => {
    const lines = checkContainerRuntime([{ name: "podman", probe: ok, limited: { status: "ok" } }], { platform: "linux", level: "auto" });
    assert.deepEqual(lines.map((l) => l.status), ["ok", "ok"]);
    assert.match(lines[0]!.label, /podman 6\.1\.3/);
    assert.match(lines[1]!.label, /started a container with memory and cpu limits/);
  });

  it("with neither runtime, says auto falls back to uncontained and required refuses", () => {
    const lines = checkContainerRuntime(
      [
        { name: "podman", probe: { available: false, reason: "spawn podman ENOENT" } },
        { name: "docker", probe: { available: false, reason: "Cannot connect to the Docker daemon" } },
      ],
      { platform: "linux", level: "auto" },
    );
    const text = lines.map((l) => l.label).join("\n");
    assert.match(text, /podman: spawn podman ENOENT/);
    assert.match(text, /docker: Cannot connect to the Docker daemon/);
    assert.match(text, /`auto` falls back to running commands on this machine/);
    assert.match(text, /`required` refuses to start/);
    assert.ok(lines.every((l) => l.status !== "fail"), "no runtime is a warning while the level can fall back");
  });

  it("is a failure when the configured level is required and no runtime answers", () => {
    const lines = checkContainerRuntime([{ name: "docker", probe: { available: false, reason: "down" } }], { platform: "linux", level: "required" });
    assert.ok(lines.some((l) => l.status === "fail"));
  });

  it("on Windows, a rootless Podman machine that cannot start the limited container gets the cause and the fix", () => {
    const lines = checkContainerRuntime(
      [
        {
          name: "podman",
          probe: ok,
          limited: { status: "failed", reason: "crun: opening file `memory.max`: controller `pids` is not available" },
          podmanHost: { rootless: true, cgroupManager: "systemd" },
        },
      ],
      { platform: "win32", level: "auto" },
    );
    const fail = lines.find((l) => l.status === "fail")!;
    assert.match(fail.label, /controller `pids` is not available/);
    assert.match(fail.label, /rootless/);
    assert.match(fail.label, /systemd/);
    assert.match(fail.label, /podman machine set --rootful/);
    assert.match(fail.label, /cgroup_manager = "cgroupfs"/);
    assert.match(fail.label, /podman#29749/);
    assert.match(fail.label, /microsoft\/WSL#41492/);
  });

  it("names only the cause that applies: a rootful machine on systemd needs just the drop-in", () => {
    const [, fail] = checkContainerRuntime(
      [{ name: "podman", probe: ok, limited: { status: "failed", reason: "x" }, podmanHost: { rootless: false, cgroupManager: "systemd" } }],
      { platform: "win32", level: "auto" },
    );
    assert.doesNotMatch(fail!.label, /rootless/);
    assert.doesNotMatch(fail!.label, /set --rootful/);
    assert.match(fail!.label, /cgroup_manager = "cgroupfs"/);
  });

  it("prints no WSL fix off Windows or for Docker", () => {
    for (const [platform, name] of [["linux", "podman"], ["win32", "docker"]] as const) {
      const [, fail] = checkContainerRuntime(
        [{ name, probe: ok, limited: { status: "failed", reason: "boom" }, podmanHost: { rootless: true, cgroupManager: "systemd" } }],
        { platform, level: "auto" },
      );
      assert.match(fail!.label, /boom/);
      assert.doesNotMatch(fail!.label, /cgroupfs/);
    }
  });

  it("an untested limited start (no local image) is a warning, not a pass", () => {
    const [, line] = checkContainerRuntime(
      [{ name: "docker", probe: ok, limited: { status: "untested", reason: "no local image" } }],
      { platform: "linux", level: "auto" },
    );
    assert.equal(line!.status, "warn");
  });

  it("probes only the first runtime that answers, with the stubbed driver's output", async () => {
    const calls: string[] = [];
    const stub = (name: "podman" | "docker", up: boolean): ContainerRuntimeDriver =>
      ({
        name,
        probe: async () => (up ? { available: true, version: "9.9" } : { available: false, reason: `${name} down` }),
        limitedStart: async (image: string) => {
          calls.push(`${name}:${image}`);
          return { status: "failed", reason: "pids" } as const;
        },
        hostInfo: async () => ({ rootless: true, cgroupManager: "systemd" }),
      }) as unknown as ContainerRuntimeDriver;
    const reports = await probeContainerRuntimes([stub("podman", false), stub("docker", true)], "img:1");
    assert.deepEqual(calls, ["docker:img:1"]);
    assert.equal(reports[0]!.limited, undefined);
    assert.deepEqual(reports[1]!.limited, { status: "failed", reason: "pids" });
    assert.deepEqual(reports[1]!.podmanHost, undefined, "host info is read for Podman only");
  });

  it("flags the known-bad WSL Podman machine from what Podman reports, even when no image let it try a start", () => {
    const [, line] = checkContainerRuntime(
      [{ name: "podman", probe: ok, limited: { status: "untested", reason: "no image" }, podmanHost: { rootless: true, cgroupManager: "systemd" } }],
      { platform: "win32", level: "auto" },
    );
    assert.equal(line!.status, "fail");
    assert.match(line!.label, /podman machine set --rootful/);
  });

  it("does not blame cgroups for a failure that is not a cgroup error", () => {
    const [, line] = checkContainerRuntime(
      [{ name: "podman", probe: ok, limited: { status: "failed", reason: "executable file not found in $PATH" }, podmanHost: { rootless: false, cgroupManager: "cgroupfs" } }],
      { platform: "win32", level: "auto" },
    );
    assert.equal(line!.status, "fail");
    assert.match(line!.label, /executable file not found/);
    assert.doesNotMatch(line!.label, /cgroupfs"|rootful/);
  });

  it("reports an invalid containment.runtime as a failing check instead of throwing", async () => {
    const result = await probeConfiguredRuntimes({ runtime: "lxc" as never }, "img:1");
    const lines = checkContainerRuntime(result, { platform: "linux", level: "auto" });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.status, "fail");
    assert.match(lines[0]!.label, /containment.runtime must be auto, docker or podman/);
  });

  it("prints each fix step as one line a PowerShell 5.1 or Git Bash user can paste", () => {
    const [, fail] = checkContainerRuntime(
      [{ name: "podman", probe: ok, limited: { status: "failed", reason: "x" }, podmanHost: { rootless: true, cgroupManager: "systemd" } }],
      { platform: "win32", level: "auto" },
    );
    const steps = fail!.label.split("\n").filter((l) => l.startsWith("      "));
    assert.deepEqual(steps, [
      "      podman machine stop",
      "      podman machine set --rootful",
      "      podman machine start",
      '      podman machine ssh "sudo mkdir -p /etc/containers/containers.conf.d"',
      String.raw`      podman machine ssh "printf '[engine]\ncgroup_manager = \042cgroupfs\042\n' | sudo tee /etc/containers/containers.conf.d/50-cgroupfs.conf"`,
      "      podman machine stop",
      "      podman machine start",
    ]);
    assert.ok(steps.every((l) => !l.includes("&&")), "PowerShell 5.1 has no &&");
  });
});

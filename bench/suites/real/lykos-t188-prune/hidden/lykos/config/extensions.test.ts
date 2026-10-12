import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DELEGATE_EXTENSION_ROOT,
  decodeExtensionEnv,
  delegateExtensionPath,
  encodeExtensionEnv,
  withoutHashlineEdit,
  HASHLINE_EDIT_EXTENSION,
  extensionSetKey,
  extensionSetLabel,
  EXTENSIONS_ENV,
  hop0Extensions,
  isExactVersion,
  isPackageName,
  resolveExtensions,
  encodeSpecialistOffLimitsEnv,
  decodeSpecialistOffLimitsEnv,
  SPECIALIST_NAME_ENV,
  SPECIALIST_OFF_LIMITS_ENV,
  REGISTRY_OFF_TOOLS_ENV,
  encodeRegistryOffToolsEnv,
  decodeRegistryOffToolsEnv,
  DEFAULT_REGISTRY_OFF_TOOLS,
} from "./extensions.js";
import { REGISTRY_OFF_TOOLS } from "../tools/tool-surface.js";
import { SHIPPED_DEFAULTS } from "./defaults.js";
import { loadConfig } from "./load.js";
import { defaultExtensionVersion } from "../extensions/defaults/index.js";

function repoFile(...parts: string[]): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", ...parts);
}

const CACHE_OPTIMIZER = { name: "pi-cache-optimizer", version: "2.8.6", scope: ["hop0"] };

describe("resolveExtensions — validation (06-extension-policy bar 5)", () => {
  it("resolves a well-formed declaration to a container path and hop-0 scope", () => {
    const { extensions, errors } = resolveExtensions([CACHE_OPTIMIZER]);
    assert.deepEqual(errors, []);
    assert.equal(extensions.length, 1);
    assert.equal(extensions[0]?.name, "pi-cache-optimizer");
    assert.equal(extensions[0]?.path, `${DELEGATE_EXTENSION_ROOT}/pi-cache-optimizer`);
    assert.equal(extensions[0]?.hop0, true);
  });

  it("defaults the scope to hop0 when it is omitted", () => {
    const { extensions } = resolveExtensions([{ name: "pi-hashline-edit", version: "0.8.3" }]);
    assert.deepEqual(extensions[0]?.scope, ["hop0"]);
    assert.equal(extensions[0]?.hop0, true);
  });

  it("rejects a floating version rather than resolving it — that is the whole point of the pin", () => {
    for (const version of ["^0.8.3", "~0.8.3", "0.8.x", "latest", ">=0.8.0", "0.8", ""]) {
      const { extensions, errors } = resolveExtensions([{ name: "pi-hashline-edit", version }]);
      assert.deepEqual(extensions, [], `accepted a floating version: ${version}`);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /must be exact/);
    }
  });

  it("accepts an exact version with a prerelease or build tail", () => {
    assert.equal(isExactVersion("1.2.3"), true);
    assert.equal(isExactVersion("1.2.3-rc.1"), true);
    assert.equal(isExactVersion("1.2.3+build.7"), true);
    assert.equal(isExactVersion("1.2"), false);
  });

  it("rejects a name that could climb out of node_modules", () => {
    for (const name of ["../evil", "a/b/c", "pi-x; rm -rf /", "..", "@scope/../x"]) {
      assert.equal(isPackageName(name), false, `accepted ${name}`);
      const { extensions, errors } = resolveExtensions([{ name, version: "1.0.0" }]);
      assert.deepEqual(extensions, []);
      assert.equal(errors.length, 1);
    }
    assert.equal(isPackageName("@tintinweb/pi-subagents"), true);
  });

  it("rejects a duplicate name — load order would be ambiguous", () => {
    const { extensions, errors } = resolveExtensions([CACHE_OPTIMIZER, { ...CACHE_OPTIMIZER, version: "2.8.7" }]);
    assert.equal(extensions.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /more than once/);
  });

  it("collects rejections instead of throwing, and keeps the valid entries", () => {
    const { extensions, errors } = resolveExtensions([
      CACHE_OPTIMIZER,
      { name: "bad", version: "^1.0.0" },
      { name: "pi-hashline-edit", version: "0.8.3" },
    ]);
    assert.deepEqual(
      extensions.map((e) => e.name),
      ["pi-cache-optimizer", "pi-hashline-edit"],
    );
    assert.equal(errors.length, 1);
  });

  it("treats an absent block as no extensions, and a non-list as one error", () => {
    assert.deepEqual(resolveExtensions(undefined), { extensions: [], errors: [] });
    assert.deepEqual(resolveExtensions(null), { extensions: [], errors: [] });
    assert.equal(resolveExtensions({ name: "x" }).errors.length, 1);
  });
});

describe("resolveExtensions — order is load order", () => {
  it("preserves declaration order rather than sorting", () => {
    const { extensions } = resolveExtensions([
      { name: "b-ext", version: "1.0.0" },
      { name: "a-ext", version: "1.0.0" },
    ]);
    assert.deepEqual(
      extensions.map((e) => e.name),
      ["b-ext", "a-ext"],
    );
  });

  it("gives two orderings of the same members different set keys", () => {
    const one = resolveExtensions([{ name: "a-ext", version: "1.0.0" }, { name: "b-ext", version: "1.0.0" }]).extensions;
    const two = resolveExtensions([{ name: "b-ext", version: "1.0.0" }, { name: "a-ext", version: "1.0.0" }]).extensions;
    assert.notEqual(extensionSetKey(one), extensionSetKey(two));
  });

  it("hop0Extensions keeps only the hop-0 declarations, in order", () => {
    const { extensions } = resolveExtensions([
      { name: "a-ext", version: "1.0.0", scope: ["refactorer"] },
      { name: "b-ext", version: "1.0.0", scope: ["hop0"] },
    ]);
    assert.deepEqual(
      hop0Extensions(extensions).map((e) => e.name),
      ["b-ext"],
    );
  });
});

describe("extensionSetKey / label", () => {
  it("returns the literal `none` for an empty set, so the control group has a name", () => {
    assert.equal(extensionSetKey([]), "none");
    assert.equal(extensionSetLabel([]), "(none)");
  });

  it("is stable for the same set and changes when a version changes", () => {
    const a = resolveExtensions([CACHE_OPTIMIZER]).extensions;
    const b = resolveExtensions([CACHE_OPTIMIZER]).extensions;
    const c = resolveExtensions([{ ...CACHE_OPTIMIZER, version: "2.8.7" }]).extensions;
    assert.equal(extensionSetKey(a), extensionSetKey(b));
    assert.notEqual(extensionSetKey(a), extensionSetKey(c));
    assert.equal(extensionSetLabel(a), "pi-cache-optimizer@2.8.6");
  });
});

describe("the boundary — encode/decode across host → container", () => {
  it("round-trips a resolved set", () => {
    const { extensions } = resolveExtensions([CACHE_OPTIMIZER, { name: "pi-hashline-edit", version: "0.8.3" }]);
    const decoded = decodeExtensionEnv(encodeExtensionEnv(extensions));
    assert.deepEqual(decoded, [
      { name: "pi-cache-optimizer", version: "2.8.6", path: delegateExtensionPath("pi-cache-optimizer") },
      { name: "pi-hashline-edit", version: "0.8.3", path: delegateExtensionPath("pi-hashline-edit") },
    ]);
  });

  it("returns null on a malformed value rather than a half-parsed set", () => {
    assert.equal(decodeExtensionEnv(undefined), null);
    assert.equal(decodeExtensionEnv(""), null);
    assert.equal(decodeExtensionEnv("not json"), null);
    assert.equal(decodeExtensionEnv('{"name":"x"}'), null);
    assert.equal(decodeExtensionEnv('[{"name":"x"}]'), null);
  });
});

describe("specialist off-limits env helpers (D2)", () => {
  it("round-trips a list of off-limit tool names", () => {
    const tools = ["write", "edit", "bash"];
    const encoded = encodeSpecialistOffLimitsEnv(tools);
    assert.deepEqual(decodeSpecialistOffLimitsEnv(encoded), tools);
  });

  it("returns null on undefined, empty, or malformed input", () => {
    assert.equal(decodeSpecialistOffLimitsEnv(undefined), null);
    assert.equal(decodeSpecialistOffLimitsEnv(""), null);
    assert.equal(decodeSpecialistOffLimitsEnv("not-json"), null);
    assert.equal(decodeSpecialistOffLimitsEnv('{"tool":"write"}'), null);
    assert.equal(decodeSpecialistOffLimitsEnv("[123]"), null);
  });

  it("exports the agreed environment variable names", () => {
    assert.equal(SPECIALIST_NAME_ENV, "LYKOS_SPECIALIST_NAME");
    assert.equal(SPECIALIST_OFF_LIMITS_ENV, "LYKOS_SPECIALIST_OFF_LIMITS");
  });
});

describe("the two surfaces stay in lockstep with the image", () => {
  it("the shipped default declares pi-cache-optimizer at the Dockerfile's pinned version", () => {
    const dockerfile = readFileSync(repoFile("docker", "Dockerfile"), "utf8");
    const pinned = /^ARG PI_CACHE_OPTIMIZER_VERSION=(\S+)/m.exec(dockerfile)?.[1];
    assert.ok(pinned, "docker/Dockerfile no longer pins PI_CACHE_OPTIMIZER_VERSION");
    const declared = SHIPPED_DEFAULTS.extensions.find((e) => e.name === "pi-cache-optimizer");
    assert.ok(declared, "the shipped default no longer declares pi-cache-optimizer");
    assert.equal(
      declared.version,
      pinned,
      "the shipped declaration and the image's pin disagree — one of them is a lie",
    );
  });

  it("the container extension root matches where the Dockerfile installs packages", () => {
    const dockerfile = readFileSync(repoFile("docker", "Dockerfile"), "utf8");
    assert.ok(dockerfile.includes("ENV PI_CODING_AGENT_DIR=/home/node/.pi/agent"));
    assert.ok(dockerfile.includes('npm install --prefix "${PI_CODING_AGENT_DIR}/npm"'));
    assert.equal(DELEGATE_EXTENSION_ROOT, "/home/node/.pi/agent/npm/node_modules");
  });

  it("the worker patch reads the declared set instead of a hardcoded path", () => {
    const worker = readFileSync(repoFile("docker", "patches", "pi-delegate-mcp-0.1.0", "worker.js"), "latin1");
    assert.ok(
      worker.includes("additionalExtensionPaths: this.extensions.paths"),
      "worker.js no longer feeds additionalExtensionPaths from the declared set",
    );
    assert.ok(
      !worker.includes('join(AGENT_DIR, "npm", "node_modules", "pi-cache-optimizer")'),
      "the hardcoded pi-cache-optimizer path is back — T29 exists to remove it",
    );
    assert.ok(worker.includes(`process.env.${EXTENSIONS_ENV}`), "worker.js does not read the boundary env var");
  });

  it("the worker recomputes the path from its own AGENT_DIR rather than trusting the host's", () => {
    const worker = readFileSync(repoFile("docker", "patches", "pi-delegate-mcp-0.1.0", "worker.js"), "latin1");
    assert.ok(
      worker.includes('const path = join(agentDir, "npm", "node_modules", e.name);'),
      "the host declares WHAT to load, never WHERE on the container filesystem it lives",
    );
  });

  it("sandbox-run.mjs is the host side of the same boundary", () => {
    const sandbox = readFileSync(repoFile("docker", "sandbox-run.mjs"), "utf8");
    assert.ok(sandbox.includes(EXTENSIONS_ENV), "sandbox-run.mjs no longer passes the resolved set across");
    assert.ok(sandbox.includes("resolveExtensions"), "sandbox-run.mjs no longer validates declarations on the host");
  });
});

describe("config layer", () => {
  it("ships pi-cache-optimizer, lykos-continuation, lykos-self-compact and lykos-prune as the default declarations, not special cases", () => {
    const { resolved } = loadConfig({ cwd: repoFile("does", "not", "exist"), globalDir: repoFile("nope"), env: {} });
    // Declaration ORDER is load order, and the cache optimizer mutates the
    // prompt, so it stays first. T148: the repo map, the first default
    // extension, is declared the same way and appends last.
    // T150: lykos-continuation never touches the prompt, so its place is free.
    // T151: nor does lykos-self-compact; its guidance rides the message stream.
    // T158 (ADR-0028): lykos-repo-map ships off — listed by a project, not here.
    // T168 (ADR-0031): pi-hashline-edit is no longer shipped; there is one editor.
    assert.deepEqual(
      resolved.extensions.map((e) => e.name),
      ["pi-cache-optimizer", "lykos-continuation", "lykos-self-compact", "lykos-prune"],
    );
  });

  it("T168: boot drops a declared pi-hashline-edit and says so in one line naming ADR-0031", () => {
    const { extensions } = resolveExtensions([
      CACHE_OPTIMIZER,
      { name: HASHLINE_EDIT_EXTENSION, version: "0.8.3" },
    ]);
    const r = withoutHashlineEdit(extensions);
    assert.deepEqual(
      r.extensions.map((e) => e.name),
      ["pi-cache-optimizer"],
      "it registers its own read and edit, which would shadow Lykos's two",
    );
    assert.match(r.notice ?? "", /^lykos: pi-hashline-edit was not loaded: .*\(ADR-0031\)\./);
    assert.equal((r.notice ?? "").includes("\n"), false, "one line");
  });

  it("T168: a list without it is returned as it was, with no notice", () => {
    const { extensions } = resolveExtensions([CACHE_OPTIMIZER]);
    const r = withoutHashlineEdit(extensions);
    assert.deepEqual(r.extensions, extensions);
    assert.equal(r.notice, undefined);
  });

  it("T168: the filter is applied at boot, not in the file: config still reads what the human wrote", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-t168-"));
    mkdirSync(join(dir, ".lykos"), { recursive: true });
    writeFileSync(
      join(dir, ".lykos", "config.yaml"),
      "extensions:\n  - { name: pi-cache-optimizer, version: 2.8.6 }\n  - { name: pi-hashline-edit, version: 0.8.3 }\n",
    );
    const { resolved } = loadConfig({ cwd: dir, globalDir: repoFile("nope"), env: {} });
    assert.ok(resolved.extensions.some((e) => e.name === HASHLINE_EDIT_EXTENSION));
  });

  it("a layer REPLACES the list rather than merging into it", () => {
    const { resolved } = loadConfig({
      cwd: repoFile("does", "not", "exist"),
      globalDir: repoFile("nope"),
      env: {},
      flags: { extensions: [] },
    });
    assert.deepEqual(resolved.extensions, [], "`extensions: []` must mean load none, with no residue");
  });
});

describe("registry off tools env encoding / decoding", () => {
  it("round-trips tool name lists", () => {
    const tools = ["subagent_workflow", "eval"];
    const encoded = encodeRegistryOffToolsEnv(tools);
    assert.deepEqual(decodeRegistryOffToolsEnv(encoded), tools);
  });

  it("returns null for absent, empty, or invalid env values", () => {
    assert.equal(decodeRegistryOffToolsEnv(undefined), null);
    assert.equal(decodeRegistryOffToolsEnv(""), null);
    assert.equal(decodeRegistryOffToolsEnv("not json"), null);
  });

  it("DEFAULT_REGISTRY_OFF_TOOLS is the registry off set, not a second list", () => {
    assert.deepEqual([...DEFAULT_REGISTRY_OFF_TOOLS], [...REGISTRY_OFF_TOOLS]);
  });
});

describe("a default extension may omit its version (the build shipped with this Lykos)", () => {
  it("resolves an omitted version to Lykos's own, and only for a default extension", () => {
    const r = resolveExtensions([{ name: "lykos-repo-map" }, { name: "pi-cache-optimizer" }]);
    assert.deepEqual(
      r.extensions.map((e) => [e.name, e.version]),
      [["lykos-repo-map", defaultExtensionVersion()]],
    );
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0]!, /pi-cache-optimizer\): version must be exact, got "undefined"/);
  });

  it("the scaffolded config keeps the shipped defaults loaded, and the repo map off", async () => {
    const { parse } = await import("yaml");
    const { CONFIG_YAML } = await import("./scaffold.js");
    const names = resolveExtensions((parse(CONFIG_YAML) as { extensions: unknown }).extensions).extensions.map((e) => e.name);
    assert.deepEqual(names, ["pi-cache-optimizer", "lykos-continuation", "lykos-self-compact", "lykos-prune"]);
  });
});

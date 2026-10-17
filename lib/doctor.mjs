// delegate.sh doctor [<repo>]: everything agent-box needs, checked in order, each with the fix.
// Exit 0 when nothing failed (warnings allowed), 1 otherwise. Inputs come from delegate.sh as env:
//   AB_BASH (bash version), AB_ENGINE, AB_IMAGE, AB_BASE_IMAGE, AB_BOX, AB_PROJECT_ENV, AB_REPO,
//   OMNIROUTE_API_KEY, OMNIROUTE_HOST_URL, OMNIROUTE_BASE_URL, AB_HOST_IP, AB_NETWORK, AB_SLOTS, AB_MEMORY
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const env = process.env;
let failed = 0, warned = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m, fix) => { warned++; console.log(`  warn  ${m}${fix ? `\n        fix: ${fix}` : ""}`); };
const fail = (m, fix) => { failed++; console.log(`  FAIL  ${m}${fix ? `\n        fix: ${fix}` : ""}`); };
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 30000, env: { ...env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" } });
  return { code: r.status ?? (r.error ? 127 : 1), out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};
const has = (cmd) => sh(cmd, ["--version"]).code === 0;

console.log("host");
const bv = Number(String(env.AB_BASH ?? "").split(".")[0]);
if (bv >= 4) ok(`bash ${env.AB_BASH}`);
else fail(`bash ${env.AB_BASH || "?"}: delegate.sh needs bash 4 or newer (associative arrays, mapfile)`,
  os.platform() === "darwin" ? "brew install bash, and put it first on PATH" : "install bash 4+");
const nv = Number(process.versions.node.split(".")[0]);
nv >= 20 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node}: needs 20 or newer`, "install Node.js 20+");
for (const [c, why] of [["git", "repos go in and out as bundles"], ["jq", "summaries and herdr"], ["curl", "OmniRoute checks"]])
  has(c) ? ok(c) : fail(`${c} not found (${why})`, `install ${c}`);
fs.existsSync(`${env.AB_BOX}/node_modules/yaml`) ? ok("node modules") : fail("node_modules missing", `cd ${env.AB_BOX} && npm ci`);
has("gh") ? ok("gh (for issue: in task frontmatter)") : warn("gh not found: tasks with issue: cannot fetch their GitHub issue", "install the GitHub CLI and run gh auth login");

console.log(`engine (${env.AB_ENGINE})`);
const eng = env.AB_ENGINE;
if (!has(eng)) fail(`${eng} not found`, eng === "podman" ? "install Podman (podman.io) or set AGENT_BOX_ENGINE=docker" : "install Docker or set AGENT_BOX_ENGINE=podman");
else {
  const info = sh(eng, ["info", "--format", "json"], { timeout: 60000 });
  if (info.code !== 0) fail(`${eng} is not running: ${info.err.split("\n")[0]}`, eng === "podman" && os.platform() !== "linux" ? "podman machine start" : `start the ${eng} service`);
  else {
    ok(`${eng} answers`);
    let mem = 0;
    try { const j = JSON.parse(info.out); mem = Number(j.host?.memTotal ?? j.MemTotal ?? 0); } catch {}
    const per = String(env.AB_MEMORY || "8g"), slots = Number(env.AB_SLOTS || 4);
    const perB = Number(per.replace(/[gm]$/i, "")) * (/m$/i.test(per) ? 1 << 20 : 1 << 30);
    // MEMORY is each container's cap, not a reservation: warn only when one worker could not reach it.
    if (mem) (mem >= perB ? ok : warn)(`engine memory ${(mem / 2 ** 30).toFixed(1)} GiB; ${slots} slot(s), each capped at ${per}`,
      mem < perB ? "give the engine more memory, or lower MEMORY in the project file" : undefined);
    for (const img of [...new Set([env.AB_BASE_IMAGE, env.AB_IMAGE].filter(Boolean))])
      sh(eng, ["image", "inspect", img]).code === 0 ? ok(`image ${img}`) : fail(`image ${img} not built`, `delegate.sh build${img === env.AB_BASE_IMAGE ? "" : " <repo>"}`);
    const df = sh(eng, ["system", "df"]);
    if (df.code === 0) { const l = df.out.split("\n").find((x) => /^Images/.test(x)); if (l) ok(`engine storage: ${l.replace(/\s+/g, " ")}`); }
  }
}

console.log("project");
if (!env.AB_REPO) warn("no repo given: delegate.sh doctor <repo> also checks the project file, its key and the route to OmniRoute");
else {
  ok(`repo ${env.AB_REPO}`);
  env.AB_PROJECT_ENV && fs.existsSync(env.AB_PROJECT_ENV) ? ok(`project file ${env.AB_PROJECT_ENV}`) : fail("no project file", "delegate.sh setup <repo>");
  if (!env.OMNIROUTE_API_KEY) fail("OMNIROUTE_API_KEY is empty", `set it in ${env.AB_PROJECT_ENV}`);
  else {
    const r = sh("curl", ["-fsS", "-m", "10", "-o", os.devNull, "-w", "%{http_code}", "-H", `Authorization: Bearer ${env.OMNIROUTE_API_KEY}`, `${env.OMNIROUTE_HOST_URL}/models`]);
    r.code === 0 ? ok(`OmniRoute answers on the host (${env.OMNIROUTE_HOST_URL})`) : fail(`OmniRoute not reachable at ${env.OMNIROUTE_HOST_URL}: ${r.err || r.out}`, "start OmniRoute, or set OMNIROUTE_HOST_URL in the project file");
    if (r.code === 0 && env.AB_BASE_IMAGE && sh(eng, ["image", "inspect", env.AB_BASE_IMAGE]).code === 0) {
      // The same request from inside a container, over the route a worker uses.
      const args = ["run", "--rm", "--add-host", `host.docker.internal:${env.AB_HOST_IP}`, ...(env.AB_NETWORK ? ["--network", env.AB_NETWORK] : []),
        "-e", "OMNIROUTE_API_KEY", "--entrypoint", "sh", env.AB_BASE_IMAGE, "-c",
        `curl -fsS -m 10 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OMNIROUTE_API_KEY" '${env.OMNIROUTE_BASE_URL}/models'`];
      const c = sh(eng, args, { timeout: 90000 });
      c.code === 0 ? ok(`a container reaches OmniRoute (${env.OMNIROUTE_BASE_URL} via ${env.AB_HOST_IP})`)
        : fail(`a container cannot reach OmniRoute at ${env.OMNIROUTE_BASE_URL} (host address ${env.AB_HOST_IP}): ${(c.err || c.out).split("\n").pop()}`,
          os.platform() === "linux" ? "let OmniRoute listen on 0.0.0.0 (or the bridge address), or set AGENT_BOX_NETWORK=host and OMNIROUTE_BASE_URL=http://localhost:<port>/v1"
            : "set AGENT_BOX_HOST_IP to the address the engine's VM uses for the host");
    }
  }
}

console.log(failed ? `\n${failed} problem(s), ${warned} warning(s)` : `\nready${warned ? ` (${warned} warning(s))` : ""}`);
process.exit(failed ? 1 : 0);

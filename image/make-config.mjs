// Writes ~/.config/opencode/opencode.json for one run. Inputs are environment variables set by
// delegate.sh; the model list comes from /out/models.json when OmniRoute answered.
//
//   MODEL        OmniRoute model id for the primary agent
//   EFFORT       optional reasoning effort (low|medium|high) sent as reasoning_effort. OmniRoute drops it
//                for antigravity/claude-* (research/opencode-customization.md §5), so roles leave it empty there
//   REVIEW       1 = the `reviewer` agent (cannot edit the repo); otherwise the `worker` agent
//   SEALED       newline-separated repo globs the worker may not edit (bash writes are caught after the run)
//   SCOUT_MODEL  model for the read-only `scout` subagent; empty disables it
//   SKILLS_ALLOW comma-separated skill names the agent may load; empty = all. box-* are always allowed
//   ALLOW_WEB    1 = webfetch allowed
//   ASK          0 = no ask_orchestrator tool (the worker can still ask with BLOCKED)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = process.env;
const model = env.MODEL;
const review = env.REVIEW === "1";

let ids = [];
try { ids = (JSON.parse(fs.readFileSync("/out/models.json", "utf8")).data || []).map((m) => m.id); } catch {}
for (const m of [model, env.SCOUT_MODEL]) if (m && !ids.includes(m)) ids.push(m);
const models = Object.fromEntries(ids.map((id) => [id, { name: id }]));
if (env.EFFORT) models[model] = { name: model, options: { reasoningEffort: env.EFFORT } };

// OpenCode permission patterns: paths relative to the worktree, `*` also matches `/`, last match wins.
const toPattern = (glob) => glob.replace(/\*\*\/?/g, "*");
const sealed = (env.SEALED || "").split("\n").map((s) => s.trim()).filter(Boolean);
const edit = review ? { "*": "deny" } : Object.fromEntries([["*", "allow"], ...sealed.map((g) => [toPattern(g), "deny"])]);

const allow = (env.SKILLS_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean);
const skill = allow.length ? Object.fromEntries([["*", "deny"], ["box-*", "allow"], ...allow.map((s) => [s, "allow"])]) : { "*": "allow" };

const web = env.ALLOW_WEB === "1" ? "allow" : "deny";
const scout = env.SCOUT_MODEL;
const common = { webfetch: web, skill, task: scout ? { "*": "deny", scout: "allow" } : { "*": "deny" } };

const agent = {
  worker: {
    mode: "primary",
    description: "Implements the task in /work/repo and commits it",
    model: `omniroute/${model}`,
    permission: { ...common, edit },
    // Step budget from the task's `steps:`; past it OpenCode asks the model for its final answer.
    ...(Number(env.STEPS) > 0 ? { steps: Number(env.STEPS) } : {}),
  },
  reviewer: {
    mode: "primary",
    description: "Reviews the repository read-only; scratch files go under /tmp",
    model: `omniroute/${model}`,
    permission: { ...common, edit: { "*": "deny" } },
  },
};
if (scout) {
  agent.scout = {
    mode: "subagent",
    description:
      "Fast, cheap, read-only code search. Give it a precise question (where is X defined, who calls Y, which tests cover Z, what does doc D say about W); it returns file:line evidence. Use it instead of reading many files yourself.",
    model: `omniroute/${scout}`,
    steps: 30,
    permission: { edit: "deny", webfetch: "deny", task: "deny", skill: { "*": "deny" } },
    tools: { "orchestrator_*": false },
  };
}

const cfg = {
  $schema: "https://opencode.ai/config.json",
  autoupdate: false,
  share: "disabled",
  model: `omniroute/${model}`,
  default_agent: review ? "reviewer" : "worker",
  provider: {
    omniroute: {
      npm: "@ai-sdk/openai-compatible",
      name: "OmniRoute",
      options: { baseURL: "{env:OMNIROUTE_BASE_URL}", apiKey: "{env:OMNIROUTE_API_KEY}" },
      models,
    },
  },
  agent,
  permission: { webfetch: web },
};
// Mid-run questions to the orchestrator (ask-mcp.mjs). Workers only; ASK=0 turns it off.
if (!review && env.ASK !== "0") {
  cfg.mcp = { orchestrator: { type: "local", command: ["node", "/opt/agent-box/ask-mcp.mjs"], enabled: true } };
}

const dir = path.join(os.homedir(), ".config", "opencode");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(cfg, null, 2));
console.log(review ? "reviewer" : "worker");

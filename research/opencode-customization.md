# Customising headless OpenCode 1.19.0 workers behind OmniRoute

Researched 2026-10-12 against primary sources only:

- **OpenCode**: tag `v1.19.0` of `github.com/anomalyco/opencode` (`sst/opencode` now redirects to it), sparse checkout, commit `733b2c6`. Paths below are relative to that repo. The docs are the `.mdx` files under `packages/web/src/content/docs/` in the same tag. They are the source of opencode.ai/docs.
- **Local binary**: `opencode --version` returns 1.19.0, from the npm package `opencode-ai`, which ships a compiled `opencode.exe`. I read only its `--help` output. Nothing was configured and no prompt was sent.
- **OmniRoute**: `github.com/diegosouzapw/OmniRoute`, default branch `release/v3.8.52`, commit `7f3cbb0` (2026-10-11).
- **AI SDK**: `@ai-sdk/openai-compatible@2.0.41` is the version OpenCode 1.19.0 pins (`packages/opencode/package.json`). I read its `dist/index.mjs` from unpkg. OpenCode's patch to this package (`patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch`) only changes how stream errors are passed through.

Lines marked **UNVERIFIED** were not confirmed against source or by running anything.

---

## 1. Skills

**Yes. OpenCode supports SKILL.md skill folders natively.** Skills are loaded on demand through a built-in `skill` tool.

### Where skills are discovered

All of the following are scanned, in this order (`packages/opencode/src/skill/index.ts:173-232`):

1. **Global external folders**: `~/.claude/skills/**/SKILL.md` and `~/.agents/skills/**/SKILL.md` (`skill/index.ts:185-194`).
2. **Project external folders**: `.claude/skills/**/SKILL.md` and `.agents/skills/**/SKILL.md` in every directory from the cwd up to the git worktree root (`skill/index.ts:196-202`).
3. **Every OpenCode config directory**, using the pattern `{skill,skills}/**/SKILL.md`, so both the singular and plural folder names work (`skill/index.ts:24, 205-208`). The config directories are (`packages/opencode/src/config/paths.ts:23-41`):
   - `~/.config/opencode/`
   - every `.opencode/` folder from the cwd up to the worktree root
   - `~/.opencode/`
   - `$OPENCODE_CONFIG_DIR`
4. **Extra paths from config**: `skills.paths[]`, which may be relative or start with `~/`, and `skills.urls[]`, which are pulled from a URL (`skill/index.ts:210-227`; schema in `packages/core/src/v1/config/skills.ts`).

One more skill is always present: the built-in `customize-opencode` skill. It is registered first, so a skill on disk with the same name overrides it (`skill/index.ts:32-35, 274-284`).

**Environment switches** (`packages/opencode/src/effect/runtime-flags.ts:21,27-30`):

- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` stops OpenCode reading the `.claude` and `.agents` folders.
- `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`, or the broader `OPENCODE_DISABLE_CLAUDE_CODE=1`, stops it reading only the `.claude` folders.

### How skills are loaded

- The `skill` tool takes `{ name }`. It checks `permission.skill` against that name, then returns the SKILL.md body inside `<skill_content>`, plus the base directory and up to 10 sampled sibling files (`packages/opencode/src/tool/skill.ts:8-66`).
- The skill list is shown to the model as `<available_skills>` inside the tool description. Skills that resolve to `deny` for the agent are filtered out of that list (`skill/index.ts:309-314`).
- **Frontmatter.** The docs recognise `name` and `description` (both required), plus optional `license`, `compatibility` and `metadata` (`docs/skills.mdx`, "Write frontmatter").
  - The code only checks that `name` is a string (`skill/index.ts:53-59`).
  - A skill with no `description` loads, but it is left out of the list the model sees (`skill/index.ts:322-323`).
  - The docs require `name` to match `^[a-z0-9]+(-[a-z0-9]+)*$` and the directory name. I found no enforcement of either rule in `skill/index.ts`. **UNVERIFIED**: other code may enforce it.
  - If two skills share a name, the last one loaded wins and a warning is logged (`skill/index.ts:125-131`).

### Allowing or denying skills per agent

Two mechanisms work. `permission.skill` uses wildcard patterns, and the last matching rule wins. Setting `tools.skill: false` removes the skill tool entirely (`docs/skills.mdx`, "Configure permissions", "Override per agent", "Disable the skill tool").

```jsonc
// ~/.config/opencode/opencode.json
{
  "permission": { "skill": { "*": "allow", "internal-*": "deny" } },
  "agent": {
    "reviewer": { "permission": { "skill": { "*": "deny", "code-review": "allow" } } },
    "plain":    { "tools": { "skill": false } }
  }
}
```

**Evidence:** `packages/opencode/src/skill/index.ts:21-25,173-232,309-315`; `packages/opencode/src/tool/skill.ts:27-32`; https://opencode.ai/docs/skills (= `docs/skills.mdx`).

---

## 2. Agents

### Where agents are defined

- **In config**: the `agent` key of `opencode.json`.
- **As markdown files**: `{agent,agents}/**/*.md` inside every config directory listed in §1, that is `~/.config/opencode/agent(s)/`, `.opencode/agent(s)/` and `$OPENCODE_CONFIG_DIR/agent(s)/` (`packages/opencode/src/config/agent.ts:11-32`).
  - The agent's name is the file path relative to that folder.
  - The markdown body becomes `prompt`.
- **Legacy**: `{mode,modes}/*.md` files are also loaded, and are forced to `mode: primary` (`config/agent.ts:34-58`).

### Fields

From `packages/core/src/v1/config/agent.ts:12-41`:

| Field | Meaning |
| --- | --- |
| `model` | `"provider/model"` |
| `variant` | Default variant, applied only when the agent's own model is the one in use |
| `temperature`, `top_p` | Sampling |
| `prompt` | System prompt. Supports `{file:./path}` substitution (`config/variable.ts:33`) |
| `description` | When to use the agent |
| `mode` | `primary`, `subagent` or `all`. Default for a new agent: `all` (`agent/agent.ts:276`) |
| `hidden` | Hide from the menu |
| `color` | Display colour |
| `steps` | Maximum agentic iterations; `maxSteps` is the deprecated name |
| `options` | Provider options |
| `permission` | Permission rules |
| `disable` | Remove the agent |
| `tools` | **Deprecated.** `{tool: bool}`, converted to `permission` allow/deny. `write`, `edit` and `patch` all map to `permission.edit` (`agent.ts:68-77`) |

**Any key not in that list is moved into `options`** (`agent.ts:43-66`). Agent `options` are merged into provider options after the model's own options and before the variant (`packages/opencode/src/session/llm/request.ts:91`). So writing `reasoningEffort: high` at the top level of an agent's frontmatter is a valid per-agent effort setting.

### Selecting an agent headless

**Yes, for primary agents.** Use `opencode run --agent <name>` (`opencode run --help`).

- If the named agent is a `subagent`, or does not exist, `run` prints a warning and **falls back to the default agent** instead of failing (`packages/opencode/src/cli/cmd/run.ts:594-618`).
- Agents meant for headless runs should therefore use `mode: primary` or `all`.
- A different default can be set with `default_agent` in config (`agent/agent.ts:322-337`).
- To list agents: `opencode agent list`.

### Subagents on a different model

**Yes.** In the task tool:

- The subagent runs on its own `model` if it has one. Otherwise it inherits the parent's provider and model.
- The parent's `variant` is passed down only when the subagent has no model of its own (`packages/opencode/src/tool/task.ts:179-209`).
- A subagent with its own model also gets its own `variant`, because that model is "the agent's configured model" (`packages/opencode/src/session/prompt.ts:646-654`).
- `permission.task` controls which subagents an agent may call, using glob patterns (`docs/agents.mdx:603`).

```jsonc
{
  "default_agent": "worker",
  "agent": {
    "worker": {
      "mode": "primary",
      "model": "omniroute/antigravity/claude-sonnet-4-6",
      "prompt": "{file:./prompts/worker.md}",
      "permission": { "task": { "*": "deny", "scout": "allow" } }
    },
    "scout": {
      "mode": "subagent",
      "description": "Read-only codebase search",
      "model": "omniroute/deepseek/deepseek-chat",
      "steps": 15,
      "permission": { "edit": "deny", "bash": "deny" }
    }
  }
}
```

The same agent as a markdown file, `~/.config/opencode/agents/scout.md`:

```markdown
---
description: Read-only codebase search
mode: subagent
model: omniroute/deepseek/deepseek-chat
reasoningEffort: low        # unknown key -> options -> request body
permission:
  edit: deny
  bash: deny
---
You search the codebase and report file:line evidence. Never edit.
```

The built-in agents are `build` (primary, the default), `plan` (primary, cannot edit), and the subagents `general` and `explore` (`agent/agent.ts:141-217`).

**Evidence:** `packages/core/src/v1/config/agent.ts`; `packages/opencode/src/agent/agent.ts:268-292`; `packages/opencode/src/tool/task.ts:179-209`; `packages/opencode/src/cli/cmd/run.ts:594-618`; https://opencode.ai/docs/agents

---

## 3. Rules and instructions

What goes into the system prompt is decided in `packages/opencode/src/session/instruction.ts:60-169`.

**1. One global file.** OpenCode reads the first of these that exists:

- `~/.config/opencode/AGENTS.md`
- `~/.claude/CLAUDE.md`

The second is skipped when `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1` or `OPENCODE_DISABLE_CLAUDE_CODE=1` is set (`instruction.ts:60-63,115-120`).

**2. Project files.** OpenCode tries the names `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` (deprecated), in that order. It looks for each name from the cwd up to the worktree root.

- The first name that is found anywhere wins.
- **Every** match of that name along the path is included, for example both `pkg/AGENTS.md` and the root `AGENTS.md`.
- So `CLAUDE.md` is only a fallback: it is used when no `AGENTS.md` exists anywhere on the path (`instruction.ts:64-68,122-133`).
- Setting `OPENCODE_DISABLE_PROJECT_CONFIG=1` skips this step.

**3. The `instructions[]` array in config** (`instruction.ts:135-168`). Each entry can be:

- A relative glob, matched upward from the cwd to the worktree.
- An absolute path or `~/` path. Its basename is treated as a glob within its directory.
- An `http(s)://` URL, fetched with a 5 s timeout. A failure is silently ignored.
- When several config files are merged, their `instructions` arrays are **combined as a union**, not replaced (`config/config.ts:48-49`).

**4. Nested files when reading.** When a `read` tool call opens a file in a subdirectory, the nearest `AGENTS.md` or `CLAUDE.md` between that file and the project root is attached once per message (`instruction.ts:179-200`).

Each file is injected as `Instructions from: <path>\n<content>`. Global files come first, then project files, then `instructions[]` files, then URLs.

### Config file precedence

Later sources override earlier ones (`config/config.ts:264-540`):

1. The global `~/.config/opencode/{config.json, opencode.json, opencode.jsonc}`.
2. `$OPENCODE_CONFIG`.
3. Project `opencode.json[c]`, from the worktree root down to the cwd.
4. `.opencode/opencode.json[c]` and `$OPENCODE_CONFIG_DIR`.
5. `$OPENCODE_CONFIG_CONTENT`.
6. Remote org config, if an account is logged in.
7. Managed config.

**Container note.** For every config directory, OpenCode starts a background `npm install @opencode-ai/plugin` (`config/config.ts:449-468`). A container with no network will log a warning but keep running. **UNVERIFIED** at runtime.

```jsonc
{
  "instructions": [
    "~/.config/opencode/rules/worker-contract.md",
    "docs/agents/*.md",
    "https://raw.githubusercontent.com/org/repo/main/RULES.md"
  ]
}
```

**Evidence:** `packages/opencode/src/session/instruction.ts:60-169`; `packages/opencode/src/config/config.ts:264-540`; https://opencode.ai/docs/rules

---

## 4. Reasoning effort for an `@ai-sdk/openai-compatible` custom provider

There are three places to set it. All of them end up as the AI SDK provider option `reasoningEffort`, which `@ai-sdk/openai-compatible` sends as the **`reasoning_effort`** field of the Chat Completions request body.

### Where to set it, and the merge order

The options are merged in this order, and each later one overrides the earlier (`session/llm/request.ts:80-91`):

```
base -> provider.<id>.models.<m>.options -> agent.options -> variants[<selected variant>]
```

So the three places are:

- `provider.<id>.models.<m>.options` (always applied),
- the agent's `options` (or an unknown top-level agent key),
- `provider.<id>.models.<m>.variants`.

### How the merged options reach the request

- The merged options go under the provider-options key **= the provider id up to its first dot**, for example `omniroute` (`provider/transform.ts:1462-1478`).
- `@ai-sdk/openai-compatible` reads those options and maps `reasoningEffort` to `reasoning_effort` (`@ai-sdk/openai-compatible@2.0.41 dist/index.mjs:538`).
- **Every other key is copied unchanged into the request body.** Only the SDK's own option names are filtered out: `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema` and similar (`dist/index.mjs:528-537`).
- So `options.thinking = {type:"enabled", budget_tokens: 16000}` would reach OmniRoute verbatim as `thinking`.

### Variants and `--variant`

- **Automatic variants for a custom model exist only if the model sets `"reasoning": true`.** The default is `false` (`provider/provider.ts:1573`). With `false`, `ProviderTransform.variants()` returns `{}` (`provider/transform.ts:790-791`).
- With `reasoning: true` and `@ai-sdk/openai-compatible`, the automatic variants are `low`, `medium` and `high`. Each maps to `{reasoningEffort: <same>}`. Ids containing `deepseek-v4` also get `max` (`transform.ts:576, 994-1002`).
- **Variants you define in config are always merged in.** This is true even when `reasoning` is false. Setting `"disabled": true` on a variant removes it (`provider.ts:1619-1628`).
- **`opencode run --variant X`** looks up `model.variants[X]`. **An unknown variant name is silently ignored**: no error, and no effort is sent (`request.ts:80-83`; I found no validation in `cli/cmd/run.ts`).
- When no `--variant` is given, the agent's `variant` is used, but only if the agent's own model is the one in use and that variant exists (`session/prompt.ts:646-654`).
- `opencode run --thinking` only controls whether thinking blocks are printed. It does not change the request.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "omniroute": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OmniRoute",
      "options": { "baseURL": "http://omniroute:20128/v1", "apiKey": "{env:OMNIROUTE_API_KEY}" },
      "models": {
        "antigravity/claude-opus-4-6-thinking": {
          "name": "Opus 4.6 thinking (AG)",
          "reasoning": true,                           // enables auto low/medium/high variants
          "tool_call": true,
          "limit": { "context": 200000, "output": 16384 },
          "options": { "reasoningEffort": "high" },    // default, always sent as reasoning_effort
          "variants": {
            "max":  { "reasoningEffort": "xhigh" },    // custom variant: --variant max
            "none": { "reasoningEffort": "none" }
          }
        },
        "antigravity/claude-sonnet-4-6": { "reasoning": true, "tool_call": true }
      }
    }
  }
}
```

- `limit.context` above is illustrative. OmniRoute's own catalog lists `contextLength: 1048576` and `maxOutputTokens: 65536` for these ids, but its Antigravity Claude path caps output at 16 384 (see §5).
- `tool_call` defaults to true (`provider.ts:1575`).

**Evidence:** `packages/opencode/src/provider/provider.ts:1550-1628,1745-1764`; `packages/opencode/src/provider/transform.ts:576,790-1002,1421-1478`; `packages/opencode/src/session/llm/request.ts:80-91`; `@ai-sdk/openai-compatible@2.0.41/dist/index.mjs:322-332,424-426,528-539`; https://opencode.ai/docs/models (Variants)

---

## 5. OmniRoute: what `reasoning_effort` does on the Antigravity Claude models

**Short answer: for `antigravity/claude-*` ids, OmniRoute does not turn `reasoning_effort`, `thinking` or `reasoning` into a Claude thinking budget.** The code path, for an OpenAI-format request to the `antigravity` provider (format `antigravity`, `open-sse/config/providers/registry/antigravity/index.ts:10-14`), runs as follows:

1. **The translator computes a budget.** `openaiToAntigravityRequest` calls `openaiToCloudCodeGeminiRequest`. That function maps `reasoning_effort` to `generationConfig.thinkingConfig.thinkingBudget` (`open-sse/translator/request/openai-to-gemini.ts:271-298`):

   | `reasoning_effort` | Budget |
   | --- | --- |
   | `none` | 0 |
   | `low` | 1024 |
   | `medium` | the model's default, else 8192 |
   | `high`, `auto`, `max`, `xhigh` | 32768 |

   Every budget is capped per model. A `thinking: {type:"enabled", budget_tokens}` field is handled the same way (`openai-to-gemini.ts:299-327`).

2. **For Claude the output limit is reset.** When the model id contains `claude`, `maxOutputTokens` is set to `min(max_tokens, 16384)`, or 16384 if the client gave no limit (`openai-to-gemini.ts:64,890-897,924-926`).

3. **The output limit is bumped.** `wrapInCloudCodeEnvelope`, through `applyAntigravityGenerationDefaults`, raises `maxOutputTokens` to `budget + 1` when it is at or below the budget (`openai-to-gemini/helpers.ts:99-118`; `openai-to-gemini.ts:822`).

4. **The budget is then deleted.** For Claude models, `generationConfig.thinkingConfig` is removed: *"Claude models on Antigravity use their own native thinking — Gemini's thinkingConfig is not understood by the Cloud Code Claude endpoint and must be stripped"* (`openai-to-gemini.ts:946-953`).

5. **The executor strips the raw fields.** It removes `thinking`, `reasoning_effort`, `reasoning`, `enable_thinking` and `thinking_budget` from the top level of the request (`open-sse/executors/antigravity.ts:828-836`). For Claude it then applies a whitelist to the request (`antigravity.ts:415-455, 805-807`), and clamps `maxOutputTokens` to the per-model output cap (`antigravity.ts:307-352`).

**What this means in practice.** On these two ids, `reasoning_effort` at most raises the requested `maxOutputTokens`, and the per-model cap still applies. How much the model thinks is fixed by the upstream model id. In the OmniRoute catalog, `claude-opus-4-6-thinking` is listed as "(Thinking)", and so is `claude-sonnet-4-6` ("Claude Sonnet 4.6 (Thinking)"), both with `supportsReasoning: true` (`open-sse/config/antigravitySharedModels.ts:112-131`). That the upstream thinks by default is my inference from these names and the strip comment; I did not measure it. **UNVERIFIED** whether Antigravity honours any per-request knob for Claude.

**Related but not applicable here.** Effort suffixes on Claude model ids (`claude-…-high` and so on) are converted to `reasoning_effort` by `applyClaudeEffortVariant` (`open-sse/handlers/chatCore/claudeEffortVariant.ts:35-80`). Antigravity "literal tier" ids are exempt from that conversion. Neither of the two ids above carries such a suffix.

### Per-account quota and usage endpoints

OmniRoute calls each connected account a "connection".

**`GET /api/usage/{connectionId}`**

- Fetches the provider's live limits for one connection and stores them in the cache (`src/app/api/usage/[connectionId]/route.ts:14-33`).
- Requires management auth: anything under `/api/` that is not public is classed as MANAGEMENT (`src/server/authz/classify.ts:111-126`). Accepted credentials are a dashboard session, an `oma_` access token, or an API key with the `manage` scope (`src/server/authz/policies/management.ts:270-300`).
- Response for Antigravity (`open-sse/services/usage/antigravity.ts:686-701,753-770`):

  ```jsonc
  {
    "plan": "…",
    "quotaGroups": [ /* … */ ],
    "subscriptionInfo": { /* … */ },
    "quotas": {
      "<modelId>": {
        "used": 0, "total": 1000, "resetAt": "ISO|null",
        "remainingPercentage": 0.0, "unlimited": false, "fractionReported": true,
        "quotaSource": "retrieveUserQuota|fetchAvailableModels"
      },
      "credits": { "remaining": 0 /* … */ }   // only if a credit balance is known
    }
  }
  ```

  `total` is a normalised base of 1000, not a real request count. An error comes back as `{ plan, subscriptionInfo, message }`.

**`GET /api/usage/provider-limits`**

- Returns `{ caches, intervalMinutes, lastAutoSyncAt }`: the cached limits for every connection, with no live refresh.
- `POST` to the same path refreshes every connection (`src/app/api/usage/provider-limits/route.ts`).
- Management auth.

**`GET /api/usage/om-usage?format=json`**

- Uses the caller's own inference API key; this route is public in the authz sense (`src/shared/constants/publicApiRoutes.ts:49-53`).
- The key must have `allowUsageCommand` enabled, otherwise the route returns 403.
- Response: `{ allowed: true, personal?, provider: {connectionId, provider, plan, quotas}, providers: [...] }`. On refusal: `{ allowed: false, error: { message } }` (`docs/reference/API_REFERENCE.md:759-810`).
- This is the endpoint a worker container can call with only its inference key.

**Not useful here:** `GET /api/v1/accounts/{id}/limits` returns key-issuance limits (`maxActiveKeys`, `dailyIssueLimit` and so on), not provider quota (`src/app/api/v1/accounts/[id]/limits/route.ts`).

**Evidence:** files cited inline, in `diegosouzapw/OmniRoute@7f3cbb0`.

---

## 6. Plugins and hooks for a headless worker

### No-code options first

**1. Block edits to test files with permissions alone.**

- The edit, write and apply_patch tools all ask permission `edit` with the path **relative to the worktree** as the pattern (`tool/edit.ts:103-104`, `tool/write.ts:55-56`, `tool/apply_patch.ts:207-208`).
- In patterns, `*` matches any characters including `/`, and the last matching rule wins (`docs/permissions.mdx:91-101`).
- `--auto` replies "once" to permission prompts. An explicit `deny` never produces a prompt, so `--auto` cannot override it. Without `--auto`, `run` rejects every prompt automatically (`cli/cmd/run.ts:274, 803-822`).
- **Limit:** the `bash` tool can still write files, for example `sed -i`. Deny the bash patterns that matter, or use the plugin below.

```jsonc
{ "permission": { "edit": { "*": "allow", "*.test.*": "deny", "*.spec.*": "deny", "tests/*": "deny", "*/__tests__/*": "deny" } } }
```

**2. Run a command after every edit with a formatter.**

- Formatters are **off by default**. They run after a file is written or edited (`docs/formatters.mdx:6,48-54`).
- `$FILE` is replaced by the edited path (`docs/formatters.mdx:110-130`).

```jsonc
{ "formatter": { "lint-fix": { "command": ["npx", "eslint", "--fix", "$FILE"], "extensions": [".ts", ".tsx"] } } }
```

### Plugin hooks

Plugins are JS or TS modules placed in `~/.config/opencode/plugins/` or `.opencode/plugins/`, or npm packages listed in `"plugin": [...]` (`docs/plugins.mdx:18-63`). Hook signatures are in `packages/plugin/src/index.ts:247-297`:

| Hook | Signature or purpose |
| --- | --- |
| `tool.execute.before` | `(input: {tool, sessionID, callID}, output: {args})`. Throwing an error blocks the call; the docs' `.env`-protection example does this (`docs/plugins.mdx:243-257`) |
| `tool.execute.after` | `(input: {tool, sessionID, callID, args}, output: {title, output, metadata})`. Can rewrite the result the model sees |
| `permission.ask` | `(input, output: {status})`. Can force allow or deny |
| `shell.env` | Inject environment variables into every shell call |
| `chat.params` | Edit temperature, topP, maxOutputTokens and provider `options` per call. Could set `reasoningEffort` dynamically |
| `chat.headers` | Add HTTP headers per call. Could be used to tag OmniRoute requests per run |
| `experimental.chat.system.transform` | Edit the system prompt |
| `experimental.session.compacting` | Edit the compaction prompt |
| `event` | Receives events such as `session.idle`, `session.error` and `file.edited` |

`--pure` and `OPENCODE_PURE=1` disable external plugins (`opencode --help`; `runtime-flags.ts:18`).

The plugin below blocks test edits even when they are made through bash, and runs typecheck after each edit:

```ts
// ~/.config/opencode/plugins/guard.ts
import type { Plugin } from "@opencode-ai/plugin"
const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/
export const Guard: Plugin = async ({ $, directory }) => ({
  "tool.execute.before": async (input, output) => {
    const p: string | undefined = output.args?.filePath
    if ((input.tool === "edit" || input.tool === "write") && p && TEST.test(p))
      throw new Error(`Editing test files is forbidden: ${p}`)
    if (input.tool === "apply_patch" && TEST.test(String(output.args?.patchText ?? "")))  // crude: scans patch headers
      throw new Error("Patch touches a test file")
    if (input.tool === "bash" && /(>|sed -i|tee|mv|cp|rm)\b.*(\.test\.|\.spec\.|__tests__|\btests?\/)/.test(output.args?.command ?? ""))
      throw new Error("Shell writes to test files are forbidden")
  },
  "tool.execute.after": async (input, output) => {
    if (["edit", "write", "apply_patch"].includes(input.tool)) {
      const r = await $`npx tsc --noEmit -p ${directory}`.nothrow().quiet()
      if (r.exitCode !== 0) output.output += `\n\n[typecheck failed]\n${r.stdout.toString().slice(-4000)}`
    }
  },
})
```

The argument names are confirmed in source: `edit.filePath` (`tool/edit.ts:48`), `write.filePath` (`tool/write.ts:22`), `apply_patch.patchText` (`tool/apply_patch.ts:19`) and `bash.command` (`tool/shell/prompt.ts:17`). The shell tool's id and permission key stay `"bash"` on every OS (`tool/shell/id.ts:14`). The plugin itself has not been run.

**Evidence:** `packages/plugin/src/index.ts:247-297`; `docs/plugins.mdx`; `docs/permissions.mdx`; `docs/formatters.mdx`; `packages/opencode/src/cli/cmd/run.ts:803-822`

---

## 7. MCP servers (local commands)

The schema for a local server, from `packages/core/src/v1/config/mcp.ts:6-23`:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"local"` | Required |
| `command` | `string[]` | Required. The executable followed by its arguments, in one array |
| `cwd` | string, optional | Relative paths resolve from the workspace directory |
| `environment` | `{[k]: string}`, optional | Environment variables for the server |
| `enabled` | boolean, optional | Start the server or not |
| `timeout` | positive int, ms, optional | Default 5000 |

A remote server is `{type: "remote", url, headers?, oauth?: {...} | false, enabled?, timeout?}` (`mcp.ts:44-60`).

- `{env:VAR}` and `{file:path}` substitution works anywhere in the config (`packages/opencode/src/config/variable.ts:33-61`).
- MCP tools are named `<server>_<tool>`, and permission or tool globs such as `"my-mcp*"` match them (`docs/mcp-servers.mdx:383`).

```jsonc
{
  "mcp": {
    "lykos": {
      "type": "local",
      "command": ["node", "/opt/lykos/dist/cli/mcp.js", "--stdio"],
      "cwd": ".",
      "environment": { "LYKOS_HOME": "{env:HOME}/.lykos" },
      "enabled": true,
      "timeout": 30000
    }
  },
  "permission": { "lykos_*": "allow" }
}
```

To manage servers from the command line: `opencode mcp` (`opencode --help`).

**Evidence:** `packages/core/src/v1/config/mcp.ts`; https://opencode.ai/docs/mcp-servers (= `docs/mcp-servers.mdx:72-112`)

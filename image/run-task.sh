#!/usr/bin/env bash
# Runs inside the container. Inputs: /in/repo.bundle, /in/task.md, env from delegate.sh.
# Outputs everything to /out: result.bundle, events.jsonl, test.log, summary.json.
set -uo pipefail

: "${BRANCH:?}" "${BASE_SHA:?}"
TEST_CMD="${TEST_CMD:-npm test}"
SETUP_CMD="${SETUP_CMD:-}"
TIMEOUT_MIN="${TIMEOUT_MIN:-60}"
OUT=/out
started=$(date +%s)

log() { printf '[run-task %s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$OUT/harness.log" >&2; }

# 1. Clone. The container owns this .git; nothing here is ever executed on the host.
git clone -q /in/repo.bundle /work/repo || { log "clone failed"; exit 10; }
cd /work/repo
git checkout -q -b "$BRANCH" "$BASE_SHA" || { log "checkout of $BASE_SHA failed"; exit 11; }
git config user.name "agent-box (${MODEL:-none})"
git config user.email "agent-box@localhost"
git remote remove origin 2>/dev/null || true

# 2. Dependencies.
if [ -z "$SETUP_CMD" ] && [ -f package-lock.json ]; then SETUP_CMD="npm ci --no-audit --no-fund"; fi
setup_exit=0
if [ -n "$SETUP_CMD" ]; then
  log "setup: $SETUP_CMD"
  bash -lc "$SETUP_CMD" >"$OUT/setup.log" 2>&1; setup_exit=$?
  log "setup exit $setup_exit"
fi

# 3. Agent.
agent_exit=-1
if [ "${SKIP_AGENT:-0}" != "1" ] && [ "$setup_exit" = 0 ]; then
  : "${MODEL:?}" "${OMNIROUTE_API_KEY:?}" "${OMNIROUTE_BASE_URL:?}"
  mkdir -p ~/.config/opencode
  curl -fsS -H "Authorization: Bearer $OMNIROUTE_API_KEY" "$OMNIROUTE_BASE_URL/models" \
    >"$OUT/models.json" 2>"$OUT/models.err" || log "could not list models (continuing with $MODEL only)"
  MODEL="$MODEL" ALLOW_WEB="${ALLOW_WEB:-0}" node -e '
    const fs = require("fs");
    let ids = [];
    try { ids = (JSON.parse(fs.readFileSync("/out/models.json", "utf8")).data || []).map(m => m.id); } catch {}
    if (!ids.includes(process.env.MODEL)) ids.push(process.env.MODEL);
    const models = Object.fromEntries(ids.map(id => [id, { name: id }]));
    const cfg = {
      $schema: "https://opencode.ai/config.json",
      autoupdate: false,
      share: "disabled",
      model: "omniroute/" + process.env.MODEL,
      provider: { omniroute: {
        npm: "@ai-sdk/openai-compatible",
        name: "OmniRoute",
        options: { baseURL: "{env:OMNIROUTE_BASE_URL}", apiKey: "{env:OMNIROUTE_API_KEY}" },
        models,
      } },
      permission: { webfetch: process.env.ALLOW_WEB === "1" ? "allow" : "deny" },
    };
    fs.writeFileSync(require("os").homedir() + "/.config/opencode/opencode.json", JSON.stringify(cfg, null, 2));
  '
  prompt="$(sed -e "s|{{BRANCH}}|$BRANCH|g" -e "s|{{TEST_CMD}}|$TEST_CMD|g" /opt/agent-box/preamble.md; cat /in/task.md)"
  variant_args=(); [ -n "${VARIANT:-}" ] && variant_args=(--variant "$VARIANT")
  log "agent: omniroute/$MODEL, timeout ${TIMEOUT_MIN}m"
  timeout --kill-after=30 "${TIMEOUT_MIN}m" \
    opencode run --auto --format json -m "omniroute/$MODEL" "${variant_args[@]}" --title "$BRANCH" "$prompt" \
    >"$OUT/events.jsonl" 2>"$OUT/opencode.log"
  agent_exit=$?
  log "agent exit $agent_exit"
fi

# 4. Anything the agent left uncommitted becomes one labelled commit, so nothing is lost.
leftovers=0
if [ -n "$(git status --porcelain)" ]; then
  git add -A && git commit -q -m "agent-box: uncommitted changes left by the agent" && leftovers=1
fi

# 5. Tests, run by the harness, never trusted from the agent.
test_exit=-1
if [ "$setup_exit" = 0 ]; then
  log "test: $TEST_CMD"
  bash -lc "$TEST_CMD" >"$OUT/test.log" 2>&1; test_exit=$?
  log "test exit $test_exit"
fi

# 6. Results.
commits=$(git rev-list --count "$BASE_SHA..HEAD")
if [ "$commits" -gt 0 ]; then
  git bundle create -q "$OUT/result.bundle" "$BASE_SHA..$BRANCH" 2>>"$OUT/harness.log"
  git diff --stat "$BASE_SHA..HEAD" >"$OUT/diffstat.txt"
  git log --format='%h %s' "$BASE_SHA..HEAD" >"$OUT/commits.txt"
fi
jq -n \
  --arg branch "$BRANCH" --arg base "$BASE_SHA" --arg head "$(git rev-parse HEAD)" --arg model "${MODEL:-}" \
  --argjson commits "$commits" --argjson leftovers "$leftovers" \
  --argjson setup "$setup_exit" --argjson agent "$agent_exit" --argjson test "$test_exit" \
  --argjson seconds "$(( $(date +%s) - started ))" \
  '{branch:$branch, base:$base, head:$head, model:$model, commits:$commits, leftovers_committed:($leftovers==1),
    setup_exit:$setup, agent_exit:$agent, test_exit:$test, seconds:$seconds}' >"$OUT/summary.json"
log "done"

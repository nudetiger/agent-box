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
git -c advice.detachedHead=false clone -q /in/repo.bundle /work/repo || { log "clone failed"; exit 10; }
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
  if ! curl -fsS -m 20 -H "Authorization: Bearer $OMNIROUTE_API_KEY" "$OMNIROUTE_BASE_URL/models" \
    >"$OUT/models.json" 2>"$OUT/models.err"; then
    log "OmniRoute unreachable at $OMNIROUTE_BASE_URL: $(cat "$OUT/models.err")"
    SKIP_AGENT=unreachable
  fi
fi
if [ "${SKIP_AGENT:-0}" = "unreachable" ]; then
  agent_exit=-2
elif [ "${SKIP_AGENT:-0}" != "1" ] && [ "$setup_exit" = 0 ]; then
  agent_name="$(node /opt/agent-box/make-config.mjs)" || { log "config generation failed"; exit 12; }
  preamble=/opt/agent-box/preamble.md; [ "${REVIEW:-0}" = 1 ] && preamble=/opt/agent-box/preamble-review.md
  prompt="$(sed -e "s|{{BRANCH}}|$BRANCH|g" -e "s|{{TEST_CMD}}|$TEST_CMD|g" "$preamble"
            [ -f /in/context.md ] && { echo; cat /in/context.md; }
            printf '\n# Task\n\n'; cat /in/task.md)"
  printf '%s\n' "$prompt" >"$OUT/prompt.md"
  variant_args=(); [ -n "${VARIANT:-}" ] && variant_args=(--variant "$VARIANT")
  log "agent: $agent_name on omniroute/$MODEL${EFFORT:+ ($EFFORT)}${SCOUT_MODEL:+, scout $SCOUT_MODEL}, timeout ${TIMEOUT_MIN}m"
  timeout --kill-after=30 "${TIMEOUT_MIN}m" \
    opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${variant_args[@]}" --title "$BRANCH" "$prompt" \
    >"$OUT/events.jsonl" 2>"$OUT/opencode.log"
  agent_exit=$?
  log "agent exit $agent_exit"
  # The final assistant message, and whether it ends in a BLOCKED line.
  node -e '
    const fs = require("fs");
    const texts = [];
    for (const l of fs.readFileSync("/out/events.jsonl", "utf8").split("\n")) {
      try { const e = JSON.parse(l); if (e.type === "text" && e.part && e.part.text) texts.push(e.part.text); } catch {}
    }
    const last = texts.length ? texts[texts.length - 1] : "";
    fs.writeFileSync("/out/final.md", last);
    const m = last.match(/^\s*BLOCKED:\s*(.+)$/m);
    fs.writeFileSync("/out/blocked.txt", m ? m[1].trim() : "");
  ' 2>>"$OUT/harness.log" || true
fi
blocked="$(cat "$OUT/blocked.txt" 2>/dev/null || true)"

# 4. Review runs are read-only: record and discard any edit. Otherwise anything left uncommitted
#    becomes one labelled commit, so nothing is lost.
leftovers=0
review_violation=false
if [ "${REVIEW:-0}" = 1 ]; then
  if [ -n "$(git status --porcelain)" ] || [ "$(git rev-list --count "$BASE_SHA..HEAD")" -gt 0 ]; then
    review_violation=true
    { git status --porcelain; git log --oneline "$BASE_SHA..HEAD"; } >"$OUT/review-violation.txt"
    log "review run modified the repo; changes discarded"
  fi
  git reset -q --hard "$BASE_SHA"; git clean -qfd
elif [ -n "$(git status --porcelain)" ]; then
  git add -A && git commit -q -m "agent-box: uncommitted changes left by the agent" && leftovers=1
fi

# 4b. Sealed files: any change the worker made to them is reverted before the harness tests, and
#     recorded. SEALED holds newline-separated globs relative to the repo root.
sealed_touched=()
if [ -n "${SEALED:-}" ] && [ "${REVIEW:-0}" != 1 ]; then
  specs=(); while IFS= read -r g; do [ -n "$g" ] && specs+=(":(glob)$g"); done <<<"$SEALED"
  mapfile -t sealed_touched < <(git diff --name-only "$BASE_SHA..HEAD" -- "${specs[@]}")
  if [ "${#sealed_touched[@]}" -gt 0 ]; then
    printf '%s\n' "${sealed_touched[@]}" >"$OUT/sealed-violation.txt"
    log "worker changed sealed files: ${sealed_touched[*]} (reverted)"
    for f in "${sealed_touched[@]}"; do
      if git cat-file -e "$BASE_SHA:$f" 2>/dev/null; then git checkout -q "$BASE_SHA" -- "$f"; else git rm -q -f -- "$f"; fi
    done
    git commit -q -m "agent-box: revert worker edits to sealed files" -- "${sealed_touched[@]}" || true
  fi
fi

# 5. Tests, run by the harness, never trusted from the agent. Skipped for read-only reviews.
test_exit=-1
if [ "$setup_exit" = 0 ] && [ "${REVIEW:-0}" != 1 ]; then
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
  --argjson review "${REVIEW:-0}" --argjson violation "$review_violation" \
  --arg blocked "$blocked" --argjson sealed "$(printf '%s\n' "${sealed_touched[@]}" | jq -R . | jq -s 'map(select(. != ""))')" \
  '{branch:$branch, base:$base, head:$head, model:$model, commits:$commits, leftovers_committed:($leftovers==1),
    setup_exit:$setup, agent_exit:$agent, test_exit:$test, seconds:$seconds,
    blocked:(if $blocked == "" then null else $blocked end), sealed_violation:$sealed,
    review:($review==1), review_violation:$violation}' >"$OUT/summary.json"
log "done"

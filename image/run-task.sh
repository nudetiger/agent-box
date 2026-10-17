#!/usr/bin/env bash
# Runs inside the container. Inputs: /in/repo.bundle, /in/task.md, env from delegate.sh.
# Outputs everything to /out: result.bundle, events.jsonl, test.log, summary.json, progress.json.
set -uo pipefail

: "${BRANCH:?}" "${BASE_SHA:?}"
TEST_CMD="${TEST_CMD:-npm test}"
SETUP_CMD="${SETUP_CMD:-}"
TIMEOUT_MIN="${TIMEOUT_MIN:-60}"
OUT=/out
started=$(date +%s)
autofix=0

log() { printf '[run-task %s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$OUT/harness.log" >&2; }
# Phase for progress.mjs (delegate.sh stats live) and the TUI: setup, red, agent, test, autofix, done.
phase() { printf '%s %s\n' "$1" "$autofix" >"$OUT/phase"; }
phase setup
node /opt/agent-box/progress.mjs >/dev/null 2>&1 &
serve_pid=""
trap 'phase done; [ -n "$serve_pid" ] && kill "$serve_pid" 2>/dev/null' EXIT

# 1. Clone. The container owns this .git; nothing here is ever executed on the host.
# START_SHA: where the worker starts (a continued run starts on its previous round's head). BASE_SHA
# stays the original base, so the sealed check, review guard and bundle cover every round.
START_SHA="${START_SHA:-$BASE_SHA}"
# REUSE=1: a parked container from this session's previous round (delegate.sh, AGENT_BOX_PARK). The
# clone, the installed dependencies and the session store are still here: fetch the new start and
# switch to it; ignored files (build output, node_modules) stay.
reuse_changed=all
if [ "${REUSE:-0}" = 1 ] && [ -d /work/repo/.git ]; then
  cd /work/repo
  prev_head="$(git rev-parse HEAD)"
  git fetch -q /in/repo.bundle '+refs/heads/*:refs/bundle/*' 2>/dev/null || { log "fetch into the reused clone failed"; exit 10; }
  git reset -q --hard && git clean -qfd
  git checkout -q -B "$BRANCH" "$START_SHA" || { log "checkout of $START_SHA failed"; exit 11; }
  reuse_changed="$(git diff --name-only "$prev_head" "$START_SHA" 2>/dev/null)"
  log "reused container: $prev_head -> $START_SHA"
else
  git -c advice.detachedHead=false clone -q /in/repo.bundle /work/repo || { log "clone failed"; exit 10; }
  cd /work/repo
  git checkout -q -b "$BRANCH" "$START_SHA" || { log "checkout of $START_SHA failed"; exit 11; }
fi
# Build wrappers committed without the executable bit (common from Windows) would cost the worker a
# failed call. Mode changes stay out of the diff.
git config core.fileMode false
for w in gradlew mvnw; do [ -f "$w" ] && chmod +x "$w"; done
git config user.name "agent-box (${MODEL:-none})"
git config user.email "agent-box@localhost"
git remote remove origin 2>/dev/null || true

# 2. Dependencies.
if [ -z "$SETUP_CMD" ] && [ -f package-lock.json ]; then SETUP_CMD="npm ci --no-audit --no-fund"; fi
setup_exit=0 t0=$(date +%s)
# A reused clone already has its dependencies, unless a manifest or lockfile changed since its last round.
MANIFESTS='(^|/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|(build|settings)\.gradle(\.kts)?|gradle\.properties|gradle/libs\.versions\.toml|pom\.xml|go\.(mod|sum)|Cargo\.(toml|lock)|requirements[^/]*\.txt|pyproject\.toml|CMakeLists\.txt)$'
if [ "$reuse_changed" != all ] && ! grep -qE "$MANIFESTS" <<<"$reuse_changed"; then
  [ -n "$SETUP_CMD" ] && log "setup skipped: reused container, no manifest changed"
  SETUP_CMD=""
fi
if [ -n "$SETUP_CMD" ]; then
  log "setup: $SETUP_CMD"
  bash -lc "$SETUP_CMD" >"$OUT/setup.log" 2>&1; setup_exit=$?
  log "setup exit $setup_exit"
fi
setup_s=$(( $(date +%s) - t0 ))

# 2b. Red check: the sealed tests must fail before the worker starts. If they already pass, the spec
#     does not pin the change (WEAK-SPEC) and an agent run would prove nothing: stop here.
red_exit=-1 weak_spec=false
if [ -n "${RED_CMD:-}" ] && [ "$setup_exit" = 0 ] && [ -z "${CONTINUE_SESSION:-}" ] && [ "${SKIP_AGENT:-0}" != 1 ]; then
  phase red
  log "red check: $RED_CMD"
  bash -lc "$RED_CMD" >"$OUT/red.log" 2>&1; red_exit=$?
  if [ "$red_exit" = 0 ]; then
    weak_spec=true
    log "red check: the sealed tests already pass on the base (WEAK-SPEC); the agent does not run"
  else
    log "red check exit $red_exit: the sealed tests fail on the base, as they should"
  fi
fi

# 3. Agent.
agent_exit=-1 agent_s=0 session_id="" attach_args=() variant_args=() agent_name=""
if [ "$weak_spec" = true ]; then
  agent_exit=-3
elif [ "${SKIP_AGENT:-0}" != "1" ] && [ "$setup_exit" = 0 ]; then
  : "${MODEL:?}" "${OMNIROUTE_API_KEY:?}" "${OMNIROUTE_BASE_URL:?}"
  mkdir -p ~/.config/opencode
  # The model list (1 MB) stays in the container: make-config reads limits from it, nothing else does.
  if ! curl -fsS -m 20 -H "Authorization: Bearer $OMNIROUTE_API_KEY" "$OMNIROUTE_BASE_URL/models" \
    >/tmp/models.json 2>/tmp/models.err; then
    log "OmniRoute unreachable at $OMNIROUTE_BASE_URL: $(cat /tmp/models.err)"
    SKIP_AGENT=unreachable
  fi
fi
if [ "${SKIP_AGENT:-0}" = "unreachable" ]; then
  agent_exit=-2
elif [ "$agent_exit" = -1 ] && [ "${SKIP_AGENT:-0}" != "1" ] && [ "$setup_exit" = 0 ]; then
  agent_name="$(node /opt/agent-box/make-config.mjs)" || { log "config generation failed"; exit 12; }
  preamble=/opt/agent-box/preamble.md; [ "${REVIEW:-0}" = 1 ] && preamble=/opt/agent-box/preamble-review.md
  [ -n "${PREAMBLE:-}" ] && preamble="/opt/agent-box/preamble-$PREAMBLE.md"
  session_args=()
  if [ -n "${CONTINUE_SESSION:-}" ]; then
    # Follow-up round: the previous round's session store comes back, and the worker resumes with
    # everything it read and tried. The message is the orchestrator's answer or next request.
    mkdir -p ~/.local/share
    if [ "${REUSE:-0}" = 1 ] && [ -d ~/.local/share/opencode ]; then log "session store kept from the parked container"
    else tar xzf /in/opencode-data.tgz -C ~/.local/share || { log "session restore failed"; exit 13; }; fi
    session_args=(--session "$CONTINUE_SESSION")
    prompt="$(printf '# Follow-up from the orchestrator (round %s)\n\nYour earlier work is committed on this branch. The operating conditions from your first message still apply, including the final report block and BLOCKED.\n\n' "${ROUND:-2}"; cat /in/task.md)"
  else
    # Quoted replacements: a test command may hold |, & or backslashes (bash 5.2 patsub_replacement).
    pre="$(cat "$preamble")"; pre="${pre//\{\{BRANCH\}\}/"$BRANCH"}"; pre="${pre//\{\{TEST_CMD\}\}/"$TEST_CMD"}"
    # JVM dependencies in the build caches: the `api` tool (image/api.mjs) answers signature questions.
    api_note=""
    if [ -d ~/.gradle/caches/modules-2/files-2.1 ] || [ -d ~/.m2/repository ]; then
      api_note='## Dependency APIs

Library classes (the jars under ~/.gradle or ~/.m2) are one command away: `api find <regex>` lists
matching classes, `api show <Class>` prints a class'"'"'s signatures, `api grep <regex> --jar <name>`
searches members. Use these instead of unzip, javap or find on the caches: the answers are short and
cached. Use javap -c only when you need a method'"'"'s bytecode, on that one class.'
    fi
    prompt="$(printf '%s\n' "$pre"
              [ -n "$api_note" ] && printf '\n%s\n' "$api_note"
              [ -f /in/context.md ] && { echo; cat /in/context.md; }
              printf '\n# Task\n\n'; cat /in/task.md)"
  fi
  printf '%s\n' "$prompt" >"$OUT/prompt.md"
  # A local OpenCode server, so `delegate.sh tui` (herdr) can attach the real OpenCode TUI to this
  # worker's session. The worker's `run` talks to it; without it, `run` starts its own in-process.
  if [ "${TUI:-0}" = 1 ]; then
    opencode serve --hostname 127.0.0.1 --port 4096 >"$OUT/serve.log" 2>&1 &
    serve_pid=$!
    for _ in $(seq 1 80); do curl -fs -m 1 http://127.0.0.1:4096/session >/dev/null 2>&1 && break; sleep 0.25; done
    if curl -fs -m 1 http://127.0.0.1:4096/session >/dev/null 2>&1; then attach_args=(--attach http://127.0.0.1:4096)
    else log "opencode serve did not start; running without the TUI server"; kill "$serve_pid" 2>/dev/null; serve_pid=""; fi
  fi
  [ -n "${VARIANT:-}" ] && variant_args=(--variant "$VARIANT")
  log "agent: $agent_name on omniroute/$MODEL${EFFORT:+ ($EFFORT)}${SCOUT_MODEL:+, scout $SCOUT_MODEL}, timeout ${TIMEOUT_MIN}m${STEPS:+, at most $STEPS steps}${CONTINUE_SESSION:+, resuming $CONTINUE_SESSION}"
  phase agent
  t0=$(date +%s)
  timeout --kill-after=30 "${TIMEOUT_MIN}m" \
    opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${attach_args[@]}" "${variant_args[@]}" "${session_args[@]}" --title "$BRANCH" "$prompt" \
    >"$OUT/events.jsonl" 2>"$OUT/opencode.log"
  agent_exit=$?
  agent_s=$(( $(date +%s) - t0 ))
  log "agent exit $agent_exit"
fi

# The worker's last message: BLOCKED line, report block, review findings block. The report is a claim;
# delegate.sh compares it with the harness's own test run (MISREPORT).
# With --attach, `run` can exit before the last step reaches events.jsonl; recover-final.mjs appends it
# from the session store first, marked "recovered" (summary.json final_recovered).
recover_final() {
  local sid n
  sid="$(jq -r 'select(.sessionID) | .sessionID' "$OUT/events.jsonl" 2>/dev/null | tail -n 1)"
  [ -n "$sid" ] && [ -f ~/.local/share/opencode/opencode.db ] || return 0
  n="$(node --no-warnings /opt/agent-box/recover-final.mjs "$OUT/events.jsonl" ~/.local/share/opencode/opencode.db "$sid" 2>>"$OUT/harness.log")"
  [ "${n:-0}" -gt 0 ] 2>/dev/null && log "events.jsonl lost the last step: recovered $n event(s) from the session store"
  return 0
}
final_message() {
  recover_final
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
    const block = (name) => {
      // The name may stand on the line after the fence (lib/ledger.mjs blockRegex, the same pattern).
      const b = last.match(new RegExp("```[^\\n`]*?(?:\\r?\\n[ \\t]*)?" + name + "[^\\n]*\\n([\\s\\S]*?)\\n\\s*```"));
      if (!b) return null;
      try { return JSON.parse(b[1]); } catch { return { parse_error: b[1].slice(0, 500) }; }
    };
    fs.writeFileSync("/out/report.json", JSON.stringify(block("agent-box-report")));
    const f = block("agent-box-findings");
    if (f !== null) fs.writeFileSync("/out/findings.json", JSON.stringify(f));
  ' 2>>"$OUT/harness.log" || true
}
[ -s "$OUT/events.jsonl" ] && final_message
session_id="$(jq -r 'select(.sessionID) | .sessionID' "$OUT/events.jsonl" 2>/dev/null | tail -n 1)"

# 3b. A turn cut off at the output cap (step_finish reason "length", usually from thinking) ends the
#     run with no edit. Resume the same session, up to CUT_RESUMES times, and ask for edits.
cut_resumes=0
resume_cut() {
  while [ "$cut_resumes" -lt "${CUT_RESUMES:-2}" ] && [ "$agent_exit" = 0 ] && [ -n "$session_id" ] \
     && [ "$(node /opt/agent-box/last-stop.mjs "$OUT/events.jsonl")" = length ]; do
    cut_resumes=$((cut_resumes + 1))
    log "cut off at the output cap: resuming $session_id ($cut_resumes)"
    local msg='Your last turn was cut off at the output limit while you were still thinking, so nothing was done. Stop planning the whole change at once: make the edits now with your tools, one small step at a time, and commit as you go. End with the report block.'
    [ "${REVIEW:-0}" = 1 ] && msg='Your last turn was cut off at the output limit while you were still thinking. Stop analysing: write your review now, ending with the findings block.'
    local t0; t0=$(date +%s)
    timeout --kill-after=30 "${AUTOFIX_MIN:-15}m" \
      opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${attach_args[@]}" "${variant_args[@]}" --session "$session_id" --title "$BRANCH" "$msg" \
      >>"$OUT/events.jsonl" 2>>"$OUT/opencode.log"
    agent_exit=$?
    agent_s=$(( agent_s + $(date +%s) - t0 ))
    log "cut resume $cut_resumes: agent exit $agent_exit"
    final_message
  done
}
resume_cut
blocked="$(cat "$OUT/blocked.txt" 2>/dev/null || true)"

# 3c. Self-check (SELF_CHECK=1): one more turn in the same session before the harness tests, on a first
#     round that changed something. The worker audits its diff against the task the way the reviewers
#     will, and fixes what it finds. A review round costs a fix and a recheck (30-40 min on
#     RakunMiniItems); round 1 had a medium or worse finding in 8 of 10 loops (2026-10-14..17).
self_checked=0
if [ "${SELF_CHECK:-0}" = 1 ] && [ "${REVIEW:-0}" != 1 ] && [ -z "${CONTINUE_SESSION:-}" ] && [ "$agent_exit" = 0 ] \
   && [ -z "$blocked" ] && [ -n "$session_id" ] && { [ -z "${STEPS:-}" ] || [ "${STEPS:-0}" -gt 30 ]; } \
   && [ "$(git rev-list --count "$BASE_SHA..HEAD" 2>/dev/null || echo 0)" -gt 0 -o -n "$(git status --porcelain)" ] \
   && ! grep -q '^{"type":"error"' "$OUT/events.jsonl" 2>/dev/null; then
  self_checked=1
  phase selfcheck
  log "self-check: resuming $session_id"
  msg="$(cat <<'EOF'
# Self-check before the harness tests your work

A reviewer will now read `git diff` of your branch against the task. Do their job first, briefly:

1. Go through the task's required behaviour line by line. For each line, name the file:line that does it
   and the test that would fail without it. A line with no code or no test is not done: do it now.
2. For every code path you added or changed, check the cases reviewers find most often: empty, missing
   or invalid input; a value at a boundary; the error path (what the user sees); reload or a second call;
   two callers at once, or re-entry while it runs; cleanup when something throws.
3. Check what the task said must stay the same still does, and that every doc the task or the context
   pack names as a duty is updated.
4. Do not refactor or widen the scope. Do not weaken or delete a test.

Fix and commit what you find, rerun the tests, then end with the report block again, keeping every
decision and dispute from your earlier report. If nothing is missing, say so in one line and end with
the report block.
EOF
)"
  cp "$OUT/final.md" "$OUT/final-before-check.md" 2>/dev/null; cp "$OUT/report.json" "$OUT/report-before-check.json" 2>/dev/null
  t0=$(date +%s)
  timeout --kill-after=30 "${AUTOFIX_MIN:-15}m" \
    opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${attach_args[@]}" "${variant_args[@]}" --session "$session_id" --title "$BRANCH" "$msg" \
    >>"$OUT/events.jsonl" 2>>"$OUT/opencode.log"
  agent_exit=$?
  agent_s=$(( agent_s + $(date +%s) - t0 ))
  log "self-check: agent exit $agent_exit"
  final_message
  # The earlier report's decisions and disputes stay: a short "nothing missing" report drops them.
  node -e '
    const fs = require("fs"), rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
    const a = rd("/out/report-before-check.json"), b = rd("/out/report.json");
    if (!a || typeof a !== "object") process.exit(0);
    if (!b || typeof b !== "object" || b.parse_error) { fs.writeFileSync("/out/report.json", JSON.stringify(a)); process.exit(0); }
    for (const k of ["decisions", "context_gaps", "test_dispute", "disputes"]) {
      const seen = new Set((b[k] ?? []).map((x) => JSON.stringify(x)));
      b[k] = [...(b[k] ?? []), ...(a[k] ?? []).filter((x) => !seen.has(JSON.stringify(x)))];
    }
    fs.writeFileSync("/out/report.json", JSON.stringify(b));
  ' 2>>"$OUT/harness.log" || true
  resume_cut
  blocked="$(cat "$OUT/blocked.txt" 2>/dev/null || true)"
fi

# 3d. No report block: one short turn asks for it alone. 27 of 191 implement runs (2026-10-12..17)
#     ended without one, so their claims could not be checked against the harness's tests (MISREPORT).
report_asked=0
if [ "${REVIEW:-0}" != 1 ] && [ "$agent_exit" = 0 ] && [ -n "$session_id" ] && [ -z "$blocked" ] \
   && ! jq -e 'type == "object" and (has("parse_error") | not)' "$OUT/report.json" >/dev/null 2>&1 \
   && ! grep -q '^{"type":"error"' "$OUT/events.jsonl" 2>/dev/null; then
  report_asked=1
  log "no report block: asking for it"
  t0=$(date +%s)
  timeout --kill-after=30 5m \
    opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${attach_args[@]}" "${variant_args[@]}" --session "$session_id" --title "$BRANCH" \
    'Your last message has no `agent-box-report` block. Do not change anything. Reply with only that fenced block, in the format the operating conditions give, filled in from the work you did (status, tests, decisions, context_gaps, test_dispute, disputes).' \
    >>"$OUT/events.jsonl" 2>>"$OUT/opencode.log"
  agent_s=$(( agent_s + $(date +%s) - t0 ))
  # The block is read from this reply; the message before it stays the final message.
  cp "$OUT/final.md" "$OUT/final-before-report.md" 2>/dev/null
  final_message
  jq -e 'type == "object" and (has("parse_error") | not)' "$OUT/report.json" >/dev/null 2>&1 \
    && { log "report block received"; cat "$OUT/final-before-report.md" "$OUT/final.md" >"$OUT/final.tmp" && mv "$OUT/final.tmp" "$OUT/final.md"; } \
    || log "still no report block"
fi

# 4. Review runs are read-only: record and discard any edit. Otherwise anything left uncommitted
#    becomes one labelled commit, so nothing is lost. Sealed files are reverted.
leftovers=0
review_violation=false
sealed_touched=()
settle() {
  if [ "${REVIEW:-0}" = 1 ]; then
    if [ -n "$(git status --porcelain)" ] || [ "$(git rev-list --count "$BASE_SHA..HEAD")" -gt 0 ]; then
      review_violation=true
      { git status --porcelain; git log --oneline "$BASE_SHA..HEAD"; } >"$OUT/review-violation.txt"
      log "review run modified the repo; changes discarded"
    fi
    git reset -q --hard "$BASE_SHA"; git clean -qfd
    return
  fi
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit -q -m "agent-box: uncommitted changes left by the agent" && leftovers=1
  fi
  # SEALED holds newline-separated globs relative to the repo root.
  [ -n "${SEALED:-}" ] || return
  local specs=() g f touched=()
  while IFS= read -r g; do [ -n "$g" ] && specs+=(":(glob)$g"); done <<<"$SEALED"
  mapfile -t touched < <(git diff --name-only "$BASE_SHA..HEAD" -- "${specs[@]}")
  [ "${#touched[@]}" -gt 0 ] || return
  sealed_touched+=("${touched[@]}")
  printf '%s\n' "${sealed_touched[@]}" | sort -u >"$OUT/sealed-violation.txt"
  log "worker changed sealed files: ${touched[*]} (reverted)"
  for f in "${touched[@]}"; do
    if git cat-file -e "$BASE_SHA:$f" 2>/dev/null; then git checkout -q "$BASE_SHA" -- "$f"; else git rm -q -f -- "$f"; fi
  done
  git commit -q -m "agent-box: revert worker edits to sealed files" -- "${touched[@]}" || true
}

# 5. Tests, run by the harness, never trusted from the agent. Skipped for read-only reviews.
#    HIDDEN=1 (benchmark check): files the worker never saw are copied over the result first.
test_exit=-1 test_s=0
run_tests() {
  [ "$setup_exit" = 0 ] && [ "${REVIEW:-0}" != 1 ] && [ "$weak_spec" != true ] || return 0
  if [ "${HIDDEN:-0}" = 1 ] && [ -d /in/hidden ]; then cp -a /in/hidden/. /work/repo/; log "hidden check files copied in"; fi
  phase test
  log "test: $TEST_CMD"
  local t0; t0=$(date +%s)
  bash -lc "$TEST_CMD" >"$OUT/test.log" 2>&1; test_exit=$?
  test_s=$(( test_s + $(date +%s) - t0 ))
  log "test exit $test_exit"
}
settle
run_tests
first_test_exit=$test_exit

# 5b. Auto-fix: the harness's test run failed after a worker that finished normally. Resume the same
#     session once with the failing tail; no orchestrator tokens are spent. A BLOCKED worker is left
#     alone: its question is the result. first_test_exit keeps the unrescued result for the ledger.
#     After a provider error (a {"type":"error"} event; OpenCode still exits 0) a resume would only
#     meet the same error: the host records it (lib/ledger.mjs providerError).
while [ "$test_exit" -gt 0 ] && [ "$autofix" -lt "${AUTOFIX:-1}" ] && [ "${REVIEW:-0}" != 1 ] \
   && [ "$agent_exit" = 0 ] && [ -z "$blocked" ] && [ -n "$session_id" ] && [ "${HIDDEN:-0}" != 1 ] \
   && ! grep -q '^{"type":"error"' "$OUT/events.jsonl" 2>/dev/null; do
  autofix=$((autofix + 1))
  phase autofix
  msg="$(printf '# Harness check failed (automatic follow-up %s)\n\nAfter you finished, the harness ran `%s` on your commits and it exited %s. Last lines:\n\n```\n%s\n```\n\nFind the cause. If your change caused it, fix the code (never a sealed file, and never weaken or skip a test), commit, and rerun the command. If the same failure happens on the base commit without your change, prove that and say so instead of fixing it. End with the report block again.\n' \
    "$autofix" "$TEST_CMD" "$test_exit" "$(tail -n 80 "$OUT/test.log" | cut -c1-400)")"
  log "autofix $autofix: resuming $session_id with the failing test tail"
  t0=$(date +%s)
  timeout --kill-after=30 "${AUTOFIX_MIN:-15}m" \
    opencode run --auto --format json --agent "$agent_name" -m "omniroute/$MODEL" "${attach_args[@]}" "${variant_args[@]}" --session "$session_id" --title "$BRANCH" "$msg" \
    >>"$OUT/events.jsonl" 2>>"$OUT/opencode.log"
  agent_exit=$?
  agent_s=$(( agent_s + $(date +%s) - t0 ))
  log "autofix $autofix: agent exit $agent_exit"
  final_message
  resume_cut
  blocked="$(cat "$OUT/blocked.txt" 2>/dev/null || true)"
  settle
  run_tests
done

# Keep the session so `delegate.sh continue` can resume it. Logs and binaries are not needed.
[ -d ~/.local/share/opencode ] && [ -n "$session_id" ] && tar czf "$OUT/opencode-data.tgz" -C ~/.local/share \
  --exclude=opencode/log --exclude=opencode/bin opencode 2>>"$OUT/harness.log"

# 6. Results.
commits=$(git rev-list --count "$BASE_SHA..HEAD")
if [ "$commits" -gt 0 ]; then
  git bundle create -q "$OUT/result.bundle" "$BASE_SHA..$BRANCH" 2>>"$OUT/harness.log"
  git diff --stat "$BASE_SHA..HEAD" >"$OUT/diffstat.txt"
  git log --format='%h %s' "$BASE_SHA..HEAD" >"$OUT/commits.txt"
fi
[ -s "$OUT/report.json" ] || echo null >"$OUT/report.json"
recovered="$(grep -c '"recovered":true' "$OUT/events.jsonl" 2>/dev/null)"; recovered="${recovered:-0}"
jq -n \
  --arg branch "$BRANCH" --arg base "$BASE_SHA" --arg head "$(git rev-parse HEAD)" --arg model "${MODEL:-}" \
  --argjson commits "$commits" --argjson leftovers "$leftovers" \
  --argjson setup "$setup_exit" --argjson agent "$agent_exit" --argjson test "$test_exit" --argjson first_test "$first_test_exit" \
  --argjson seconds "$(( $(date +%s) - started ))" --argjson setup_s "$setup_s" --argjson agent_s "$agent_s" --argjson test_s "$test_s" \
  --argjson review "${REVIEW:-0}" --argjson violation "$review_violation" \
  --argjson asked "$(ls /out/questions 2>/dev/null | grep -cE '^[0-9]+\.md$')" \
  --argjson answered "$(ls /out/questions 2>/dev/null | grep -cE '^[0-9]+\.answer\.md$')" \
  --arg session "${session_id:-}" --argjson round "${ROUND:-1}" --arg start "$START_SHA" \
  --argjson red "$red_exit" --argjson weak "$weak_spec" --argjson autofix "$autofix" --argjson cut "$cut_resumes" \
  --argjson recovered "$recovered" --argjson selfcheck "$self_checked" --argjson repask "$report_asked" \
  --slurpfile report "$OUT/report.json" \
  --arg blocked "$blocked" --argjson sealed "$(printf '%s\n' "${sealed_touched[@]}" | sort -u | jq -R . | jq -s 'map(select(. != ""))')" \
  '{branch:$branch, base:$base, head:$head, model:$model, commits:$commits, leftovers_committed:($leftovers==1),
    setup_exit:$setup, agent_exit:$agent, test_exit:$test, first_test_exit:$first_test, seconds:$seconds,
    phase_seconds:{setup:$setup_s, agent:$agent_s, test:$test_s},
    blocked:(if $blocked == "" then null else $blocked end), sealed_violation:$sealed,
    review:($review==1), review_violation:$violation, red_exit:$red, weak_spec:$weak, autofix:$autofix, cut_resumes:$cut,
    self_check:($selfcheck == 1), report_asked:($repask == 1), final_recovered:($recovered > 0),
    report:($report[0]), session:(if $session == "" then null else $session end), round:$round, start:$start,
    questions:{asked:$asked, answered:$answered}}' >"$OUT/summary.json"
log "done"

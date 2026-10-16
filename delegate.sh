#!/usr/bin/env bash
# agent-box: run an OpenCode worker on a git repo inside a disposable container (Podman by default).
# The repo goes in as a git bundle and comes back as a git bundle. The container never sees the
# host .git, your home directory, or any credential except the project's OmniRoute key.
set -euo pipefail

BOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# fanout, review, explore and batch start runs of this script. "$0" is whatever the caller typed: a
# relative "delegate.sh" is not on PATH and fails with "command not found" (bench 2026-10-13).
SELF=(bash "$BOX/delegate.sh")
IMAGE="agent-box:latest"
LABEL="agent-box=1"
# Container engine: podman (default) or docker. Set AGENT_BOX_ENGINE in the environment or in agent-box.conf.
[ -f "$BOX/agent-box.conf" ] && . "$BOX/agent-box.conf"
ENGINE="${AGENT_BOX_ENGINE:-podman}"
case "$ENGINE" in docker|podman) ;; *) echo "agent-box: unknown engine $ENGINE" >&2; exit 1 ;; esac

die() { echo "agent-box: $*" >&2; exit 1; }
# The engine gets container paths verbatim; Git Bash would otherwise rewrite /in/... into C:/...
dk() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$ENGINE" "$@"; }
cname_of() { echo "agent-box-$PROJECT-${1//[^a-zA-Z0-9_.-]/-}"; }
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

usage() {
  cat <<'EOF'
Usage: delegate.sh <command> ...

  build    [<repo>]              Build the base worker image; with <repo>, also the project's own image
                                 from projects/<repo>.Dockerfile (its toolchain, FROM agent-box:latest)
  models   <repo>                List models the project's OmniRoute key can use
  baseline <repo>                Clone + setup + tests in the container, no agent
  run      <repo> <task.md> [--role R | --model M] [--review] [--name N] [--base REF] [--timeout MIN]
                            [--variant V] [--web] [--test CMD]
                                 Run one task. Result lands as branch agent/<name> in <repo>.
                                 --role picks the model from agent-box.conf. --review (or a read-only
                                 role) discards every edit and skips tests; the output is the report.
  continue <repo> <run-name> (-m TEXT | -f FILE) [--name N] [--timeout MIN] [--steps N] [--at BRANCH (review runs)]
                                 Resume that run's worker session with a follow-up (answer to its
                                 BLOCKED question, review findings, next step). Same model, sealed
                                 files and test; starts on its branch. Result: agent/<run>-r2, -r3...
  watch    <repo> <run-name>     Live feed of a running worker: harness steps, tool calls, messages.
                                 With herdr running, every run opens one automatically in a tab of
                                 the "agent-box" workspace (AGENT_BOX_HERDR=0 turns that off)
  questions <repo> <run-name> [--wait]
                                 Open ask_orchestrator questions of a running worker. --wait blocks
                                 until one appears (exit 0) or the run ends (exit 1)
  wait     <repo> <name>... [--any] [--questions] [--timeout MIN]
                                 Block until these runs or loops end, then print each one's short report.
                                 Run it in the background: one notice instead of polling. --any: return at
                                 the first; --questions: also return when a worker asks
  answer   <repo> <run-name> <id> (-m TEXT | -f FILE)
                                 Answer a running worker's question; it continues where it stopped
                                 (run --no-ask: the worker gets no ask_orchestrator tool)
  fanout   <repo> <task.md> --roles a,b[,c] [--name N] [run options]
                                 Same task on several roles in parallel; prints a comparison table
  review   <repo> <branch> [--spec FILE ...] [--review-mode split|both | --roles a,b] [--against REF] [--focus TEXT]
                                 Read-only review, every reviewer given the branch's task and every --spec.
                                 Review mode (REVIEW_MODE, per project): split = two reviewers in parallel,
                                 review-spec and review-std; both = one review-both covering both axes.
                                 --roles names the reviewers outright (one axis: --roles review-spec).
                                 --name P names the runs P-<role>; --prior spec=FILE|std=FILE|both=FILE
                                 puts the previous round's findings first, to recheck
  loop     <repo> <run> [--spec FILE ...] [--name N] [--max-rounds N] [--reviews RV1,RV2] [--no-spec]
                        [--review-mode split|both] [--roles a,b] [--fresh ROLES|none] [--max-fixes N]
                                 Review, rerun each finding's reproduction and the tests next to the
                                 change, fix what is proven, review the fix, until nothing blocks.
                                 Stuck findings, regressions, serious findings after 3 fix rounds or
                                 a failing fix move the work up implement -> implement-hard -> escalate.
                                 Prints a short summary (open items, spec questions, triage items with
                                 their text), ending in next: approve, answer_spec, triage,
                                 answer_question, decide, or the run's own. --json: the whole result
  loop resume <repo> <loop> [--answer TEXT|@FILE] [--drop ID,ID] [--add FILE] [-m TEXT|@FILE] [--max-rounds N]
                        [--review-mode split|both] [--roles a,b] [--fresh ROLES|none] [--max-fixes N]
                                 Your decisions on a stopped loop, then it goes on with a fix round.
                                 --max-rounds raises the cap of a loop stopped at it; a new review mode
                                 or roles start the next review cold with those reviewers. --fresh: the
                                 roles of the fresh attempts on a stall (one role: a single implementer;
                                 none: a stall stops for you)
  loop-watch <repo> <loop>       Live view of a loop: rounds, the running step and its time, each
                                 finding and where it went, decisions, what to do when it stops.
                                 With herdr running, the loop opens it in a tab of its own
  ask     <repo> [--role advise|advise-alt | --model M] [--prompt FILE] [--file CTX ...]
                                 One-pass advisor (debate/critique), no tools; prompt from FILE or stdin
  show     <repo> <name> [--full] A finished run in a few lines again; --full: summary, test tail, final message
  hunt     <repo> <bug.md> [--base REF] [--name N]
                                 A reported bug with no known location: bughunt (Gemini Flash high)
                                 reproduces it, locates it and commits a failing test, checked red
                                 by the harness. Prints JSON with fix_task: run it with --role implement
                                 --base agent/<hunt run>
  roles    <repo>                The roles in effect for the project: agent-box.conf, overridden by
                                 any ROLE_*, REVIEW_MODE, REVIEW_ROLES, SCOUT_MODEL, LOOP_MAX_ROUNDS or
                                 TICKET_ESCALATE_* line in its projects/<repo>.env
  config   <repo>                The project's image, caches and every setting its .env sets
  setup    <repo> [--dry-run]    First-time projects/<repo>.env, .Dockerfile and .context.yaml from the
                                 repo's manifests (Node, Go, Rust, CMake, Gradle, Maven, Python); never
                                 overwrites a file
  clean                        Remove leftover agent-box containers (and parked ones)
  unpark   <repo> <run>...|--all Remove parked containers of these runs (and <run>-*); the loop does it itself
  spec-check <repo> <task.md> [--role R] [--name N] [--base REF]
                                 Read-only pass (review-spec-alt, DeepSeek) listing what the task leaves
                                 undecided or where it contradicts its docs, before anyone implements it.
                                 `run` does it itself for a task with `issue:` (SPEC_CHECK=0 or --no-spec-check: off)

Engine: podman (default) or docker, from AGENT_BOX_ENGINE or agent-box.conf. Build once per engine.
Parallel: at most AGENT_BOX_SLOTS containers at once (default 4); each slot has its own CACHES volumes.

Per-project settings: projects/<repo-folder-name-lowercase>.env (see projects/example.env)
EOF
}

# Loads projects/<name>.env into this shell. Sets PROJECT and REPO.
load_project() {
  REPO="$(cd "$1" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" || die "not a git repo: $1"
  PROJECT="$(basename "$REPO" | tr '[:upper:]' '[:lower:]')"
  local env="$BOX/projects/$PROJECT.env"
  # Benchmark fixture repos share one settings file (projects/bench.env).
  [ -f "$env" ] || [ -z "${AGENT_BOX_PROJECT_ENV:-}" ] || env="$AGENT_BOX_PROJECT_ENV"
  [ -f "$env" ] || die "no project file $env (copy projects/example.env)"
  PROJECT_ENV="$env"
  # A project with its own Dockerfile runs in its own image; IMAGE in the .env file wins over both.
  [ -f "$BOX/projects/$PROJECT.Dockerfile" ] && IMAGE="agent-box-$PROJECT:latest"
  set -a; # shellcheck disable=SC1090
  . "$env"; set +a
  OMNIROUTE_BASE_URL="${OMNIROUTE_BASE_URL:-http://host.docker.internal:20128/v1}"
  OMNIROUTE_HOST_URL="${OMNIROUTE_HOST_URL:-http://localhost:20128/v1}"
  TEST_CMD="${TEST_CMD:-npm test}"
  TIMEOUT_MIN="${TIMEOUT_MIN:-60}"
  export OMNIROUTE_BASE_URL TEST_CMD TIMEOUT_MIN
}

need_key() { [ -n "${OMNIROUTE_API_KEY:-}" ] || die "OMNIROUTE_API_KEY is empty in projects/$PROJECT.env"; }

cmd_build() {
  dk build -t agent-box:latest "$(winpath "$BOX/image")"
  [ -n "${1:-}" ] || return 0
  load_project "$1"
  local df="$BOX/projects/$PROJECT.Dockerfile"
  [ -f "$df" ] || die "no $df: $PROJECT runs in the base image, nothing more to build"
  # The context is an empty folder holding only the Dockerfile: projects/ has the .env secrets.
  local ctx="$BOX/runs/.build-$PROJECT"
  rm -rf "$ctx"; mkdir -p "$ctx"; cp "$df" "$ctx/Dockerfile"
  dk build -t "$IMAGE" "$(winpath "$ctx")"; local e=$?
  rm -rf "$ctx"; return $e
}

# -v flags for CACHES="name:/container/path ..." in the project's .env: named volumes kept across runs
# (Go modules, cargo registry, Gradle). Each concurrency slot gets its own copy, agent-box-<name><slot>-cache:
# two containers on one Gradle cache deadlock on its journal lock ("Timeout waiting to lock journal
# cache", RakunMiniItems 2026-10-15). A slot's volume missing is seeded once from agent-box-<name>-cache,
# so it starts warm. AGENT_BOX_SLOT_CACHES=0: every run shares agent-box-<name>-cache, as before.
# The npm cache is always mounted and shared (npm's cache is safe to share).
cache_volumes() {
  local c vol base n="${SLOT##*/}"
  CACHE_ARGS=(-v agent-box-npm-cache:/home/node/.npm)
  for c in ${CACHES:-}; do
    [[ "$c" == ?*:/?* ]] || die "CACHES entry '$c' is not name:/path"
    base="agent-box-${c%%:*}-cache"; vol="$base"
    if [ -n "$n" ] && [ "${AGENT_BOX_SLOT_CACHES:-1}" != 0 ]; then vol="agent-box-${c%%:*}$n-cache"; seed_volume "$base" "$vol"; fi
    CACHE_ARGS+=(-v "$vol:${c#*:}")
  done
}
# A new slot volume, copied from the shared one when that exists. Gradle's daemon state and journal
# locks are left behind: they belong to processes of the container that wrote them.
seed_volume() {
  dk volume inspect "$2" >/dev/null 2>&1 && return 0
  dk volume create "$2" >/dev/null || die "could not create volume $2"
  dk volume inspect "$1" >/dev/null 2>&1 || return 0
  echo "agent-box: seeding cache volume $2 from $1 (once per slot)" >&2
  dk run --rm --entrypoint sh -v "$1:/from:ro" -v "$2:/to" "$IMAGE" \
    -c 'cp -a /from/. /to/ && rm -rf /to/daemon /to/caches/journal-1/*.lock' >/dev/null 2>&1 \
    || echo "agent-box: could not seed $2; it starts empty" >&2
}

cmd_models() {
  load_project "$1"; need_key
  curl -fsS -H "Authorization: Bearer $OMNIROUTE_API_KEY" "$OMNIROUTE_HOST_URL/models" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).data||[])console.log(m.id)})'
}

cmd_clean() {
  rm -f "$BOX"/runs/*/*/parked
  local ids; ids="$(dk ps -aq --filter "label=$LABEL")"
  [ -z "$ids" ] && { echo "nothing to clean"; return; }
  dk rm -f $ids
}

# Removes parked containers (see launch): those of the named runs and of runs named <name>-*, or every
# one of the project with --all. The review loop unparks its own when it ends.
cmd_unpark() {
  load_project "$1"; shift
  local f d n c p hit
  for f in "$BOX/runs/$PROJECT"/*/parked; do
    [ -f "$f" ] || continue
    d="${f%/parked}"; n="${d##*/}"; hit=0
    for p in "$@"; do [ "$p" = --all ] || [ "$n" = "$p" ] || [[ "$n" == "$p"-* ]] && hit=1; done
    [ "$hit" = 1 ] || continue
    read -r c _ <"$f"; dk rm -f "$c" >/dev/null 2>&1 || true; rm -f "$f"
    echo "agent-box: unparked $n"
  done
}

# A finished run in a few lines (lib/brief.mjs). --full, or AGENT_BOX_FULL=1: the whole report, with the
# final agent message and token totals from OpenCode's JSON event stream.
report() {
  local dir="$1"
  if [ "${2:-}" != --full ] && [ "${AGENT_BOX_FULL:-0}" != 1 ]; then
    (cd "$BOX" && node lib/brief.mjs "$(winpath "$dir")"); return 0
  fi
  [ -f "$dir/verdict.txt" ] && { echo "== verdict"; cat "$dir/verdict.txt"; }
  echo "== summary"; cat "$dir/summary.json" 2>/dev/null || echo "(no summary.json, see harness.log)"
  [ -f "$dir/commits.txt" ] && { echo "== commits"; cat "$dir/commits.txt"; }
  [ -f "$dir/diffstat.txt" ] && { echo "== diffstat"; tail -n 1 "$dir/diffstat.txt"; }
  echo "== test tail"; tail -n 15 "$dir/test.log" 2>/dev/null || echo "(no test.log)"
  if [ -s "$dir/events.jsonl" ]; then
    node - "$(winpath "$dir/events.jsonl")" <<'EOF'
const lines = require("fs").readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
let last = "", tools = 0, tok = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }, errors = [];
for (const l of lines) {
  let e; try { e = JSON.parse(l); } catch { continue; }
  const p = e.part || {};
  if (e.type === "text" && p.text) last = p.text;
  if (e.type === "tool_use") tools++;
  if (e.type === "error") errors.push(JSON.stringify(e.error || e).slice(0, 300));
  const t = p.tokens;
  if (e.type === "step_finish" && t) {
    tok.input += t.input || 0; tok.output += t.output || 0; tok.reasoning += t.reasoning || 0;
    tok.cache_read += (t.cache && t.cache.read) || 0; tok.cache_write += (t.cache && t.cache.write) || 0;
  }
}
console.log("== agent (" + lines.length + " events, " + tools + " tool calls, tokens " + JSON.stringify(tok) + ")");
for (const e of errors) console.log("ERROR " + e);
console.log(last || "(no final text message)");
EOF
  fi
}

cmd_show() {
  load_project "$1"
  report "$BOX/runs/$PROJECT/$2" "${3:-}"
}

# Shared by run and baseline.
launch() {
  local name="$1" task="$2" base="$3" skip_agent="$4"
  local run_dir="$BOX/runs/$PROJECT/$name" branch="agent/$name"
  [ -e "$run_dir" ] && die "run $name already exists"
  git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch" && die "branch $branch already exists in $REPO"
  mkdir -p "$run_dir"

  local base_sha; base_sha="$(git -C "$REPO" rev-parse --verify "$base^{commit}")" || die "bad base $base"
  # A continued round starts on its previous head but keeps the first round's base (ORIG_BASE).
  local start_sha="$base_sha"; [ -n "${ORIG_BASE:-}" ] && base_sha="$ORIG_BASE"
  [ -n "$(git -C "$REPO" status --porcelain)" ] && echo "agent-box: note: uncommitted changes in $REPO are NOT sent; base is $base_sha" >&2
  local bundle_ref="$base"; [ "$base" = "HEAD" ] || git -C "$REPO" show-ref --quiet "$base" || bundle_ref="HEAD"
  git -C "$REPO" bundle create -q "$(winpath "$run_dir/in.bundle")" "$bundle_ref" 2>/dev/null \
    || git -C "$REPO" bundle create -q "$(winpath "$run_dir/in.bundle")" --all
  if [ -n "${CONTINUE_SESSION:-}" ]; then
    # Follow-up: no new pack. The worker already has it in its session; the message is the task.
    cp "$task" "$run_dir/message.md"
    cp "$CONTINUE_FROM/task-body.md" "$run_dir/task-body.md" 2>/dev/null || true
    cp "$CONTINUE_FROM/task.md" "$run_dir/task.md" 2>/dev/null || true
    cp "$CONTINUE_FROM/pack.json" "$run_dir/pack.json" 2>/dev/null || true
  elif [ -n "$task" ]; then
    cp "$task" "$run_dir/task.md"
    # Deterministic context pack: files, areas, governing docs, traps, terms, tests, sealed globs.
    local map="$BOX/projects/$PROJECT.context.yaml" map_arg="-"
    [ -f "$map" ] && map_arg="$(winpath "$map")"
    local meta; meta="$(node "$(winpath "$BOX/lib/pack.mjs")" "$(winpath "$REPO")" "$(winpath "$task")" \
      "$map_arg" "$(winpath "$run_dir")" "$base_sha")" || die "context pack failed"
    printf '%s\n' "$meta" >"$run_dir/pack.json"
    SEALED="$(node -e 'console.log(JSON.parse(process.argv[1]).sealed.join("\n"))' "$meta")"
    local pack_test; pack_test="$(node -e 'console.log(JSON.parse(process.argv[1]).test)' "$meta")"
    if [ -z "${TEST_FROM_FLAG:-}" ] && [ -n "$pack_test" ]; then TEST_CMD="$pack_test"; fi
    node -e 'for (const w of JSON.parse(process.argv[1]).warnings) console.error("agent-box: pack: " + w)' "$meta"
    SKILLS_ALLOW="$(node -e 'console.log(JSON.parse(process.argv[1]).skills.join(","))' "$meta")"
    # Red check (sealed tests must fail on the base) and the step budget, from the task frontmatter.
    [ "${NO_RED:-0}" = 1 ] || RED_CMD="$(node -e 'console.log(JSON.parse(process.argv[1]).red || "")' "$meta")"
    [ -n "${STEPS:-}" ] || STEPS="$(node -e 'console.log(JSON.parse(process.argv[1]).steps || "")' "$meta")"
    export SEALED TEST_CMD SKILLS_ALLOW RED_CMD STEPS
  fi
  # Everything `continue` needs to resume this run with the same model, rules and checks. SKIP_AGENT
  # first: the ledger reads a baseline from it (it was empty here, so every baseline's verdict was error).
  SKIP_AGENT="$skip_agent"
  local v; for v in MODEL EFFORT VARIANT ALLOW_WEB REVIEW SCOUT_MODEL TEST_CMD SEALED SKILLS_ALLOW TIMEOUT_MIN ASK ROLE STEPS AUTOFIX SKIP_AGENT REVIEW_TARGET PREAMBLE; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done >"$run_dir/meta.sh"
  printf 'RUN_BASE_SHA=%q\nRUN_BASE_REF=%q\nRUN_ROUND=%q\n' "$base_sha" "$bundle_ref" "${ROUND:-1}" >>"$run_dir/meta.sh"

  [ "$IMAGE" = agent-box:latest ] || dk image inspect "$IMAGE" >/dev/null 2>&1 \
    || die "no image $IMAGE: run delegate.sh build $REPO"
  # Into the container as well: the project's SYNTAX_<ext> checks and the names in CONTAINER_ENV.
  local v extra_env=()
  for v in $(compgen -v SYNTAX_) ${CONTAINER_ENV:-}; do export "${v?}"; extra_env+=(-e "$v"); done
  local cname; cname="$(cname_of "$name")"
  slot_acquire "$name"
  # Parking (AGENT_BOX_PARK=1, set by the review loop): a finished worker's container stays up, marked
  # by <run>/parked, so `continue` on its session runs the next round in it: no new container, clone,
  # setup or session restore (40-90 s a round on RakunMiniItems). A parked container holds no slot;
  # `unpark` or `clean` removes it, and a continue that cannot use it starts fresh as before.
  trap "[ -f '$run_dir/parked' ] || dk rm -f '$cname' >/dev/null 2>&1 || true; slot_release" EXIT INT TERM
  local reuse=0 pc pimg
  if [ -n "${CONTINUE_SESSION:-}" ] && [ -f "$CONTINUE_FROM/parked" ]; then
    read -r pc pimg <"$CONTINUE_FROM/parked"; rm -f "$CONTINUE_FROM/parked"
    if [ "$pimg" = "$IMAGE" ] && [ "$(dk inspect -f '{{.State.Running}}' "$pc" 2>/dev/null)" = true ] \
       && dk rename "$pc" "$cname" >/dev/null 2>&1 \
       && dk exec "$cname" sh -c 'rm -rf /out/* /out/.[!.]* /in/* 2>/dev/null; mkdir -p /in/answers'; then
      reuse=1
    else
      dk rm -f "$pc" >/dev/null 2>&1 || true
    fi
  fi
  cache_volumes
  # The real OpenCode TUI attaches to the worker when herdr shows the run (AGENT_BOX_TUI=0: feed only).
  TUI=0
  if [ "$skip_agent" != 1 ] && [ "${AGENT_BOX_TUI:-1}" != 0 ] && herdr_ok; then TUI=1; fi
  export TUI ROLE="${ROLE:-}" AUTOFIX="${AUTOFIX:-1}" HIDDEN="${HIDDEN_DIR:+1}" PREAMBLE="${PREAMBLE:-}"
  # Docker Desktop forwards host-gateway to the host's loopback, where OmniRoute listens. Podman
  # needs user-mode networking, whose host address is what the VM itself resolves (gvproxy's .254);
  # the gateway Podman would inject reaches the WSL interface, not loopback.
  local host_ip="host-gateway"
  if [ "$ENGINE" = podman ]; then
    # podman machine ssh writes its known-hosts file to "NUL", a real file under Git Bash: run it in runs/.
    host_ip="$(cd "$BOX/runs" && podman machine ssh getent hosts host.containers.internal 2>/dev/null | awk '{print $1; exit}' | tr -d '\r'; rm -f NUL)"
    [ -n "$host_ip" ] || host_ip="192.168.127.254"
  fi
  export BRANCH="$branch" BASE_SHA="$base_sha" START_SHA="$start_sha" SKIP_AGENT="$skip_agent"
  # The run's settings. A new container takes them by name; a reused one keeps its creation-time env,
  # so the round's values go to `exec` explicitly (the OmniRoute key is already in it, never on a command line).
  local envnames=(MODEL VARIANT ALLOW_WEB REVIEW REVIEW_ASK BRANCH BASE_SHA SKIP_AGENT TEST_CMD SETUP_CMD TIMEOUT_MIN SEALED
    EFFORT SCOUT_MODEL SKILLS_ALLOW START_SHA CONTINUE_SESSION ROUND ASK ASK_WAIT_S ASK_TIMEOUT_MIN RED_CMD STEPS AUTOFIX
    AUTOFIX_MIN TUI ROLE HIDDEN PREAMBLE)
  local runenv=() execenv=(-e REUSE=1)
  for v in "${envnames[@]}"; do runenv+=(-e "$v"); execenv+=(-e "$v=${!v:-}"); done
  if [ "$reuse" = 1 ]; then
    for v in $(compgen -v SYNTAX_) ${CONTAINER_ENV:-}; do execenv+=(-e "$v=${!v:-}"); done
  else
    dk run -d --init --name "$cname" --label "$LABEL" --label "agent-box.project=$PROJECT" \
      --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 --memory "${MEMORY:-8g}" \
      --add-host "host.docker.internal:$host_ip" \
      "${CACHE_ARGS[@]}" "${extra_env[@]}" -e OMNIROUTE_API_KEY -e OMNIROUTE_BASE_URL "${runenv[@]}" \
      "$IMAGE" >/dev/null
  fi
  dk cp "$(winpath "$run_dir/in.bundle")" "$cname:/in/repo.bundle"
  [ -n "${HIDDEN_DIR:-}" ] && dk cp "$(winpath "$HIDDEN_DIR")/." "$cname:/in/hidden"
  if [ -n "${CONTINUE_SESSION:-}" ]; then
    dk cp "$(winpath "$run_dir/message.md")" "$cname:/in/task.md"
    [ "$reuse" = 1 ] || dk cp "$(winpath "$CONTINUE_FROM/opencode-data.tgz")" "$cname:/in/opencode-data.tgz"
  elif [ -n "$task" ]; then
    dk cp "$(winpath "$run_dir/task-body.md")" "$cname:/in/task.md"
    dk cp "$(winpath "$run_dir/context.md")" "$cname:/in/context.md"
  fi

  [ "$skip_agent" = 1 ] || herdr_open "$name"
  echo "agent-box: $name started ($ENGINE container $cname$([ "$reuse" = 1 ] && echo ", reused from ${CONTINUE_FROM##*/}"), base ${base_sha:0:10}, model ${MODEL:-none})" >&2
  if [ "$reuse" = 1 ]; then dk exec "${execenv[@]}" "$cname" /usr/local/bin/run-task.sh || echo "agent-box: run-task exited $?" >&2
  else dk exec "$cname" /usr/local/bin/run-task.sh || echo "agent-box: run-task exited $?" >&2; fi
  dk cp "$cname:/out/." "$(winpath "$run_dir")" || echo "agent-box: could not copy /out" >&2
  rm -f "$run_dir/in.bundle"
  if [ "${AGENT_BOX_PARK:-0}" = 1 ] && [ "$skip_agent" != 1 ] && [ -f "$run_dir/summary.json" ] && [ -n "$(jq -r '.session // empty' "$run_dir/summary.json" 2>/dev/null)" ]; then
    printf '%s %s\n' "$cname" "$IMAGE" >"$run_dir/parked"
    echo "agent-box: $name parked (container $cname kept for the next round; delegate.sh unpark)" >&2
  fi

  if [ -f "$run_dir/result.bundle" ]; then
    git -C "$REPO" fetch -q "$(winpath "$run_dir/result.bundle")" "refs/heads/$branch:refs/heads/$branch" \
      && echo "agent-box: fetched into $REPO as branch $branch" >&2
  fi
  slot_release
  # Checks, verdict, next action and the ledger entry (lib/ledger.mjs, docs/ledger.md).
  if [ -f "$run_dir/summary.json" ] && [ "${LEDGER_SKIP:-0}" != 1 ]; then
    local lopts=()
    [ -n "${LEDGER_MODE:-}" ] && lopts+=(--mode "$LEDGER_MODE")
    [ -n "${LEDGER_PARENT:-}" ] && lopts+=(--parent "$LEDGER_PARENT")
    [ -n "${LEDGER_BENCH:-}" ] && lopts+=(--bench "$LEDGER_BENCH")
    [ -n "${LEDGER_FEATURE:-}" ] && lopts+=(--feature "$LEDGER_FEATURE")
    [ -n "${LEDGER_TICKET:-}" ] && lopts+=(--ticket "$LEDGER_TICKET")
    [ -n "${REVIEW_TARGET:-}" ] && lopts+=(--target "$REVIEW_TARGET")
    node "$(winpath "$BOX/lib/ledger.mjs")" finish "$(winpath "$REPO")" "$(winpath "$run_dir")" "${lopts[@]}" >"$run_dir/verdict.txt" 2>>"$run_dir/harness.log" \
      || echo "ledger: could not record this run (see harness.log)" >"$run_dir/verdict.txt"
  fi
  report "$run_dir"
}

# Concurrency slots: at most AGENT_BOX_SLOTS containers at once (default 4), whatever starts them
# (fanout, bench, ticket mode, several orchestrators). A slot whose owner process died is reclaimed.
SLOT=""
slot_acquire() {
  local d="$BOX/runs/.slots" i pid n="${AGENT_BOX_SLOTS:-4}" waited=0
  mkdir -p "$d"
  while :; do
    for i in $(seq 1 "$n"); do
      if mkdir "$d/$i" 2>/dev/null; then echo "$$ $1" >"$d/$i/owner"; SLOT="$d/$i"; return 0; fi
      read -r pid _ <"$d/$i/owner" 2>/dev/null || pid=""
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then rm -rf "$d/$i"; fi
    done
    [ "$waited" = 0 ] && echo "agent-box: $1 waits for a free slot ($n in use; AGENT_BOX_SLOTS)" >&2
    waited=1; sleep 3
  done
}
slot_release() { [ -n "$SLOT" ] && rm -rf "$SLOT"; SLOT=""; return 0; }

# Setup and a test command on any commit, no agent: a merged tree before it lands, a benchmark's hidden
# check (--hidden: files the worker never saw, copied in first). Not a run in the ledger.
cmd_check() {
  local repo="$1" ref="$2"; shift 2
  local name=""
  load_project "$repo"
  while [ $# -gt 0 ]; do
    case "$1" in
      --test) TEST_CMD="$2"; shift 2 ;;
      --hidden) HIDDEN_DIR="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$name" ] || name="check-$(date +%Y%m%d-%H%M%S)"
  export TEST_CMD
  MODEL="" LEDGER_SKIP=1 launch "$name" "" "$ref" 1 >/dev/null
  jq -r '"check \(.test_exit)"' "$BOX/runs/$PROJECT/$name/summary.json" 2>/dev/null || echo "check -1"
}

# Ticket mode (lib/ticket.mjs): to-tickets tickets, tests first, locked, implemented, reviewed, landed.
cmd_ticket_js() { local sub="$1" repo="$2"; shift 2; node "$(winpath "$BOX/lib/ticket.mjs")" "$sub" "$(winpath "$(cd "$repo" && pwd)")" "$@"; }

cmd_baseline() {
  load_project "$1"
  MODEL="" launch "baseline-$(date +%Y%m%d-%H%M%S)" "" HEAD 1
}

cmd_run() {
  local repo="$1" task="$2"; shift 2
  [ -f "$task" ] || die "task file not found: $task"
  load_project "$repo"; need_key
  local name="" base="HEAD" role="" rulings=""
  MODEL="${DEFAULT_MODEL:-}" EFFORT="" VARIANT="" ALLOW_WEB=0 REVIEW=0 ASK="${ASK:-1}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --role) role="$2"; shift 2
        local var="ROLE_${role//-/_}"
        [ -n "${!var:-}" ] || die "unknown role $role (define $var in agent-box.conf)"
        read -r MODEL EFFORT <<<"${!var}"
        case " ${READ_ONLY_ROLES:-} " in *" $role "*) REVIEW=1 ;; esac ;;
      --review) REVIEW=1; shift ;;
      --model) MODEL="$2"; EFFORT=""; shift 2 ;;
      --effort) EFFORT="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      --timeout) TIMEOUT_MIN="$2"; shift 2 ;;
      --variant) VARIANT="$2"; shift 2 ;;
      --web) ALLOW_WEB=1; shift ;;
      --no-ask) ASK=0; shift ;;
      --test) TEST_CMD="$2"; TEST_FROM_FLAG=1; shift 2 ;;
      --steps) STEPS="$2"; shift 2 ;;
      --autofix) AUTOFIX="$2"; shift 2 ;;
      --no-autofix) AUTOFIX=0; shift ;;
      --no-red) NO_RED=1; shift ;;
      --hidden) HIDDEN_DIR="$2"; shift 2 ;;          # benchmark check: files copied in before the tests
      --bench) LEDGER_BENCH="$2"; shift 2 ;;          # benchmark attempt: suite/task in the ledger
      --mode) LEDGER_MODE="$2"; shift 2 ;;
      --preamble) PREAMBLE="$2"; shift 2 ;;
      --no-spec-check) SPEC_CHECK=0; shift ;;
      --rulings) rulings="$2"; shift 2 ;;            # TEXT or @FILE: the orchestrator's answers to the spec check
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$MODEL" ] || die "no model: pass --role, --model or set DEFAULT_MODEL"
  ROLE="$role"
  # Rulings join the task itself, so the worker and every later reviewer read them as binding.
  if [ -n "$rulings" ]; then
    [[ "$rulings" == @* ]] && { [ -f "${rulings#@}" ] || die "rulings file not found: ${rulings#@}"; rulings="$(cat "${rulings#@}")"; }
    local ruled; ruled="$(mktemp --suffix=.md)"
    { cat "$task"; printf '\n\n## The orchestrator'"'"'s rulings (binding)\n\n%s\n' "$rulings"; } >"$ruled"
    task="$ruled"
  # A ticket (frontmatter `issue:`) gets a spec check first, once: questions stop here, before any code.
  elif [ "${SPEC_CHECK:-1}" != 0 ] && [ "$REVIEW" != 1 ] && [ -z "${LEDGER_BENCH:-}" ] \
     && awk 'NR==1 && $0 != "---" {exit 1} NR>1 && $0 == "---" {exit} /^issue:/ {f=1} END {exit !f}' "$task"; then
    local sc="${name:-$(date +%Y%m%d-%H%M%S)}-spec" rc=0
    # A subshell: the check loads the project again, which would reset what this run already parsed.
    (cmd_spec_check "$repo" "$task" --name "$sc" --base "$base") || rc=$?
    if [ "$rc" = 4 ]; then
      echo
      echo "verdict spec_questions  next answer_spec  (rerun with --rulings \"1: ...; 2: ...\" or --rulings @FILE; --no-spec-check to skip)"
      exit 4
    fi
  fi
  export MODEL EFFORT VARIANT ALLOW_WEB REVIEW ASK ROLE SCOUT_MODEL="${SCOUT_MODEL:-}" STEPS="${STEPS:-}" AUTOFIX="${AUTOFIX:-1}" NO_RED="${NO_RED:-0}"
  [ -n "$name" ] || name="$(date +%Y%m%d-%H%M%S)-${role:-$(echo "$MODEL" | tr -c 'a-zA-Z0-9.\n' '-' | cut -c1-30)}"
  launch "$name" "$task" "$base" 0
}

# Resumes a finished run's OpenCode session in a fresh container: same worker, same model, same
# sealed files and test, starting on its own branch. Answers a BLOCKED question, passes review
# findings, or asks for the next step. Any earlier round can be continued again, which forks it.
cmd_continue() {
  local repo="$1" from="$2"; shift 2
  local msg_file="" name="" timeout="" findings="" drop="" cause="worker_careless" text="" at="" steps=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -m|--message) text="$2"; shift 2 ;;
      -f|--file) [ -f "$2" ] || die "message file not found: $2"; text="$(cat "$2")"; shift 2 ;;
      --findings) findings="$2"; shift 2 ;;   # REVIEW-RUN[:n,m][+REVIEW-RUN...]: forward these findings
      --drop) drop="$2"; shift 2 ;;           # REVIEW-RUN:n,m: findings checked and wrong (false positives)
      --cause) cause="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      # A reviewer resumed on a newer branch (the review loop): its session, the fix's code.
      --at) at="$2"; shift 2 ;;
      --steps) steps="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$text" ] || [ -n "$findings" ] || die "continue needs -m TEXT, -f FILE or --findings REVIEW-RUN[:n,m]"
  load_project "$repo"; need_key
  msg_file="$(mktemp)"
  # Review findings go to the worker verbatim from findings.json, never retyped; the ledger records
  # which were forwarded and which were dropped as false positives.
  if [ -n "$findings" ]; then
    node "$(winpath "$BOX/lib/forward.mjs")" "$(winpath "$BOX/runs/$PROJECT")" "$findings" "$drop" "$cause" "$PROJECT" >"$msg_file" \
      || die "could not read the findings ($findings)"
  fi
  [ -n "$text" ] && printf '%s\n' "$text" >>"$msg_file"
  local prev="$BOX/runs/$PROJECT/$from"
  for f in summary.json meta.sh opencode-data.tgz; do
    [ -f "$prev/$f" ] || die "run $from cannot be continued: no $f (runs made before session saving have none)"
  done
  local session commits head
  read -r session commits head < <(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((s.session||"")+" "+s.commits+" "+s.head)' "$(winpath "$prev/summary.json")")
  [ -n "$session" ] || die "run $from recorded no session id"
  # shellcheck disable=SC1091
  . "$prev/meta.sh"
  [ -n "$timeout" ] && TIMEOUT_MIN="$timeout"
  [ -n "$steps" ] && STEPS="$steps"
  # Start where the previous round ended: its branch, or (no commits, e.g. a review or an early
  # BLOCKED) the commit it ran on, through a temporary ref so it can be bundled.
  local start="agent/$from"
  if [ -n "$at" ]; then
    [ "${REVIEW:-0}" = 1 ] || die "--at is for review runs: a worker continues on its own branch"
    git -C "$REPO" show-ref --verify --quiet "refs/heads/$at" || die "no such branch $at"
    start="refs/heads/$at"; export REVIEW_TARGET="$at"
  elif ! git -C "$REPO" show-ref --verify --quiet "refs/heads/$start"; then
    [ "$commits" = 0 ] || die "branch $start is gone from $REPO; fetch it again from $prev/result.bundle"
    start="refs/heads/agent-box-tmp/start-$from"
    git -C "$REPO" update-ref "$start" "$head" || die "commit $head is not in $REPO"
  fi
  ROUND=$(( RUN_ROUND + 1 ))
  if [ -z "$name" ]; then
    local root; root="$(sed -E 's/-r[0-9]+[a-z]?$//' <<<"$from")"
    name="$root-r$ROUND"; local k; for k in b c d e f g h; do
      [ -e "$BOX/runs/$PROJECT/$name" ] || break; name="$root-r$ROUND$k"
    done
  fi
  export MODEL EFFORT VARIANT ALLOW_WEB REVIEW SCOUT_MODEL TEST_CMD SEALED SKILLS_ALLOW TIMEOUT_MIN ROUND ASK ROLE STEPS AUTOFIX
  CONTINUE_SESSION="$session" CONTINUE_FROM="$prev" ORIG_BASE="$RUN_BASE_SHA" LEDGER_PARENT="$from" \
    launch "$name" "$msg_file" "$start" 0
  case "$start" in refs/heads/agent-box-tmp/*) git -C "$REPO" update-ref -d "$start" ;; esac
}

# Live feed of a run: harness steps, every tool call, the worker's messages. In a herdr pane it also
# reports the worker's state to herdr. Ends when the run's container is gone.
cmd_watch() {
  load_project "$1"
  local name="$2" c dir model="" role="" i
  c="$(cname_of "$name")"; dir="$BOX/runs/$PROJECT/$name"
  [ -f "$dir/meta.sh" ] && read -r model role < <(. "$dir/meta.sh"; echo "$MODEL ${ROLE:-}")
  for i in $(seq 1 60); do [ "$(dk inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && break; sleep 1; done
  # The exec ends with an error when the run removes its container: that is the normal end.
  { dk exec "$c" sh -c 'tail -n +1 -F /out/harness.log /out/events.jsonl 2>/dev/null' 2>/dev/null || true; } \
    | AB_COLS="$(stty size </dev/tty 2>/dev/null | cut -d' ' -f2)" node "$(winpath "$BOX/lib/watch.mjs")" "$name" "$model" "$role" || true
  # The verdict line comes from lib/ledger.mjs (checks + ledger), written after the container is gone.
  for i in $(seq 1 60); do [ -f "$dir/verdict.txt" ] && break; sleep 1; done
  local verdict="no verdict (run interrupted?)"
  [ -f "$dir/summary.json" ] && verdict="$(jq -r '"\(.verdict // "?"), tests \(if .test_exit == 0 then "pass" elif .test_exit == -1 then "not run" else "FAIL (\(.test_exit))" end)\(if (.autofix // 0) > 0 then " after \(.autofix) auto-fix" else "" end), \(.commits) commit(s), \(.seconds)s" + (if .blocked then ", BLOCKED: \(.blocked)" else "" end) + (if ((.flags // []) | length) > 0 then ", " + ([.flags[].flag] | join(" ")) else "" end)' "$dir/summary.json")"
  echo; printf '\e[1m== %s done: %s\e[0m\n' "$name" "$verdict"
  [ -f "$dir/summary.json" ] && jq -r '"   next: \(.next // "?")"' "$dir/summary.json"
  [ -f "$dir/diffstat.txt" ] && tail -n 1 "$dir/diffstat.txt"
  if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
    local short="${model##*/}"; short="${short%-tiered}"
    "$HERDR_BIN_PATH" pane report-agent "$HERDR_PANE_ID" --source agent-box --agent "$name${short:+ ($short)}" --state idle \
      --message "done: $verdict" --seq "$(date +%s%3N)" >/dev/null 2>&1 || true
    herdr_close_tab
  fi
}

# In a herdr tab: Enter closes it. AB_TAB_LINGER (seconds) closes it by itself: benchmarks open many tabs.
herdr_close_tab() {
  [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ] || return 0
  if [ -n "${AB_TAB_LINGER:-}" ]; then read -r -t "$AB_TAB_LINGER" -p "Enter closes this tab (or wait ${AB_TAB_LINGER}s). " _ || true
  else read -r -p "Enter closes this tab. " _ || true; fi
  if [ -n "${AB_HERDR_TAB:-}" ]; then "$HERDR_BIN_PATH" tab close "$AB_HERDR_TAB" >/dev/null 2>&1 || true
  else "$HERDR_BIN_PATH" pane close "$HERDR_PANE_ID" >/dev/null 2>&1 || true; fi
}

# Live view of a review and fix loop: rounds, what runs now and for how long, each finding with where
# the harness routed it, decisions, and what the orchestrator does when it stops. Ends when it stops.
cmd_loop_watch() {
  load_project "$1"
  local name="$2" dir="$BOX/runs/$PROJECT/_loops/$2"
  [ -d "$dir" ] || die "no loop $name in runs/$PROJECT/_loops"
  AB_COLS="$(stty size </dev/tty 2>/dev/null | cut -d' ' -f2)" \
    node "$(winpath "$BOX/lib/loopwatch.mjs")" "$(winpath "$dir/progress.jsonl")" "$name" "$REPO" || true
  herdr_close_tab
}

# The loop's own herdr tab (lib/loop.mjs opens it when the loop starts or resumes).
cmd_loop_tab() {
  load_project "$1"
  local name="$2" ws tabjson pane dir="$BOX/runs/$PROJECT/_loops/$2"
  herdr_ok && [ -d "$dir" ] || return 0
  ws="$(herdr_ws)"; [ -n "$ws" ] && [ "$ws" != null ] || return 0
  tabjson="$(herdr tab create --workspace "$ws" --label "$name" --cwd "$(winpath "$BOX")" 2>/dev/null)" || return 0
  pane="$(jq -r '.result.root_pane.pane_id' <<<"$tabjson")"
  [ -n "$pane" ] && [ "$pane" != null ] || return 0
  printf '#!/usr/bin/env bash\nexport AB_HERDR_TAB=%q AB_TAB_LINGER=%q AGENT_BOX_PROJECT_ENV=%q\nexec %q loop-watch %q %q\n' \
    "$(jq -r '.result.tab.tab_id' <<<"$tabjson")" "${AB_TAB_LINGER:-}" "${AGENT_BOX_PROJECT_ENV:-}" "$BOX/delegate.sh" "$REPO" "$name" >"$dir/watch.sh"
  herdr_launch "$pane" "$dir/watch.sh"
}

# herdr: one tab per run in an "agent-box" workspace, running `watch`. Silently does nothing when
# herdr is not installed or not running, or AGENT_BOX_HERDR=0.
herdr_ok() {
  [ "${AGENT_BOX_HERDR:-auto}" != 0 ] && command -v herdr >/dev/null \
    && herdr status server 2>/dev/null | grep -q 'status: running'
}
herdr_ws() {
  local ws
  ws="$(herdr workspace list 2>/dev/null | jq -r '.result.workspaces[] | select(.label == "agent-box") | .workspace_id' | head -n 1)"
  [ -n "$ws" ] || ws="$(herdr workspace create --label agent-box --cwd "$(winpath "$BOX")" --no-focus 2>/dev/null | jq -r '.result.workspace.workspace_id')"
  echo "$ws"
}
# Each run's tab: the real OpenCode TUI attached to the worker on the left (TUI=1), the agent-box feed
# (harness steps, tool calls, verdict; reports state to herdr) on the right.
herdr_open() {
  local name="$1" ws tabjson tab pane feed dir="$BOX/runs/$PROJECT/$1"
  herdr_ok || return 0
  ws="$(herdr_ws)"; [ -n "$ws" ] && [ "$ws" != null ] || return 0
  tabjson="$(herdr tab create --workspace "$ws" --label "$name" --cwd "$(winpath "$BOX")" 2>/dev/null)" || return 0
  tab="$(jq -r '.result.tab.tab_id' <<<"$tabjson")"; pane="$(jq -r '.result.root_pane.pane_id' <<<"$tabjson")"
  [ -n "$pane" ] && [ "$pane" != null ] || return 0
  # Script files, so no quoting has to survive the pane's shell (PowerShell on Windows).
  printf '#!/usr/bin/env bash\nexport AB_HERDR_TAB=%q AB_TAB_LINGER=%q AGENT_BOX_PROJECT_ENV=%q\nexec %q watch %q %q\n' "$tab" "${AB_TAB_LINGER:-}" "${AGENT_BOX_PROJECT_ENV:-}" "$BOX/delegate.sh" "$REPO" "$name" >"$dir/watch.sh"
  if [ "${TUI:-0}" = 1 ]; then
    printf '#!/usr/bin/env bash\nexport AGENT_BOX_PROJECT_ENV=%q\nexec %q tui %q %q\n' "${AGENT_BOX_PROJECT_ENV:-}" "$BOX/delegate.sh" "$REPO" "$name" >"$dir/tui.sh"
    feed="$(herdr pane split "$pane" --direction right --ratio "${AGENT_BOX_TUI_RATIO:-0.66}" --cwd "$(winpath "$BOX")" 2>/dev/null | jq -r '.result.pane.pane_id')"
    herdr_launch "$pane" "$dir/tui.sh"
    if [ -n "$feed" ] && [ "$feed" != null ]; then herdr_launch "$feed" "$dir/watch.sh"; fi
  else
    herdr_launch "$pane" "$dir/watch.sh"
  fi
}
herdr_launch() {
  if command -v cygpath >/dev/null; then
    herdr pane run "$1" "& '$(cygpath -w "$(command -v bash)")' -l '$(cygpath -m "$2")'" >/dev/null 2>&1 || true
  else
    herdr pane run "$1" "bash -l '$2'" >/dev/null 2>&1 || true
  fi
}

# The real OpenCode TUI, attached to a running worker's session through the OpenCode server inside its
# container (run-task.sh starts it when TUI=1). Typing into it reaches the worker: that is steering.
cmd_tui() {
  load_project "$1"
  local name="$2" c sid="" i
  c="$(cname_of "$name")"
  printf '\e[2m%s: waiting for the worker to start (setup and checks run first)...\e[0m\n' "$name"
  for i in $(seq 1 900); do
    if [ "$(dk inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" != true ]; then
      [ "$i" -gt 30 ] && break; sleep 1; continue
    fi
    sid="$(dk exec "$c" sh -c "jq -r 'select(.sessionID) | .sessionID' /out/events.jsonl 2>/dev/null | head -n 1" 2>/dev/null | tr -d '\r')"
    [ -n "$sid" ] && break
    sleep 2
  done
  if [ -n "$sid" ]; then
    dk exec -it "$c" opencode attach http://127.0.0.1:4096 --session "$sid" || true
  fi
  printf '\n%s: the worker is gone; its OpenCode session is saved for `continue`.\n' "$name"
  if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then sleep 2; "$HERDR_BIN_PATH" pane close "$HERDR_PANE_ID" >/dev/null 2>&1 || true; fi
}

# Open questions a running worker asked with ask_orchestrator. --wait blocks until one appears
# (exit 0) or the run ends (exit 1), so an orchestrator can watch a background run with it.
cmd_questions() {
  local repo="$1" name="$2" wait="${3:-}"
  load_project "$repo"
  local c out; c="$(cname_of "$name")"
  while :; do
    [ "$(dk inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || { echo "run $name is not running"; return 1; }
    out="$(dk exec "$c" sh -c 'cd /out/questions 2>/dev/null || exit 0
      for f in *.md; do
        [ -e "$f" ] || continue; case "$f" in *.answer.md) continue ;; esac
        n="${f%.md}"; [ -e "/in/answers/$n.md" ] || [ -e "$n.timeout" ] || { printf "## question %s\n" "$n"; cat "$f"; }
      done')"
    [ -n "$out" ] && { printf '%s\n' "$out"; return 0; }
    [ "$wait" = --wait ] || { echo "no open questions"; return 0; }
    sleep 5
  done
}

# Blocks until the named runs and loops end, then prints each one's short report: one background
# command for the orchestrator instead of sleep-and-tail polling. A name is a run (runs/<project>/<name>)
# or a loop (runs/<project>/_loops/<name>); a name with no folder yet is waited for (a run still
# queued for a slot). --any: return when the first one ends. --questions: also return when a running
# worker asks with ask_orchestrator. Exit 0, or 3 when --timeout MIN ran out first.
cmd_wait() {
  local repo="$1"; shift
  local any=0 asks=0 timeout="" names=() n
  while [ $# -gt 0 ]; do
    case "$1" in
      --any) any=1; shift ;;
      --questions) asks=1; shift ;;
      --timeout) timeout="$2"; shift 2 ;;
      -*) die "unknown option $1" ;;
      *) names+=("$1"); shift ;;
    esac
  done
  [ "${#names[@]}" -gt 0 ] || die "wait needs one or more run or loop names"
  load_project "$repo"
  local runs="$BOX/runs/$PROJECT" start; start=$(date +%s)
  local -A shown=()
  ended() {
    local d="$runs/_loops/$1"
    if [ -f "$d/progress.jsonl" ]; then tail -n 1 "$d/progress.jsonl" | grep -q '"ev":"end"'; return; fi
    d="$runs/$1"
    [ -f "$d/verdict.txt" ] && return 0
    [ -f "$d/summary.json" ] && [ "$(dk inspect -f '{{.State.Running}}' "$(cname_of "$1")" 2>/dev/null)" != true ]
  }
  show_one() {
    if [ -d "$runs/_loops/$1" ]; then
      echo "== loop $1"
      (cd "$BOX" && node --input-type=module -e 'import { loopBrief } from "./lib/loop.mjs"; import fs from "node:fs";
        const f = process.argv[1]; console.log(loopBrief(JSON.parse(fs.readFileSync(f, "utf8")), f));' "$(winpath "$runs/_loops/$1/state.json")")
    else
      report "$runs/$1"
    fi
  }
  while :; do
    local left=0
    for n in "${names[@]}"; do
      [ -n "${shown[$n]:-}" ] && continue
      if ended "$n"; then shown[$n]=1; show_one "$n"; echo
      else
        left=$((left + 1))
        if [ "$asks" = 1 ]; then
          # A loop asks through the runs of its current round (<loop>-fix*, <loop>-rv*): its live containers.
          local live=() r
          if [ -d "$runs/_loops/$n" ]; then
            mapfile -t live < <(dk ps --filter "label=agent-box.project=$PROJECT" --format '{{.Names}}' 2>/dev/null | tr -d '\r' \
              | sed -n "s/^agent-box-$PROJECT-//p" | grep -F -- "$n-" | grep -E "^$n-" || true)
          elif [ -d "$runs/$n" ]; then live=("$n"); fi
          for r in "${live[@]}"; do
            if cmd_questions "$repo" "$r" >"$runs/.wait-q" 2>/dev/null && ! grep -q '^no open questions' "$runs/.wait-q"; then
              echo "== $r asks:"; cat "$runs/.wait-q"; echo "answer: delegate.sh answer $REPO $r <id> -m TEXT"; return 0
            fi
          done
        fi
      fi
    done
    [ "$left" = 0 ] && return 0
    [ "$any" = 1 ] && [ "${#shown[@]}" -gt 0 ] && { echo "still running: $left"; return 0; }
    if [ -n "$timeout" ] && [ $(( $(date +%s) - start )) -ge $(( timeout * 60 )) ]; then echo "wait: ${timeout} min passed, $left still running"; return 3; fi
    sleep 10
  done
}

# Answers question <id> of a running worker. Written atomically: the worker never reads half a file.
cmd_answer() {
  local repo="$1" name="$2" id="$3"; shift 3
  local msg_file=""
  case "${1:-}" in
    -m|--message) msg_file="$(mktemp)"; printf '%s\n' "$2" >"$msg_file" ;;
    -f|--file) [ -f "$2" ] || die "answer file not found: $2"; msg_file="$2" ;;
    *) die "answer needs -m TEXT or -f FILE" ;;
  esac
  [[ "$id" =~ ^[0-9]+$ ]] || die "question id must be a number"
  load_project "$repo"
  local c; c="$(cname_of "$name")"
  dk exec -i "$c" sh -c "cat > /in/answers/.$id.tmp && mv /in/answers/.$id.tmp /in/answers/$id.md" <"$msg_file" \
    || die "could not deliver the answer (is run $name still running?)"
  echo "agent-box: answered question $id of $name"
}

# One line per run: the evidence an orchestrator selects on. Agent claims are not in it.
table() {
  local dir="$1"; shift
  printf '%-28s %-34s %5s %5s %4s %6s %s\n' run model test agent cmts secs flags
  for n in "$@"; do
    local s="$dir/$n/summary.json"
    [ -f "$s" ] || { printf '%-28s (no summary)\n' "$n"; continue; }
    node -e '
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const flags = [s.blocked && "BLOCKED", (s.sealed_violation || []).length && "SEALED-EDIT", s.review_violation && "REVIEW-EDIT"].filter(Boolean).join(",");
      console.log([process.argv[2].padEnd(28), String(s.model).padEnd(34), String(s.test_exit).padStart(5), String(s.agent_exit).padStart(5),
        String(s.commits).padStart(4), String(s.seconds).padStart(6), flags].join(" "));
    ' "$(winpath "$s")" "$n"
  done
}

# Same task, several roles in parallel, each on its own branch. Selection is the caller's: by tests,
# then by diff review, never by the workers' own reports.
cmd_fanout() {
  local repo="$1" task="$2"; shift 2
  local roles="" name="" passthru=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --roles) roles="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      *) passthru+=("$1"); shift ;;
    esac
  done
  [ -n "$roles" ] || die "fanout needs --roles a,b[,c]"
  load_project "$repo"
  herdr_ok && herdr_ws >/dev/null  # create the workspace once, before parallel runs race for it
  [ -n "$name" ] || name="fan-$(date +%Y%m%d-%H%M%S)"
  local names=() r
  for r in ${roles//,/ }; do
    "${SELF[@]}" run "$repo" "$task" --role "$r" --name "$name-$r" "${passthru[@]}" >"$BOX/runs/$PROJECT/.$name-$r.log" 2>&1 &
    names+=("$name-$r"); sleep 2
  done
  wait
  table "$BOX/runs/$PROJECT" "${names[@]}"
}

# Read-only review of a branch by several reviewers in parallel. The review task is generated: the
# changed files feed the context pack, and when the branch came from an agent-box run its original
# task is quoted so reviewers can check the change against what was asked.
# Two axes, the same prompts as ticket mode: review-spec (does it do what the spec asks, edge cases,
# tests) and review-std (the repo's standards); or, in review mode `both`, one review-both covering
# both (lib/reviewmode.mjs). Every reviewer gets the spec: the branch's own task when agent-box made
# it, plus every --spec file.
cmd_review() {
  local repo="$1" branch="$2"; shift 2
  local roles="" mode="" against="" focus="" prefix="" prior_spec="" prior_std="" prior_both="" specs=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --roles) roles="$2"; shift 2 ;;
      --review-mode) mode="$2"; shift 2 ;;
      --against) against="$2"; shift 2 ;;
      --focus) focus="$2"; shift 2 ;;
      --spec) [ -f "$2" ] || die "no such spec file $2"; specs+=("$2"); shift 2 ;;
      --name) prefix="$2"; shift 2 ;;        # review runs are named PREFIX-<role>
      # The previous round's findings for one axis, rechecked first (the review loop, lib/loop.mjs).
      --prior) [ -f "${2#*=}" ] || die "no such prior findings file ${2#*=}"
        case "$2" in spec=*) prior_spec="${2#*=}" ;; std=*) prior_std="${2#*=}" ;; both=*) prior_both="${2#*=}" ;; *) die "--prior takes spec=FILE, std=FILE or both=FILE" ;; esac
        shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  load_project "$repo"
  # After load_project: the project file may set its own REVIEW_MODE or REVIEW_ROLES.
  [ -n "$roles" ] || roles="$(node "$(winpath "$BOX/lib/reviewmode.mjs")" roles "$mode" "${REVIEW_ROLES:-}" "${REVIEW_MODE:-}")" || exit 1
  herdr_ok && herdr_ws >/dev/null
  git -C "$REPO" rev-parse --verify --quiet "$branch^{commit}" >/dev/null || die "no such branch $branch"
  [ -n "$against" ] || against="$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || echo HEAD)"
  local base; base="$(git -C "$REPO" merge-base "$against" "$branch")"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  local tdir="$BOX/runs/$PROJECT/.review-$stamp"; mkdir -p "$tdir"
  local body="$tdir/body.md" origin="$BOX/runs/$PROJECT/${branch#agent/}/task-body.md" f
  [ -f "$origin" ] || [ ${#specs[@]} -gt 0 ] || echo "agent-box: warning: no spec: $branch was not made by agent-box and no --spec was given" >&2
  {
    echo
    echo "Review the change on this branch: \`git diff $base..HEAD\` ($(git -C "$REPO" rev-list --count "$base..$branch") commits)."
    echo
    git -C "$REPO" log --format='- %h %s' "$base..$branch"
    if [ -f "$origin" ]; then
      echo; echo "## The task the change was made for"; echo; sed 's/^/> /' "$origin"
    fi
    for f in "${specs[@]}"; do
      echo; echo "## Spec: $(basename "$f")"; echo; sed 's/^/> /' "$f"
    done
    [ -n "$focus" ] && { echo; echo "Focus especially on: $focus"; }
  } >"$body"
  # The spec reviewer (and review-both) is never the implementer's family: it gets its -alt role.
  local impl="" r var alt
  [ -f "$BOX/runs/$PROJECT/${branch#agent/}/summary.json" ] \
    && impl="$(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$BOX/runs/$PROJECT/${branch#agent/}/summary.json" | head -n 1)"
  for r in review-spec review-both; do
    [ -n "$impl" ] && [[ ",$roles," == *,$r,* ]] || continue
    var="ROLE_${r//-/_}"; alt="${var}_alt"
    if [ "$(node "$(winpath "$BOX/lib/family.mjs")" use-alt "$impl" "${!var%% *}" "${!alt:-}")" = alt ]; then
      roles="$(echo ",$roles," | sed "s/,$r,/,$r-alt,/; s/^,//; s/,\$//")"
      echo "agent-box: $impl wrote this branch and $r is the same family: that review goes to $r-alt (${!alt%% *})" >&2
    fi
  done
  # Findings this project already accepted and rejected, as calibration (lib/examples.mjs). Read once,
  # so every reviewer of this round gets the same text; a ledger error never stops the review.
  local examples; examples="$(node "$(winpath "$BOX/lib/examples.mjs")" "$PROJECT" 2>/dev/null || true)"
  local names=() prompt prior
  for r in ${roles//,/ }; do
    case "$r" in
      review-spec|review-spec-alt) prompt="$BOX/lib/ticket/review-spec.md"; prior="$prior_spec" ;;
      review-std) prompt="$BOX/lib/ticket/review-standards.md"; prior="$prior_std" ;;
      review-both|review-both-alt) prompt="$BOX/lib/ticket/review-both.md"; prior="$prior_both" ;;
      *) prompt=""; prior="" ;;
    esac
    {
      echo "---"; echo "files:"; git -C "$REPO" diff --name-only "$base" "$branch" | head -n 40 | sed 's/^/  - /'; echo "---"
      [ -n "$prompt" ] && cat "$prompt"
      [ -n "$examples" ] && { echo; printf '%s\n' "$examples"; }
      [ -n "$prior" ] && { echo; cat "$prior"; }
      cat "$body"
    } >"$tdir/task-$r.md"
    local n="${prefix:-rv-$stamp}-$r"
    REVIEW_TARGET="$branch" "${SELF[@]}" run "$repo" "$tdir/task-$r.md" --role "$r" --review --base "$branch" --name "$n" --mode review ${REVIEW_STEPS:+--steps "$REVIEW_STEPS"} >"$BOX/runs/$PROJECT/.$n.log" 2>&1 &
    names+=("$n"); sleep 2
  done
  wait
  table "$BOX/runs/$PROJECT" "${names[@]}"
  for n in "${names[@]}"; do
    echo; echo "################ $n"; cat "$BOX/runs/$PROJECT/$n/final.md" 2>/dev/null || echo "(no final message)"
  done
}

# Ledger: reasons and decisions. note labels why something failed; accept/reject/merged/discard record
# the orchestrator's decision on a run (the trust ledger). refs lists what still needs a reason.
cmd_note() {
  local repo="$1" run="$2"; shift 2
  load_project "$repo"
  node "$(winpath "$BOX/lib/ledger.mjs")" note "$PROJECT" "$run" "$@"
}
cmd_outcome() {
  local result="$1" repo="$2" run="$3"; shift 3
  load_project "$repo"
  node "$(winpath "$BOX/lib/ledger.mjs")" outcome "$PROJECT" "$run" --result "$result" "$@"
}
cmd_refs() {
  load_project "$1"
  node "$(winpath "$BOX/lib/ledger.mjs")" refs "$PROJECT" "$2"
}

# The roles in effect for one project. agent-box.conf is sourced first and the project file second, so
# a line there wins; "project" marks the settings it sets.
cmd_roles() {
  load_project "$1"
  local v src name
  for v in $(compgen -v | grep -E '^(ROLE_[A-Za-z0-9_]+|REVIEW_MODE|REVIEW_ROLES|READ_ONLY_ROLES|SCOUT_MODEL|TICKET_ESCALATE_ROLE|TICKET_ESCALATE_AFTER|LOOP_MAX_ROUNDS)$'); do
    src=conf; grep -qE "^(export[[:space:]]+)?$v=" "$PROJECT_ENV" && src=project
    name="$v"; [[ "$v" == ROLE_* ]] && { name="${v#ROLE_}"; name="${name//_/-}"; }
    printf '%-22s %-8s %s\n' "$name" "$src" "${!v}"
  done
}

# First-time project files from the repo's manifests (lib/setup.mjs); never overwrites one.
cmd_setup() {
  local repo="${1:?usage: setup <repo> [--dry-run]}"; shift
  [ -d "$repo" ] || die "not a folder: $repo"
  node "$(winpath "$BOX/lib/setup.mjs")" "$(winpath "$(cd "$repo" && pwd)")" "$@"
}

# Everything the project's .env sets (the OmniRoute key only as set/empty), its image and its caches.
cmd_config() {
  load_project "$1"
  local k state=built
  [ "$IMAGE" = agent-box:latest ] || dk image inspect "$IMAGE" >/dev/null 2>&1 || state="not built: delegate.sh build $REPO"
  printf '%-22s %s\n' image "$IMAGE ($state)" caches "agent-box-npm-cache ${CACHES:-}"
  for k in $(grep -oE '^(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$PROJECT_ENV" | sed -E 's/^export[[:space:]]+//; s/=$//' | sort -u); do
    if [ "$k" = OMNIROUTE_API_KEY ]; then printf '%-22s %s\n' "$k" "$([ -n "${!k:-}" ] && echo set || echo empty)"
    else printf '%-22s %s\n' "$k" "${!k-}"; fi
  done
}

# Read-only research: a worker answers one question about the code with file:line evidence, so the
# orchestrator reads a digest instead of the files. Follow up with `continue <repo> <run> -m ...`.
cmd_explore() {
  local repo="$1" question="$2"; shift 2
  local role="explore" name="" passthru=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --role) role="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      *) passthru+=("$1"); shift ;;
    esac
  done
  load_project "$repo"
  [ -n "$name" ] || name="ex-$(date +%Y%m%d-%H%M%S)"
  local task="$BOX/runs/$PROJECT/.$name.md"
  mkdir -p "$BOX/runs/$PROJECT"
  printf '%s\n' "$question" >"$task"
  "${SELF[@]}" run "$repo" "$task" --role "$role" --review --preamble explore --mode explore --name "$name" "${passthru[@]}" >"$BOX/runs/$PROJECT/.$name.log" 2>&1 \
    || { tail -n 20 "$BOX/runs/$PROJECT/.$name.log"; die "explore run failed"; }
  local out="$BOX/runs/$PROJECT/$name"
  echo "== $name ($(jq -r '"\(.seconds)s"' "$out/summary.json" 2>/dev/null))"
  cat "$out/final.md" 2>/dev/null || echo "(no answer; see $out)"
}

# What a task leaves undecided or gets wrong against its docs, before anyone implements it: a read-only
# run on the task itself (so it gets the same context pack and issue text a worker would), DeepSeek by
# default (Opus quota stays for prose and spec reviews). RakunMiniItems #49: the task asked for a
# listener ADR 0003 gives to MythicLib; the review loop found it only after the implementation.
# Exit 0: nothing to decide; 4: questions, printed and in <run>/spec-questions.json.
cmd_spec_check() {
  local repo="$1" task="$2"; shift 2
  local role="review-spec-alt" name="" base="HEAD"
  while [ $# -gt 0 ]; do
    case "$1" in
      --role) role="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -f "$task" ] || die "task file not found: $task"
  load_project "$repo"
  [ -n "$name" ] || name="spec-$(date +%Y%m%d-%H%M%S)"
  local out="$BOX/runs/$PROJECT/$name" log="$BOX/runs/$PROJECT/.$name.log"
  SPEC_CHECK=0 AGENT_BOX_PARK=0 "${SELF[@]}" run "$repo" "$task" --role "$role" --review --no-red --no-ask --steps 30 \
    --preamble speccheck --mode speccheck --name "$name" --base "$base" >"$log" 2>&1 \
    || { tail -n 20 "$log"; die "spec check run failed"; }
  node -e '
    const fs = require("fs"), [dir] = process.argv.slice(1);
    let t = ""; try { t = fs.readFileSync(dir + "/final.md", "utf8"); } catch {}
    const b = t.match(/```[^\n`]*?(?:\r?\n[ \t]*)?agent-box-spec-questions[^\n]*\n([\s\S]*?)\n\s*```/);
    let q = null; try { q = b ? JSON.parse(b[1]) : null; } catch {}
    if (!Array.isArray(q)) { console.log("spec check: no readable agent-box-spec-questions block; see " + dir + "/final.md"); process.exit(5); }
    fs.writeFileSync(dir + "/spec-questions.json", JSON.stringify(q, null, 2));
    if (!q.length) { console.log("spec check: nothing to decide"); process.exit(0); }
    console.log(`spec check: ${q.length} point(s) to rule on before implementing`);
    for (const x of q) console.log(`\n${x.id}. [${x.kind ?? "open"}] ${x.question}\n   ${(x.options ?? []).join("\n   ")}\n   recommend: ${x.recommend ?? "-"}\n   basis: ${x.basis ?? "-"}`);
    process.exit(4);
  ' "$(winpath "$out")"
}

# Different tasks in parallel, each its own worker and branch (concurrency capped by the slots).
cmd_batch() {
  local repo="$1"; shift
  local tasks=() passthru=()
  while [ $# -gt 0 ]; do
    case "$1" in
      *.md) tasks+=("$1"); shift ;;
      *) passthru+=("$1"); shift ;;
    esac
  done
  [ "${#tasks[@]}" -gt 0 ] || die "batch needs one or more task.md files"
  load_project "$repo"
  herdr_ok && herdr_ws >/dev/null
  local stamp names=() t n; stamp="$(date +%Y%m%d-%H%M%S)"
  for t in "${tasks[@]}"; do
    n="b$stamp-$(basename "$t" .md | tr -c 'a-zA-Z0-9\n' '-' | cut -c1-30)"
    "${SELF[@]}" run "$repo" "$t" --name "$n" "${passthru[@]}" >"$BOX/runs/$PROJECT/.$n.log" 2>&1 &
    names+=("$n"); sleep 2
  done
  wait
  table "$BOX/runs/$PROJECT" "${names[@]}"
}

# Single-pass advisor: debate, critique or brainstorm with another model. No container, no tools.
cmd_ask() {
  local repo="$1"; shift
  local role="advise" model="" prompt="-" files=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --role) role="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --prompt) prompt="$2"; shift 2 ;;
      --file) files+=("$(winpath "$2")"); shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  load_project "$repo"; need_key
  if [ -z "$model" ]; then
    local var="ROLE_${role//-/_}"
    [ -n "${!var:-}" ] || die "unknown role $role"
    read -r model EFFORT <<<"${!var}"
  fi
  mkdir -p "$BOX/runs/$PROJECT/ask"
  local out; out="$BOX/runs/$PROJECT/ask/$(date +%Y%m%d-%H%M%S)-$role.md"
  [ "$prompt" = - ] || prompt="$(winpath "$prompt")"
  OMNIROUTE_HOST_URL="$OMNIROUTE_HOST_URL" EFFORT="${EFFORT:-}" \
    node "$(winpath "$BOX/lib/ask.mjs")" "$model" "$prompt" "$(winpath "$out")" "${files[@]}"
}

case "${1:-}" in
  build) shift; cmd_build "$@" ;;
  ask) shift; cmd_ask "$@" ;;
  fanout) shift; cmd_fanout "$@" ;;
  review) shift; cmd_review "$@" ;;
  models) shift; cmd_models "$@" ;;
  baseline) shift; cmd_baseline "$@" ;;
  run) shift; cmd_run "$@" ;;
  continue) shift; cmd_continue "$@" ;;
  questions) shift; cmd_questions "$@" ;;
  watch) shift; cmd_watch "$@" ;;
  loop-watch) shift; cmd_loop_watch "$@" ;;
  loop-tab) shift; cmd_loop_tab "$@" ;;
  answer) shift; cmd_answer "$@" ;;
  wait) shift; cmd_wait "$@" ;;
  show) shift; cmd_show "$@" ;;
  tui) shift; cmd_tui "$@" ;;
  note) shift; cmd_note "$@" ;;
  refs) shift; cmd_refs "$@" ;;
  roles) shift; cmd_roles "$@" ;;
  config) shift; cmd_config "$@" ;;
  setup) shift; cmd_setup "$@" ;;
  accept) shift; cmd_outcome accepted "$@" ;;
  reject) shift; cmd_outcome rejected "$@" ;;
  merged) shift; cmd_outcome merged "$@" ;;
  discard) shift; cmd_outcome discarded "$@" ;;
  explore) shift; cmd_explore "$@" ;;
  batch) shift; cmd_batch "$@" ;;
  check) shift; cmd_check "$@" ;;
  ticket) shift; repo="$1" t="$2"; shift 2; cmd_ticket_js run "$repo" "$(winpath "$t")" "$@" ;;
  ticket-review) shift; cmd_ticket_js review "$@" ;;
  land) shift; cmd_ticket_js land "$@" ;;
  feature) shift; repo="$1" f="$2" sub="${3:-status}"; shift 2; [ $# -gt 0 ] && shift
    case "$sub" in run) sub=run-feature ;; esac
    cmd_ticket_js "$sub" "$repo" "$(winpath "$f")" "$@" ;;
  defect) shift; repo="$1" f="$2"; shift 2; cmd_ticket_js defect "$repo" "$(winpath "$f")" "$@" ;;
  hunt) shift; repo="$1" f="$2"; shift 2; cmd_ticket_js hunt "$repo" "$(winpath "$f")" "$@" ;;
  loop) shift; sub=(); [ "${1:-}" = resume ] && { sub=(resume); shift; }
    repo="$1"; shift; node "$(winpath "$BOX/lib/loop.mjs")" "${sub[@]}" "$(winpath "$(cd "$repo" && pwd)")" "$@" ;;
  stats) shift; node "$(winpath "$BOX/lib/stats.mjs")" "$@" ;;
  dash) shift; node "$(winpath "$BOX/lib/stats.mjs")" tui "$@" ;;
  clean) cmd_clean ;;
  unpark) shift; cmd_unpark "$@" ;;
  spec-check) shift; cmd_spec_check "$@" ;;
  *) usage; [ -n "${1:-}" ] && exit 1 ;;
esac

#!/usr/bin/env bash
# agent-box: run an OpenCode worker on a git repo inside a disposable Docker container.
# The repo goes in as a git bundle and comes back as a git bundle. The container never sees the
# host .git, your home directory, or any credential except the project's OmniRoute key.
set -euo pipefail

BOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="agent-box:latest"
LABEL="agent-box=1"
# Container engine: docker or podman. Set AGENT_BOX_ENGINE in the environment or in agent-box.conf.
[ -f "$BOX/agent-box.conf" ] && . "$BOX/agent-box.conf"
ENGINE="${AGENT_BOX_ENGINE:-docker}"
case "$ENGINE" in docker|podman) ;; *) echo "agent-box: unknown engine $ENGINE" >&2; exit 1 ;; esac

die() { echo "agent-box: $*" >&2; exit 1; }
# The engine gets container paths verbatim; Git Bash would otherwise rewrite /in/... into C:/...
dk() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$ENGINE" "$@"; }
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

usage() {
  cat <<'EOF'
Usage: delegate.sh <command> ...

  build                          Build the worker image
  models   <repo>                List models the project's OmniRoute key can use
  baseline <repo>                Clone + setup + tests in the container, no agent
  run      <repo> <task.md> [--role R | --model M] [--review] [--name N] [--base REF] [--timeout MIN]
                            [--variant V] [--web] [--test CMD]
                                 Run one task. Result lands as branch agent/<name> in <repo>.
                                 --role picks the model from agent-box.conf. --review (or a read-only
                                 role) discards every edit and skips tests; the output is the report.
  fanout   <repo> <task.md> --roles a,b[,c] [--name N] [run options]
                                 Same task on several roles in parallel; prints a comparison table
  review   <repo> <branch> [--roles a,b] [--against REF] [--focus TEXT]
                                 Generated read-only review by several reviewers in parallel
  show     <repo> <name>         Print a finished run's report again
  clean                          Remove leftover agent-box containers

Engine: docker (default) or podman, from AGENT_BOX_ENGINE or agent-box.conf. Build once per engine.

Per-project settings: projects/<repo-folder-name-lowercase>.env (see projects/example.env)
EOF
}

# Loads projects/<name>.env into this shell. Sets PROJECT and REPO.
load_project() {
  REPO="$(cd "$1" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" || die "not a git repo: $1"
  PROJECT="$(basename "$REPO" | tr '[:upper:]' '[:lower:]')"
  local env="$BOX/projects/$PROJECT.env"
  [ -f "$env" ] || die "no project file $env (copy projects/example.env)"
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
  dk build -t "$IMAGE" "$(winpath "$BOX/image")"
}

cmd_models() {
  load_project "$1"; need_key
  curl -fsS -H "Authorization: Bearer $OMNIROUTE_API_KEY" "$OMNIROUTE_HOST_URL/models" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).data||[])console.log(m.id)})'
}

cmd_clean() {
  local ids; ids="$(dk ps -aq --filter "label=$LABEL")"
  [ -z "$ids" ] && { echo "nothing to clean"; return; }
  dk rm -f $ids
}

# Prints the final agent message and token totals from OpenCode's JSON event stream.
report() {
  local dir="$1"
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
  report "$BOX/runs/$PROJECT/$2"
}

# Shared by run and baseline.
launch() {
  local name="$1" task="$2" base="$3" skip_agent="$4"
  local run_dir="$BOX/runs/$PROJECT/$name" branch="agent/$name"
  [ -e "$run_dir" ] && die "run $name already exists"
  git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch" && die "branch $branch already exists in $REPO"
  mkdir -p "$run_dir"

  local base_sha; base_sha="$(git -C "$REPO" rev-parse --verify "$base^{commit}")" || die "bad base $base"
  [ -n "$(git -C "$REPO" status --porcelain)" ] && echo "agent-box: note: uncommitted changes in $REPO are NOT sent; base is $base_sha" >&2
  local bundle_ref="$base"; [ "$base" = "HEAD" ] || git -C "$REPO" show-ref --quiet "$base" || bundle_ref="HEAD"
  git -C "$REPO" bundle create -q "$(winpath "$run_dir/in.bundle")" "$bundle_ref" 2>/dev/null \
    || git -C "$REPO" bundle create -q "$(winpath "$run_dir/in.bundle")" --all
  if [ -n "$task" ]; then
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
    export SEALED TEST_CMD SKILLS_ALLOW
  fi

  local cname="agent-box-$PROJECT-${name//[^a-zA-Z0-9_.-]/-}"
  trap "dk rm -f '$cname' >/dev/null 2>&1 || true" EXIT INT TERM
  # Docker Desktop forwards host-gateway to the host's loopback, where OmniRoute listens. Podman
  # needs user-mode networking, whose host address is what the VM itself resolves (gvproxy's .254);
  # the gateway Podman would inject reaches the WSL interface, not loopback.
  local host_ip="host-gateway"
  if [ "$ENGINE" = podman ]; then
    # podman machine ssh writes its known-hosts file to "NUL", a real file under Git Bash: run it in runs/.
    host_ip="$(cd "$BOX/runs" && podman machine ssh getent hosts host.containers.internal 2>/dev/null | awk '{print $1; exit}' | tr -d '\r'; rm -f NUL)"
    [ -n "$host_ip" ] || host_ip="192.168.127.254"
  fi
  export BRANCH="$branch" BASE_SHA="$base_sha" SKIP_AGENT="$skip_agent"
  dk run -d --init --name "$cname" --label "$LABEL" --label "agent-box.project=$PROJECT" \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 --memory "${MEMORY:-8g}" \
    --add-host "host.docker.internal:$host_ip" \
    -v agent-box-npm-cache:/home/node/.npm \
    -e OMNIROUTE_API_KEY -e OMNIROUTE_BASE_URL -e MODEL -e VARIANT -e ALLOW_WEB -e REVIEW \
    -e BRANCH -e BASE_SHA -e SKIP_AGENT -e TEST_CMD -e SETUP_CMD -e TIMEOUT_MIN -e SEALED -e EFFORT -e SCOUT_MODEL -e SKILLS_ALLOW \
    "$IMAGE" >/dev/null
  dk cp "$(winpath "$run_dir/in.bundle")" "$cname:/in/repo.bundle"
  if [ -n "$task" ]; then
    dk cp "$(winpath "$run_dir/task-body.md")" "$cname:/in/task.md"
    dk cp "$(winpath "$run_dir/context.md")" "$cname:/in/context.md"
  fi

  echo "agent-box: $name started ($ENGINE container $cname, base ${base_sha:0:10}, model ${MODEL:-none})" >&2
  dk exec "$cname" /usr/local/bin/run-task.sh || echo "agent-box: run-task exited $?" >&2
  dk cp "$cname:/out/." "$(winpath "$run_dir")" || echo "agent-box: could not copy /out" >&2
  rm -f "$run_dir/in.bundle"

  if [ -f "$run_dir/result.bundle" ]; then
    git -C "$REPO" fetch -q "$(winpath "$run_dir/result.bundle")" "refs/heads/$branch:refs/heads/$branch" \
      && echo "agent-box: fetched into $REPO as branch $branch" >&2
  fi
  report "$run_dir"
}

cmd_baseline() {
  load_project "$1"
  MODEL="" launch "baseline-$(date +%Y%m%d-%H%M%S)" "" HEAD 1
}

cmd_run() {
  local repo="$1" task="$2"; shift 2
  [ -f "$task" ] || die "task file not found: $task"
  load_project "$repo"; need_key
  local name="" base="HEAD" role=""
  MODEL="${DEFAULT_MODEL:-}" EFFORT="" VARIANT="" ALLOW_WEB=0 REVIEW=0
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
      --test) TEST_CMD="$2"; TEST_FROM_FLAG=1; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$MODEL" ] || die "no model: pass --role, --model or set DEFAULT_MODEL"
  export MODEL EFFORT VARIANT ALLOW_WEB REVIEW SCOUT_MODEL="${SCOUT_MODEL:-}"
  [ -n "$name" ] || name="$(date +%Y%m%d-%H%M%S)-${role:-$(echo "$MODEL" | tr -c 'a-zA-Z0-9.\n' '-' | cut -c1-30)}"
  launch "$name" "$task" "$base" 0
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
  [ -n "$name" ] || name="fan-$(date +%Y%m%d-%H%M%S)"
  local names=() r
  for r in ${roles//,/ }; do
    "$0" run "$repo" "$task" --role "$r" --name "$name-$r" "${passthru[@]}" >"$BOX/runs/$PROJECT/.$name-$r.log" 2>&1 &
    names+=("$name-$r"); sleep 2
  done
  wait
  table "$BOX/runs/$PROJECT" "${names[@]}"
}

# Read-only review of a branch by several reviewers in parallel. The review task is generated: the
# changed files feed the context pack, and when the branch came from an agent-box run its original
# task is quoted so reviewers can check the change against what was asked.
cmd_review() {
  local repo="$1" branch="$2"; shift 2
  local roles="${REVIEW_ROLES:-review,review-alt}" against="" focus=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --roles) roles="$2"; shift 2 ;;
      --against) against="$2"; shift 2 ;;
      --focus) focus="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  load_project "$repo"
  git -C "$REPO" rev-parse --verify --quiet "$branch^{commit}" >/dev/null || die "no such branch $branch"
  [ -n "$against" ] || against="$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || echo HEAD)"
  local base; base="$(git -C "$REPO" merge-base "$against" "$branch")"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  local tdir="$BOX/runs/$PROJECT/.review-$stamp"; mkdir -p "$tdir"
  local task="$tdir/task.md" origin="$BOX/runs/$PROJECT/${branch#agent/}/task-body.md"
  {
    echo "---"
    echo "files:"; git -C "$REPO" diff --name-only "$base" "$branch" | sed 's/^/  - /'
    echo "---"
    echo "Review the change on this branch: \`git diff $base..HEAD\` ($(git -C "$REPO" rev-list --count "$base..$branch") commits)."
    echo
    git -C "$REPO" log --format='- %h %s' "$base..$branch"
    if [ -f "$origin" ]; then
      echo; echo "The change was made for this task. Check that it does what was asked, no more and no less:"; echo
      sed 's/^/> /' "$origin"
    fi
    echo
    echo "Look for: correctness bugs the change introduces, requirements it misses, rules from the context pack it breaks,"
    echo "tests that were weakened or that do not prove what their names claim, and edge cases on the changed lines."
    [ -n "$focus" ] && { echo; echo "Focus especially on: $focus"; }
  } >"$task"
  local names=() r
  for r in ${roles//,/ }; do
    local n="rv-$stamp-$r"
    "$0" run "$repo" "$task" --role "$r" --review --base "$branch" --name "$n" >"$BOX/runs/$PROJECT/.$n.log" 2>&1 &
    names+=("$n"); sleep 2
  done
  wait
  table "$BOX/runs/$PROJECT" "${names[@]}"
  for n in "${names[@]}"; do
    echo; echo "################ $n"; cat "$BOX/runs/$PROJECT/$n/final.md" 2>/dev/null || echo "(no final message)"
  done
}

case "${1:-}" in
  build) cmd_build ;;
  fanout) shift; cmd_fanout "$@" ;;
  review) shift; cmd_review "$@" ;;
  models) shift; cmd_models "$@" ;;
  baseline) shift; cmd_baseline "$@" ;;
  run) shift; cmd_run "$@" ;;
  show) shift; cmd_show "$@" ;;
  clean) cmd_clean ;;
  *) usage; [ -n "${1:-}" ] && exit 1 ;;
esac

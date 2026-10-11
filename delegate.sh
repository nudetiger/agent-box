#!/usr/bin/env bash
# agent-box: run an OpenCode worker on a git repo inside a disposable Docker container.
# The repo goes in as a git bundle and comes back as a git bundle. The container never sees the
# host .git, your home directory, or any credential except the project's OmniRoute key.
set -euo pipefail

BOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="agent-box:latest"
LABEL="agent-box=1"

die() { echo "agent-box: $*" >&2; exit 1; }
# Docker gets container paths verbatim; Git Bash would otherwise rewrite /in/... into C:/...
dk() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" docker "$@"; }
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

usage() {
  cat <<'EOF'
Usage: delegate.sh <command> ...

  build                          Build the worker image
  models   <repo>                List models the project's OmniRoute key can use
  baseline <repo>                Clone + setup + tests in the container, no agent
  run      <repo> <task.md> [--model M] [--name N] [--base REF] [--timeout MIN] [--variant V] [--web] [--test CMD]
                                 Run one task. Result lands as branch agent/<name> in <repo>
  show     <repo> <name>         Print a finished run's report again
  clean                          Remove leftover agent-box containers

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
  [ -n "$task" ] && cp "$task" "$run_dir/task.md"

  local cname="agent-box-$PROJECT-${name//[^a-zA-Z0-9_.-]/-}"
  trap "dk rm -f '$cname' >/dev/null 2>&1 || true" EXIT INT TERM
  export BRANCH="$branch" BASE_SHA="$base_sha" SKIP_AGENT="$skip_agent"
  dk run -d --init --name "$cname" --label "$LABEL" --label "agent-box.project=$PROJECT" \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 --memory "${MEMORY:-8g}" \
    --add-host host.docker.internal:host-gateway \
    -v agent-box-npm-cache:/home/node/.npm \
    -e OMNIROUTE_API_KEY -e OMNIROUTE_BASE_URL -e MODEL -e VARIANT -e ALLOW_WEB \
    -e BRANCH -e BASE_SHA -e SKIP_AGENT -e TEST_CMD -e SETUP_CMD -e TIMEOUT_MIN \
    "$IMAGE" >/dev/null
  dk cp -q "$(winpath "$run_dir/in.bundle")" "$cname:/in/repo.bundle"
  [ -n "$task" ] && dk cp -q "$(winpath "$run_dir/task.md")" "$cname:/in/task.md"

  echo "agent-box: $name started (container $cname, base ${base_sha:0:10}, model ${MODEL:-none})" >&2
  dk exec "$cname" /usr/local/bin/run-task.sh || echo "agent-box: run-task exited $?" >&2
  dk cp -q "$cname:/out/." "$(winpath "$run_dir")" || echo "agent-box: could not copy /out" >&2
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
  local name="" base="HEAD"
  MODEL="${DEFAULT_MODEL:-}" VARIANT="" ALLOW_WEB=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --model) MODEL="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      --timeout) TIMEOUT_MIN="$2"; shift 2 ;;
      --variant) VARIANT="$2"; shift 2 ;;
      --web) ALLOW_WEB=1; shift ;;
      --test) TEST_CMD="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$MODEL" ] || die "no model: pass --model or set DEFAULT_MODEL"
  export MODEL VARIANT ALLOW_WEB
  [ -n "$name" ] || name="$(date +%Y%m%d-%H%M%S)-$(echo "$MODEL" | tr -c 'a-zA-Z0-9.\n' '-' | cut -c1-30)"
  launch "$name" "$task" "$base" 0
}

case "${1:-}" in
  build) cmd_build ;;
  models) shift; cmd_models "$@" ;;
  baseline) shift; cmd_baseline "$@" ;;
  run) shift; cmd_run "$@" ;;
  show) shift; cmd_show "$@" ;;
  clean) cmd_clean ;;
  *) usage; [ -n "${1:-}" ] && exit 1 ;;
esac

set -euo pipefail
export AGENT_BOX_PARK=1
export ORIG_BASE=5c671a9fbd67fe903c215692eae0376ec8ae3746
bash /c/Workspace/Tools/agent-box/delegate.sh run /c/Workspace/Projects/MinecraftPlugins/RakunLoots /c/Workspace/Tools/agent-box/tasks-rakunloots-107-hard.md --role implement-hard --base codex/phase9-107-gemini-saved --name p9-107-hard --no-spec-check --timeout 40
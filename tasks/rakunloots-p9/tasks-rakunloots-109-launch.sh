set -euo pipefail
export AGENT_BOX_PARK=1
bash /c/Workspace/Tools/agent-box/delegate.sh run /c/Workspace/Projects/MinecraftPlugins/RakunLoots /c/Workspace/Tools/agent-box/tasks-rakunloots-109.md --role implement-hard --base codex/phase9-109-ready --name p9-109-impl --timeout 45 --rulings @/c/Workspace/Tools/agent-box/tasks-rakunloots-109-rulings.txt

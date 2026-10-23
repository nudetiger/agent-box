set -euo pipefail
export AGENT_BOX_PARK=1
bash /c/Workspace/Tools/agent-box/delegate.sh run /c/Workspace/Projects/MinecraftPlugins/RakunLoots /c/Workspace/Tools/agent-box/tasks-rakunloots-108.md --role implement-hard --base codex/phase9-108-spec --name p9-108-impl --timeout 40 --rulings @/c/Workspace/Tools/agent-box/tasks-rakunloots-108-rulings.txt

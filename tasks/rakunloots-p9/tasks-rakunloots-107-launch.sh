#!/usr/bin/env bash
set -euo pipefail
export AGENT_BOX_PARK=1
bash /c/Workspace/Tools/agent-box/delegate.sh run /c/Workspace/Projects/MinecraftPlugins/RakunLoots /c/Workspace/Tools/agent-box/tasks-rakunloots-107.md --role implement --base codex/phase9-107-spec --name p9-107-impl2 --rulings @/c/Workspace/Tools/agent-box/tasks-rakunloots-107-rulings.txt
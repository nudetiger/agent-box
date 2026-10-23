#!/usr/bin/env bash
set -euo pipefail
export AGENT_BOX_PARK=1
bash C:/Workspace/Tools/agent-box/delegate.sh run C:/Workspace/Projects/MinecraftPlugins/RakunLoots C:/Workspace/Tools/agent-box/tasks-p9-review-fixes.md --role implement-hard --base 429acbcaf0118a8429b93f76079c19dd3ce24b7b --name p9-review-fixes-impl --steps 85 --timeout 40 --rulings @C:/Workspace/Tools/agent-box/tasks-p9-review-fixes-rulings.txt

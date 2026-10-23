#!/usr/bin/env bash
set -e
BOX=C:/Workspace/Tools/agent-box
"$BOX/delegate.sh" run C:/Workspace/Projects/MinecraftPlugins/RakunLoots "$BOX/tasks-p9-full-code-review.md" --role review-both --review --base 008664dc6b2a17d44ceeb8addcbb387e1ad095b4 --name p9-full-code-rereview --mode review --steps 180 --timeout 60 --no-autofix

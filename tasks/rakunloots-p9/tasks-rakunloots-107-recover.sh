set -euo pipefail
cd /c/Workspace/Projects/MinecraftPlugins/RakunLoots
export GIT_INDEX_FILE=/c/Workspace/Tools/agent-box/rakunloots-107-recovery.index
git read-tree codex/phase9-107-spec-fixed
git --work-tree=C:/Workspace/Tools/agent-box/runs/rakunloots/p9-107-impl2-recovery add -A -- src
tree=$(git write-tree)
commit=$(printf '%s\n' 'Preserve Gemini chance implementation on the corrected raw-roll acceptance base for continued work (#107)' | git commit-tree "$tree" -p codex/phase9-107-spec-fixed)
git update-ref refs/heads/codex/phase9-107-recovered "$commit"
echo "$commit"
git diff --stat codex/phase9-107-spec-fixed "$commit"
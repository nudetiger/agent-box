set -euo pipefail
cd /c/Workspace/Projects/MinecraftPlugins/RakunLoots
export GIT_INDEX_FILE=/c/Workspace/Tools/agent-box/rakunloots-107-fixed.index
git read-tree codex/phase9-107-spec
git add src/test/java/me/rakkoon69/rakunloots/roll/Phase9ChanceAcceptanceTest.java src/test/java/me/rakkoon69/rakunloots/config/RawRollFixture.java
tree=$(git write-tree)
commit=$(printf '%s\n' 'Construct the hidden-entry chance fixture as a raw roll, preserving the loader that skips zero weights (#107)' | git commit-tree "$tree" -p codex/phase9-107-spec)
git update-ref refs/heads/codex/phase9-107-spec-fixed "$commit"
echo "$commit"
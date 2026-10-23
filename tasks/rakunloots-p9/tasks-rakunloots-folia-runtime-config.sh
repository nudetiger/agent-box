set -euo pipefail
MSYS_NO_PATHCONV=1 podman exec rakunloots-test-runtime-config mkdir -p /home/node/.gradle/init.d
MSYS_NO_PATHCONV=1 podman cp C:/Workspace/Tools/agent-box/tasks-rakunloots-folia-test-runtime.gradle rakunloots-test-runtime-config:/home/node/.gradle/init.d/rakunloots-folia-test-runtime.gradle
podman rm -f rakunloots-test-runtime-config
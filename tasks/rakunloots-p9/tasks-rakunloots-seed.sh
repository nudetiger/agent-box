set -euo pipefail
podman volume create agent-box-m21-cache >/dev/null
MSYS_NO_PATHCONV=1 podman run -d --name rakunloots-m2-seed --user root -v agent-box-m21-cache:/home/node/.m2 agent-box:latest >/dev/null
MSYS_NO_PATHCONV=1 podman cp C:/Users/Admin/.m2/repository/org/spigotmc rakunloots-m2-seed:/home/node/.m2/repository-spigotmc
MSYS_NO_PATHCONV=1 podman exec --user root rakunloots-m2-seed bash -c 'mkdir -p /home/node/.m2/repository/org; mv /home/node/.m2/repository-spigotmc /home/node/.m2/repository/org/spigotmc; chown -R node:node /home/node/.m2'
podman rm -f rakunloots-m2-seed
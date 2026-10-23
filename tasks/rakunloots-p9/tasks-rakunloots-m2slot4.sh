set -euo pipefail
MSYS_NO_PATHCONV=1 podman run --rm --user root --entrypoint bash -v agent-box-m21-cache:/seed:ro -v agent-box-m24-cache:/dest agent-box:latest -c 'cp -a /seed/. /dest/'
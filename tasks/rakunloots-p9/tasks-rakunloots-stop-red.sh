set -euo pipefail
phase=$(MSYS_NO_PATHCONV=1 podman exec agent-box-rakunloots-p9-107-impl cat /out/phase)
case "$phase" in red*) podman stop --time 10 agent-box-rakunloots-p9-107-impl ;; *) echo "Not stopping: phase $phase"; exit 2 ;; esac
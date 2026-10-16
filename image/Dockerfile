# agent-box base worker image: Node, git, the search tools and OpenCode. No credentials are baked in.
# A project that needs more (a JDK, Go, Rust, CMake) adds it in projects/<repo>.Dockerfile, FROM this
# image, built by `delegate.sh build <repo>`. make, g++ and python3 stay: node-gyp builds need them.
FROM node:24-bookworm

ARG OPENCODE_VERSION=1.19.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq ripgrep python3 make g++ ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" && npm cache clean --force

COPY run-task.sh /usr/local/bin/run-task.sh
COPY changed-tests.sh /opt/agent-box/changed-tests.sh
COPY preamble.md preamble-review.md preamble-explore.md preamble-speccheck.md make-config.mjs ask-mcp.mjs progress.mjs syntax-check.mjs last-stop.mjs recover-final.mjs /opt/agent-box/
COPY plugin.js /home/node/.config/opencode/plugins/agent-box.js
COPY skills/ /home/node/.config/opencode/skills/
RUN chmod 755 /usr/local/bin/run-task.sh /opt/agent-box/changed-tests.sh \
 && mkdir -p /work /in /out /home/node/.npm \
 && chown -R node:node /work /in /out /home/node

USER node
ENV OPENCODE_DISABLE_AUTOUPDATE=1
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]

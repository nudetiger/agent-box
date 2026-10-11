# agent-box worker image: Node toolchain + OpenCode. No credentials are baked in.
FROM node:24-bookworm

ARG OPENCODE_VERSION=1.19.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq ripgrep python3 make g++ ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" && npm cache clean --force

COPY run-task.sh /usr/local/bin/run-task.sh
COPY preamble.md /opt/agent-box/preamble.md
RUN chmod 755 /usr/local/bin/run-task.sh \
 && mkdir -p /work /in /out /home/node/.npm \
 && chown -R node:node /work /in /out /home/node

USER node
ENV OPENCODE_DISABLE_AUTOUPDATE=1
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]

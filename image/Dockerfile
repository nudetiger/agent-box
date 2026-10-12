# agent-box worker image: Node, JDK 17 and OpenCode. No credentials are baked in.
# JDK 17 launches Gradle wrappers; a build's toolchain JDK (e.g. 25) downloads once into the gradle cache volume.
FROM node:24-bookworm

ARG OPENCODE_VERSION=1.19.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq ripgrep python3 make g++ ca-certificates curl openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" && npm cache clean --force

COPY run-task.sh /usr/local/bin/run-task.sh
COPY preamble.md preamble-review.md make-config.mjs /opt/agent-box/
COPY skills/ /home/node/.config/opencode/skills/
RUN chmod 755 /usr/local/bin/run-task.sh \
 && mkdir -p /work /in /out /home/node/.npm /home/node/.gradle \
 && chown -R node:node /work /in /out /home/node

USER node
ENV OPENCODE_DISABLE_AUTOUPDATE=1
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]

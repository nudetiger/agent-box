# Copy to projects/<repo>.Dockerfile, keep what the project needs, then: ./delegate.sh build <repo>
# The build sees only this file (no context folder). Each cache directory must exist and belong to node,
# or the named volume mounts root-owned; list it in CACHES in the project's .env.
FROM agent-box:latest
USER root

# Go. CACHES="go:/home/node/go gobuild:/home/node/.cache/go-build"
# RUN curl -fsSL https://go.dev/dl/go1.25.1.linux-amd64.tar.gz | tar -C /usr/local -xz \
#  && mkdir -p /home/node/go /home/node/.cache/go-build && chown -R node:node /home/node/go /home/node/.cache
# ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH

# Rust. CACHES="cargo:/home/node/.cargo/registry"
# USER node
# RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal && mkdir -p /home/node/.cargo/registry
# ENV PATH=/home/node/.cargo/bin:$PATH
# USER root

# C/C++ with CMake (g++ and make are already in the base).
# RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build clang-format \
#  && rm -rf /var/lib/apt/lists/*

# Java with Gradle. CACHES="gradle:/home/node/.gradle"
# RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
#  && rm -rf /var/lib/apt/lists/* && mkdir -p /home/node/.gradle && chown node:node /home/node/.gradle

USER node

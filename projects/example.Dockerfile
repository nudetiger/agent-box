# Copy to projects/<repo>.Dockerfile and uncomment what the project needs, or let `delegate.sh setup <repo>`
# write it. Then: delegate.sh build <repo>. The build sees only this file. Generated: node lib/setup.mjs --example
FROM agent-box:latest
USER root

# Go (official image). CACHES: go, gobuild.
# COPY --from=golang:1-bookworm /usr/local/go /usr/local/go
# ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH
# RUN echo 'export PATH=/usr/local/go/bin:/home/node/go/bin:$PATH' > /etc/profile.d/go.sh \
#  && mkdir -p /home/node/go /home/node/.cache/go-build && chown -R node:node /home/node/go /home/node/.cache

# Rust (official image): the toolchain read-only, the cargo home writable. CACHES: cargo.
# COPY --from=rust:1-bookworm /usr/local/rustup /usr/local/rustup
# COPY --from=rust:1-bookworm /usr/local/cargo/bin /usr/local/cargo/bin
# target/ outside the repo, so a build never shows up as the worker's change.
# ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/home/node/.cargo CARGO_TARGET_DIR=/tmp/cargo-target PATH=/usr/local/cargo/bin:$PATH
# RUN echo 'export PATH=/usr/local/cargo/bin:$PATH' > /etc/profile.d/rust.sh && rustup component add rustfmt \
#  && mkdir -p /home/node/.cargo/registry && chown -R node:node /home/node/.cargo

# C/C++ with CMake (g++ and make are in the base).
# RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build && rm -rf /var/lib/apt/lists/*

# A JDK to launch Gradle or Maven; a build's toolchain JDK downloads into the cache. CACHES: gradle or m2.
# RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/* \
#  && mkdir -p /home/node/.gradle /home/node/.m2 && chown -R node:node /home/node/.gradle /home/node/.m2

# Maven, with the JDK block above.
# RUN apt-get update && apt-get install -y --no-install-recommends maven && rm -rf /var/lib/apt/lists/*

# Python: a venv per run under /tmp. CACHES: pip.
# RUN apt-get update && apt-get install -y --no-install-recommends python3-venv python3-pip && rm -rf /var/lib/apt/lists/* \
#  && mkdir -p /home/node/.cache/pip && chown -R node:node /home/node/.cache

USER node

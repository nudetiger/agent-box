# Written by delegate.sh setup. Build with: delegate.sh build <repo>
FROM agent-box:latest
USER root

# A JDK to launch Gradle or Maven; a build's toolchain JDK downloads into the cache. CACHES: gradle or m2.
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/node/.gradle /home/node/.m2 && chown -R node:node /home/node/.gradle /home/node/.m2

USER node

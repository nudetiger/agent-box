# RakunMiniItems: Paper plugin, Java 25 through the Gradle toolchain. JDK 17 launches the Gradle wrapper;
# the toolchain JDK 25 and the dependencies download once into the gradle cache (CACHES in the .env).
FROM agent-box:latest
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/node/.gradle && chown node:node /home/node/.gradle
USER node

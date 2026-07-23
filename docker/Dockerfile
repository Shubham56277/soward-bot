FROM ghcr.io/lavalink-devs/lavalink:4

USER root
COPY application.yml /opt/Lavalink/application.yml
RUN mkdir -p /opt/Lavalink/plugins /opt/Lavalink/logs \
    && chown -R lavalink:lavalink /opt/Lavalink
USER lavalink

EXPOSE 2333
ENTRYPOINT ["java", "-jar", "Lavalink.jar"]

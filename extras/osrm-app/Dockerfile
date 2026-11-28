FROM ghcr.io/project-osrm/osrm-backend:v26.7.0-debian
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates jq osmium-tool \
 && rm -rf /var/lib/apt/lists/*
COPY run.sh /run.sh
RUN chmod +x /run.sh
ENTRYPOINT ["/run.sh"]

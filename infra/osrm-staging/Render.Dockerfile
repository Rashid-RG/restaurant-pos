# Self-contained Sri Lanka OSRM MLD router for a separate staging-only Render
# Docker service. The OSM snapshot and prepared graph are baked into the image
# at BUILD time so ephemeral service filesystems do not lose the route graph.
FROM alpine:3.21 AS download
RUN apk add --no-cache ca-certificates curl \
  && mkdir -p /data \
  && curl --fail --location --silent --show-error --retry 4 \
       --connect-timeout 25 --max-time 600 \
       https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf \
       -o /data/sri-lanka.osm.pbf \
  && test "$(wc -c < /data/sri-lanka.osm.pbf)" -gt 10000000

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS preprocess
COPY --from=download /data/sri-lanka.osm.pbf /data/sri-lanka.osm.pbf
RUN osrm-extract --threads 2 -p /opt/car.lua /data/sri-lanka.osm.pbf \
  && osrm-partition --threads 2 /data/sri-lanka.osrm \
  && osrm-customize --threads 2 /data/sri-lanka.osrm \
  && rm -f /data/sri-lanka.osm.pbf

FROM node:24-bookworm-slim AS node-runtime
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --chown=65532:65532 --from=preprocess /data /data
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY gateway.mjs /app/gateway.mjs
COPY route-smoke.mjs /app/route-smoke.mjs
COPY render-start.sh /app/render-start.sh
ENV PORT=10000 OSRM_INTERNAL_URL=http://127.0.0.1:5000
EXPOSE 10000
USER 65532:65532
ENTRYPOINT ["/bin/sh", "/app/render-start.sh"]

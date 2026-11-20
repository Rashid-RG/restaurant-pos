#!/bin/sh
set -eu
# Only the authenticated Node gateway is reachable from Render's HTTPS edge.
# OSRM itself must never listen on 0.0.0.0.
osrm-routed --algorithm mld --ip 127.0.0.1 --port 5000 --threads 1 \
  --mmap /data/sri-lanka.osrm &
engine_pid=$!
trap 'kill "$engine_pid" 2>/dev/null || true' TERM INT EXIT
node /app/gateway.mjs

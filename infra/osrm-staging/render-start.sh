#!/bin/sh
set -eu
# OSRM is private; only the authenticated gateway binds Render's public port.
osrm-routed --algorithm mld --ip 127.0.0.1 --port 5000 --threads 1 \
  --mmap on /data/sri-lanka.osrm &
engine_pid=$!
node /app/gateway.mjs &
gateway_pid=$!
stop_children() {
  kill "$gateway_pid" "$engine_pid" 2>/dev/null || true
}
trap stop_children TERM INT EXIT
ready=0
attempt=0
while [ "$attempt" -lt 25 ]; do
  if node /app/route-smoke.mjs; then
    ready=1
    break
  fi
  if ! kill -0 "$engine_pid" 2>/dev/null || ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo '[OSRM] Engine or secure gateway exited before startup verification' >&2
    break
  fi
  attempt=$((attempt+1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo '[OSRM] Staging routing startup verification failed' >&2
  exit 1
fi
echo '[OSRM] Sri Lanka engine and authenticated gateway verified'
# Exit nonzero if either the engine or the gateway terminates.
while kill -0 "$engine_pid" 2>/dev/null && kill -0 "$gateway_pid" 2>/dev/null; do
  sleep 10
done
echo '[OSRM] Routing process exited; forcing container restart' >&2
exit 1

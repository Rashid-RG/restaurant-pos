#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -r .env ]]; then echo "Missing .env" >&2; exit 1; fi
set -a
# .env only contains trusted administrator-created key=value variables
source ./.env
set +a
[[ -n "${ROUTING_HOST:-}" && -n "${GASTROFLOW_ROUTING_KEY:-}" ]] || { echo "Missing routing host/key" >&2; exit 1; }
# Negombo sample route: real OSRM result, not a synthetic ETA.
url="https://${ROUTING_HOST}/route/v1/driving/79.8387,7.2083;79.8612,6.9271?overview=false&steps=false"
status="$(curl --silent --show-error --max-time 15 --output /tmp/gastroflow-routing-smoke.json \
  --write-out '%{http_code}' --header "X-GastroFlow-Routing-Key: ${GASTROFLOW_ROUTING_KEY}" "$url")"
if [[ "$status" != 200 ]]; then echo "Authorized routing request failed: HTTP $status" >&2; exit 1; fi
python3 -c 'import json,sys; j=json.load(open("/tmp/gastroflow-routing-smoke.json")); routes=j.get("routes") or []; ok=j.get("code")=="Ok" and bool(routes) and routes[0].get("duration",0)>0; print("Validated route:",routes[0].get("duration",0),"seconds") if ok else None; sys.exit(0 if ok else 1)'
denied="$(curl --silent --output /dev/null --max-time 15 --write-out '%{http_code}' "https://${ROUTING_HOST}/route/v1/driving/79.8387,7.2083;79.8612,6.9271?overview=false")"
if [[ "$denied" != 403 ]]; then echo "Security check failed: route is accessible without key (HTTP $denied)" >&2; exit 1; fi
echo "Routing HTTPS and authorization checks passed."
rm -f /tmp/gastroflow-routing-smoke.json

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

mkdir -p data
chmod 750 data
echo "Checking disk capacity before processing road data..."
free_kib="$(df -Pk data | awk 'NR==2 {print $4}')"
if (( free_kib < 12*1024*1024 )); then
  echo "At least 12 GiB free disk is required before processing. Check df -h." >&2
  exit 1
fi
source_url="https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf"
if [[ ! -s data/sri-lanka-latest.osm.pbf ]]; then
  curl --fail --location --retry 3 --connect-timeout 15 \
    --output data/sri-lanka-latest.osm.pbf.part "$source_url"
  mv data/sri-lanka-latest.osm.pbf.part data/sri-lanka-latest.osm.pbf
fi

# Memory-heavy preprocessing is sequential and runs before routing is brought online.
# The container uses the same image/profile as the runtime.
echo "OSRM: extract Sri Lanka driving network"
docker compose run --rm --no-deps osrm osrm-extract -p /opt/car.lua /data/sri-lanka-latest.osm.pbf
echo "OSRM: partition"
docker compose run --rm --no-deps osrm osrm-partition /data/sri-lanka-latest.osrm
echo "OSRM: customize"
docker compose run --rm --no-deps osrm osrm-customize /data/sri-lanka-latest.osrm
echo "OSRM dataset processed. Do not start the service before configuring .env and DNS."

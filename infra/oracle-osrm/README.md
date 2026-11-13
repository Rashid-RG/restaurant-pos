# GastroFlow — Oracle Always Free routing pilot (staging only)

**Scope:** Independent Sri Lanka road-routing server on Oracle Cloud Infrastructure. **Do not migrate POS database or sales data.** Render remains the running staging and production host until an explicitly approved, separately tested cutover.

## Resource prerequisites
- Create an OCI **Always Free** VM, shape `VM.Standard.A1.Flex` with Ubuntu (ARM64), approximately **2 OCPUs and 12 GB RAM** if your free quota and region permit. Oracle's current Always Free A1 equivalent is 2 OCPUs / 12 GB RAM, not a guaranteed 4 OCPUs / 24 GB. Boot volume 50+ GB; OCI Always Free block/boot storage is a combined quota.
- Choose the Oracle account's **home region** (required for Always Free) and select an availability domain with capacity. A1 availability is not guaranteed.
- Assign a reserved public IP only if you have confirmed current OCI pricing/eligibility. A temporary public IP is acceptable for initial testing.
- Configure OCI subnet security **inbound 80/tcp and 443/tcp** for Caddy TLS; **22/tcp only from your admin IP**. Never expose 5000/tcp, 5432/tcp or any database. Ubuntu's local firewall must also allow only the expected ports. Use SSH public keys, not a password.
- Choose a real DNS hostname such as `routing-staging.yourdomain.tld`. Create an A record pointing to the Oracle VM public address. Do **not** use an example.com hostname.
- The VM must have outbound HTTPS for downloads, ACME TLS certificate issuance, and OS updates.
- Keep independent backups. Oracle Always Free infrastructure is not a production uptime guarantee.

## Deploy only the routing server
On the Oracle Ubuntu ARM64 VM (run after confirming VM, DNS, OCI firewall and SSH access):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
# Install Docker Engine + Compose plugin from official Docker Ubuntu instructions.
# Confirm `docker compose version` before proceeding. Avoid unverified curl | sh setup scripts.

git clone --branch codex/production-readiness https://github.com/Rashid-RG/restaurant-pos.git
cd restaurant-pos/infra/oracle-osrm
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Copy the generated secret into `GASTROFLOW_ROUTING_KEY` in the VM's `.env`. Set `ROUTING_HOST` to the DNS hostname and `ACME_CONTACT_EMAIL` to an inbox you control. **Never paste the routing key, SSH private keys, API tokens or database credentials into chat or GitHub.**

```bash
docker compose config --quiet     # validate compose before building maps
bash prepare-sri-lanka.sh         # sequential extraction / partition / customize
docker compose up -d
docker compose ps
bash verify-routing.sh            # HTTPS route works with key; unauthenticated access rejected
```

`prepare-sri-lanka.sh` downloads the Sri Lanka Geofabrik OpenStreetMap extract from `https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf` and runs OSRM's official MLD processing commands. Preparation is CPU and memory intensive; do not schedule it alongside a working restaurant POS. OSRM is internal to the Docker bridge network. Only Caddy listens on public 80/443. The Caddy proxy requires `X-GastroFlow-Routing-Key` and permits only `/route/v1/driving/*`.

## Connect GastroFlow staging (NOT production)
Only **after** `verify-routing.sh` passes and the public endpoint has HTTPS:

1. In **Render / gastroflow-staging**, set:
   - `GASTROFLOW_ROUTING_URL=https://<actual-routing-hostname>/`
   - `GASTROFLOW_ROUTING_KEY=<the-identical-secret-in-Oracle-.env>`
2. Keep both environment values out of the repository. Render deployment restarts its app when variables change; coordinate a safe window because shops may be using staging.
3. Check `/api/health`, then create an isolated **test delivery** and confirm the authorized customer tracking endpoint returns route geometry and a qualified driving estimate. Test a wrong key/disabled service and verify graceful fallback. Do not create or change real customer orders during this test.
4. Ensure the route begins at the restaurant before pickup, or at a fresh assigned rider GPS location after pickup. Estimates are **driving time only**, not guaranteed arrival time or traffic-aware navigation.
5. Never set these variables on `restaurant-pos` production until the entire system passes final acceptance and the owner approves.

## Pilot monitoring and rollback
- Review `docker compose logs --tail 100 osrm caddy` and `docker stats --no-stream` on the Oracle VM.
- Observe routing latency, 5xx errors, RAM, memory pressure, CPU, disk space and failed ACME renewals. Confirm system restart behavior.
- **Rollback:** remove/clear `GASTROFLOW_ROUTING_URL` and `GASTROFLOW_ROUTING_KEY` on staging, restart staging, and verify the existing straight-line tracking map still works. Keep Render and the remote Turso/libSQL database unchanged.
- Backups/snapshots and their restore procedure must be validated before any application hosting migration. A live Oracle VM is not a reason to replace a working DB.
- VM updates and OSRM data refreshes must be deliberate: download/prepare into a separate dataset and use tested cutovers. Avoid deleting the only prepared dataset.

## Full-app migration — separate future approval
Oracle deployment of the **entire** GastroFlow application is **not performed** in this routing pilot. A full cutover must preserve the current Turso/libSQL data path (not flip to the repository's unvalidated PostgreSQL path), isolate staging test data, use separate host/domain and secrets, validate auth/webhooks/email/payment callbacks, and measure responsiveness from Sri Lanka. Render is retained for rollback. No production data is imported into an untested VM.

## Current state
- [x] Containerized OSRM/Caddy staging routing deployment templates
- [x] Secret-gated HTTPS route proxy (only route API exposed)
- [x] Sri Lanka data-processing commands and HTTPS smoke check
- [ ] Oracle account VM exists and can be reached over SSH
- [ ] DNS A record resolves to the VM
- [ ] Docker installed, OSRM dataset processed, TLS issued
- [ ] Successful server verification (authorized request 200, anonymous request 403)
- [ ] Render staging secret/URL configured after external routing verification
- [ ] Final real-device acceptance (deferred by owner)

## Official references
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- OSRM MLD: https://github.com/Project-OSRM/osrm-backend
- Sri Lanka OSM: https://download.geofabrik.de/asia/sri-lanka.html

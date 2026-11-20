# GastroFlow Location Engine — Staging Activation Checklist

**Branch:** `codex/production-readiness`  
**Scope:** GastroDriver, GastroFlow Food and authenticated POS delivery management.  
**Safety:** Do not change production, do not backfill or delete Turso records, and do not deploy without explicit approval.

## Existing implementation

- Rider browser GPS reports are sent only for assigned active deliveries via `/api/public/driver/location`; the server verifies assignment, restaurant membership, measured accuracy and fix age.
- Customer tracking receives order-authorized rider updates through an existing SSE order stream.
- Customer map uses Leaflet, distinguishes true road geometry from straight-line proximity, and avoids representing interpolated markers as predictions.
- `lib/road-routing.js` supports dedicated OSRM-compatible routing with `GASTROFLOW_ROUTING_URL` (HTTPS origin) and `GASTROFLOW_ROUTING_KEY` (at least 32 characters). The public OSRM demo must not be used for commercial customer coordinates.
- `lib/delivery/rider-discovery.js` provides a **pure in-memory candidate eligibility policy**, NOT a running rider search endpoint. It requires consent, fresh GPS, verified rider status and tenant consistency, and produces a coarse distance shortlist without leaking raw coordinates.

## OSRM setup requirements (not yet activated)

1. Provision a **dedicated staging** OSRM instance, with geographic data covering the intended service area. Use a properly sized disk/memory plan; do not assume the smallest free VM is sufficient to preprocess a whole country.
2. Put the instance behind HTTPS and a reverse proxy that authenticates the `X-GastroFlow-Routing-Key` header. Restrict public access at the proxy. OSRM itself does not understand that application header.
3. Configure `GASTROFLOW_ROUTING_URL=https://<staging-routing-domain>/` and a randomly generated secret `GASTROFLOW_ROUTING_KEY` in the **staging** service only after approval. Never commit secrets.
4. Validate the route endpoint with a **test order and test database**; verify `available:true`, road geometry, distances and deliberate provider outage fallback (`available:false`).
5. Verify mobile rendering and rider map accuracy in both low signal and normal connectivity. Routing duration alone is not live-traffic prediction.
6. Confirm the Render staging service's auto-deploy setting and database isolation before any deployment.

- `lib/delivery/h3-rider-index.js` provides a tenant-separated H3 v4 API adapter with replace/expire/clear behavior. It is wired to the official `h3-js` dependency inside the opt-in rider-presence HTTP pilot. Automatic dispatch and road-ETA ranking remain unimplemented.

## H3 and nearby riders — outstanding work

The current database stores order GPS separately from the new opt-in, short-lived, **in-process** rider-presence pilot (`GASTROFLOW_RIDER_PRESENCE_PILOT=true`). The pilot is disabled by default. Before production H3 discovery:

- An authenticated consent-based on-duty heartbeat API is present, but its memory store is per server process; replace it with a shared TTL store before deploying across multiple instances. Do not reuse an active order's GPS as a free rider's real-time location.
- Enforce tenant ownership server-side and restrict read access to restaurant dispatch roles; never return another restaurant's riders.
- Require an approved identity and appropriate licence verification, a clear online/offline state and explicit location consent.
- H3 v4 cell prefilter is integrated in the pilot. Rank candidates using real OSRM travel times before claiming ETA-based auto-dispatch; H3 proximity is not travel ETA.
- Expire positions promptly when riders go off duty, lose consent or exceed freshness limits, and impose retention limits.
- Integration-test cross-tenant disclosure, forged driver IDs, cancelled/finished orders, stale pings, reassignment and missing routing service.

## Native GastroDriver background location — outstanding work

The existing driver UI is a PWA. Browsers cannot guarantee continuous GPS when locked or backgrounded. `apps/driver-native` now provides a Capacitor target and tested background-tracker controller, but native plugin hookup, generated Android/iOS projects, signing and physical device tests are **not complete**.

- **Android:** use an approved native location component/foreground service with explicit location and notification permission flows, persistent disclosure, battery policy testing and Android device verification. Stop immediately off-duty.
- **iPhone:** use Core Location background modes with a clear purpose string, permission escalation only when justified and physical iPhone tests for suspended, offline, restarted and force-quit states. Do not promise location updates after a force-quit.
- Both: use short-lived authenticated uploads, tenant-bound access, on-duty consent, coordinate accuracy/timestamp guards, stale UI indicators and low-data batching. Do not put long-lived secrets into the mobile package.
- Use cloud builds for iOS only after validating account signing and application identifiers. A browser/PWA build does not count as proven native background tracking.

## Go/no-go requirements

- `npm test`, `npm run check`, `npm run build:all` pass on the exact commit to be deployed.
- Staging routing proxy and credentials validated, without changing production.
- Isolated staging data and non-destructive migrations verified.
- Android and actual iPhone real-device tests prove foreground/background permission and route behavior.
- Reconnection, stale marker, dispatch and cross-tenant security tests pass.
- Obtain explicit deployment approval. Only then deploy **gastroflow-staging**.

## Implementation checkpoint — 2026-11-20

- **H3 pilot connected in code:** The official `h3-js` library filters short-lived rider presence records for authenticated restaurant dispatchers. `/api/public/driver/on-duty-location`, `/api/public/driver/off-duty-location`, and `/api/delivery/nearby-riders` are feature-gated by `GASTROFLOW_RIDER_PRESENCE_PILOT=true` and remain **disabled by default**.
- **OSRM integrated for optional rider ranking:** When `GASTROFLOW_ROUTING_URL` and `GASTROFLOW_ROUTING_KEY` are configured, the H3 shortlist may include `roadTravelMinutes`. Missing routes never become invented ETAs. `infra/osrm-staging` contains a reference Docker stack and authenticated gateway, not a running server.
- **Native code integrated:** Native GastroDriver builds select `@capacitor-community/background-geolocation` with CapacitorHttp uploads, a separate application identifier, and an explicit staging API origin. Unsigned Android/iOS project generation, native permissions, signing, real-device background tests, and production-ready retry guarantees are **not completed**.
- **Deployment remains blocked:** Staging auto-deploy was observed disabled in Render. No service, environment, database, or production deployment was changed during this work. Obtain explicit staging approval and provide a reachable OSRM host, plus device-signing access, before activating.
- **Scaling:** The rider-presence pilot uses process memory, and thus is not production-ready for multiple instances. Replace it with a secure tenant-scoped shared presence store with TTL and revocation before multi-instance rollout.

## Shared Redis staging presence wiring

The staging resource `gastroflow-rider-presence-staging` is provisioned, but its
private connection URL must be provided securely through the Render dashboard.
Never paste it in GitHub issues, commit history, customer app bundles, or chat.

- `GASTROFLOW_RIDER_PRESENCE_PILOT=true` keeps the already authorized rider
  consent, authentication and tenant-scoped H3 endpoints enabled.
- `GASTROFLOW_RIDER_PRESENCE_REDIS_URL` is optional: when absent, the existing
  single-instance in-memory pilot remains active. When present, it selects the
  Redis TTL adapter and rejects connection errors rather than falling back.
- Configure only in the **gastroflow-staging** service. Use a private Render
  `redis://red-.../` URL or external `rediss://...` endpoint with TLS.
- The Redis adapter stores each rider's recent GPS under hashed tenant/driver
  keys with a maximum 90-second expiration and atomic timestamp ordering.
  This is volatile location state only, not sales/customer/Turso data.
- Test on two authorized rider accounts within one restaurant and a second
  isolated restaurant. Confirm consent-off revocation, TTL expiry, busy/offline
  exclusion, manager-only discovery, restart behavior and no cross-tenant leaks.
- This dedicated short-lived connection is intended for the staging pilot;
  replace with a pooled, monitored client and enforce memory/throughput quotas
  before high-volume production rollout.

**As of this checkpoint:** the URL has not been supplied by the connected
Render tools and has not been configured. The presence resource's existence
must not be represented as a working shared-storage connection.

## Dedicated Sri Lanka OSRM — verified staging connection (2026-11-20)

- **Render service:** `gastroflow-osrm-staging` (free instance; auto-deploy off).
- **Source:** `infra/osrm-staging/Render.Dockerfile`, using Geofabrik Sri Lanka OSM extract and pinned OSRM v5.27.1. The image builds an MLD routing graph; map data is a build-time snapshot.
- **Gateway:** only the Node HTTPS-facing proxy port is publicly exposed through Render. The OSRM engine listens on `127.0.0.1:5000`. Requests must present the routing key in `X-GastroFlow-Routing-Key`; the gateway rejects unauthenticated requests.
- **Staging application:** `GASTROFLOW_ROUTING_URL=https://gastroflow-osrm-staging.onrender.com/`, secret key configured only in Render Environment, and `GASTROFLOW_ROUTING_STARTUP_SMOKE=true`.
- **Proven:** router's authenticated startup smoke returned a 2,122 m Colombo driving route in 188 seconds. The staging application's startup log confirms `[OSRM staging integration] Verified authenticated Sri Lanka road routing through HTTPS` on 2026-11-20.
- **Deployment:** staging backend `dep-dc0319f40ujc73f8perg` and dedicated routing image `dep-dc02vnqjnfac738qvic0` were reported live by Render. The production service's most recent deployment remained unchanged.
- **Limitations:** free routing service sleeps during inactivity and first requests may time out before wake-up. Road ETA is not live-traffic ETA. No scheduled OSM refresh, SLA, advanced traffic optimization or physical rider test has been validated. Move routing to suitable always-on compute before commercial launch.
- **Security:** never paste or commit routing API keys. For secret rotation, update the separate routing service first, then staging together; there may be a brief fallback window. Do not change production.

## Smart dispatch integration — 2026-11-20

- `lib/delivery/smart-dispatch.js` supplies a single H3/OSRM shortlist shared by the manager rider-search API and opt-in automatic dispatch.
- The server-side filter requires **fresh consented rider presence**, current approved verification, the correct tenant, available status, and no active assigned deliveries. It reuses atomic order/driver claim guards to prevent double assignment.
- Existing `DeliveryView` dispatch cards now offer a manager-only **Find nearby riders** action when restaurant pickup coordinates have been configured. The card shows road-travel minutes only when verified OSRM estimates are available; otherwise it labels straight-line distance as proximity, and selecting a rider populates the existing manual assignment control.
- `GASTROFLOW_SMART_DISPATCH_PILOT=true` is the **separate auto-assignment flag**, requiring `GASTROFLOW_RIDER_PRESENCE_PILOT=true` too. It remains disabled in the deployed staging environment unless explicitly and safely activated after verifying staging order/database isolation.
- With the smart-dispatch flag on, auto-assignment **never falls back to stale order GPS** if no fresh consented rider is present. With the flag off, existing delivery dispatch policy is preserved.
- No change to automatic delivery order assignment should be activated while staging might share the production Turso customer dataset. Confirm isolated testing and demonstrate tenant/driver cancellation, rejection, consent withdrawal, double assignment and reconnect behavior first.

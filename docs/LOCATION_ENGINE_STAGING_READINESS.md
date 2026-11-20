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

- `lib/delivery/h3-rider-index.js` provides a tenant-separated H3 v4 API adapter with replace/expire/clear behavior. It currently uses an injected H3 implementation in tests and is **not yet connected to a live heartbeat endpoint, a package dependency, or automatic dispatch**.

## H3 and nearby riders — outstanding work

The current database stores GPS **by active order**. That does not establish reliable GPS for idle, available riders. Before enabling H3 discovery:

- Create a new authenticated, opt-in, on-duty rider heartbeat API and a short-lived presence store. Do not reuse an active order's GPS as a free rider's real-time location.
- Enforce tenant ownership server-side and restrict read access to restaurant dispatch roles; never return another restaurant's riders.
- Require an approved identity and appropriate licence verification, a clear online/offline state and explicit location consent.
- Store H3 cells using a maintained `h3-js` dependency and prefilter candidates by cells. Rank the resulting candidates using real OSRM travel times; H3 proximity is not travel ETA.
- Expire positions promptly when riders go off duty, lose consent or exceed freshness limits, and impose retention limits.
- Integration-test cross-tenant disclosure, forged driver IDs, cancelled/finished orders, stale pings, reassignment and missing routing service.

## Native GastroDriver background location — outstanding work

The existing driver UI is a PWA. Browsers cannot guarantee continuous GPS when locked or backgrounded. A separate native GastroDriver application and platform-aware background location plugin are required.

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

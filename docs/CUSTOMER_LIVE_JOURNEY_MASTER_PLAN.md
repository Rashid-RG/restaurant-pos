# GastroFlow Food — live order journey redesign

**Branch:** codex/production-readiness. **Deployment:** staging only with explicit owner approval. **Data safety:** no destructive Turso migrations or changes to live orders.

## Goal
Replace the vertically stacked, duplicated order-status cards with one customer-first mobile journey. Display *only* canonical restaurant/rider stages and actual measured rider fixes. Do not invent live positions, traffic predictions or arrival guarantees.

## User-facing experience
1. **Above the fold**: one compact current-stage card, progress meter, connection indicator and a single server-derived order ETA when available. Keep mobile navigation visible.
2. **Live map**: show restaurant, confirmed customer destination and authorized rider position. Smooth transitions *only* between real device fixes. Offer opt-in rider-follow and show-whole-journey actions. Clearly state GPS freshness and routing availability. Dotted proximity is not a road route.
3. **Timeline**: one expandable history showing each canonical stage. Never mark delivery complete because the rider was merely assigned, picked up, en route or arrived.
4. **Communications**: authorized rider chat and restaurant support in an expandable contact section. Customer handover PIN, receipt and cancellation remain accessible under order details; do not expose a PIN to the rider until customer shares it.
5. **Notifications**: concise stage changes, with user-enabled push where supported, and no repeated loud overlays for the same event. Accessibility: semantic status, reduced motion support, touch-friendly controls.

## Data and API architecture
- Rider browser/native client -> authenticated, tenant-bound order GPS upload with coordinate accuracy, age, assignment and impossible-jump checks.
- Canonical order snapshot + authorized SSE -> customer UI. Poll during disconnect/reconnect, do not mix positions from different orders or tenants. Remove a revoked/stale marker.
- Road geometry -> dedicated HTTPS OSRM-compatible staging gateway. Do not claim a straight line is a road route, or that free-routing time includes real traffic.
- Driver camera-follow -> **only** new confirmed GPS fixes, no speculative forward motion. Disable follow on user pan/zoom; support visibility and low-signal conditions.
- Avoid contradictory delivery ETAs. Distinguish order-wide delivery estimates from road-only driving minutes.

## Delivery acceptance checks
- Stage transitions: pending -> preparing -> ready -> picked_up -> out_for_delivery -> arrived -> delivered, as supported by actual canonical backend order states.
- One progress timeline, not two; compact UI on iPhone Safari at 375px and 430px; fixed navigation and overlays do not obscure actions.
- Two geographically separate GPS fixes move the rider marker between confirmed positions; stale (>90 sec), inaccurate, expired and reassigned driver GPS do not appear as real-time tracking.
- OSRM available / unavailable both render truthfully; pickup/driver/drop pin mapping is tenant-correct.
- Rider contact and help actions are permission scoped; no raw driver location or customer contact leaks across tenants.
- Notification prompts require an explicit customer action; same stage should not produce repeated foreground noise.
- Test with real phones: foreground, background, permission revoked, network off/on, long route, driver stationary, navigation follow/stop, handover proof and completion.
- npm test, npm run check and npm run build:all, plus customer staging quality workflows, must pass on the exact release commit.

## Implementation checkpoint 2026-11-21
- **Code committed:** compact progress hero, one expandable canonical timeline, expandable contact/receipt, map toggle, responsive styling, rider follow/recenter controls and real-GPS-only marker interpolation. Removed the duplicate hero and dispatch card that displayed competing ETA text.
- **Still pending:** device-by-device mobile UI audit, driver native background tracking on physical iPhone, actual GPS field trip, production-compatible routing and dynamic ETA validation, notifications UX audit, accessibility review, screenshot regressions, and full GitHub CI on the final commit.
- **No deployment.** Do not claim full Uber-style continuous rider tracking on iPhone until native background mode and server upload have been demonstrated on physical hardware.

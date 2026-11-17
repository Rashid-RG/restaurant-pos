# GastroFlow Monorepo Architecture Contract

**Scope:** existing `Rashid-RG/restaurant-pos` repository, `codex/production-readiness` branch. This is a staged target architecture, not permission to move existing entrypoints or deploy.

## Stable current entrypoints (do not break)

| Current path | Responsibility | Target logical owner |
|---|---|---|
| `server.js` | Express bootstrap, route registration, legacy handlers | Backend composition root |
| `src/` | Restaurant POS frontend and currently platform-owner UI | Restaurant POS; platform UI to be extracted incrementally |
| `apps/customer-web/` | Customer web UI and native Android assets | Customer experience |
| `apps/driver-web/` | Driver portal | Driver experience |
| `routes/` | Mounted API router modules | Backend transport layer |
| `lib/` | DB adapter and business service code | Backend domain layer |
| `shared/ui/` | Presentation-only cross-app primitives | Shared UI |
| `tests/` | Integration, contract, safety tests | Test infrastructure |
| `infra/` | Infrastructure, e.g. OSRM | Deployment infrastructure |
| `docs/` | Architecture and operating instructions | Documentation |

## Non-negotiable boundaries

1. **Tenant security belongs to backend auth and query constraints.** A frontend header, package ID, URL, or screen visibility alone cannot authorize cross-tenant access.
2. **Platform owner is not restaurant owner.** Check authoritative server-owned `isPlatformAdmin` permissions before any platform action. Never give an ordinary shop owner platform APIs by moving UI files.
3. **Customer checkout, driver dispatch, and POS sales share order truth through backend contracts**, not imports between frontend app source directories.
4. **Native Android staging is separate:** `com.rstechnologies.gastrofood.staging`, permanent signing, staged backend only. Do not configure `server.url` or mix production API origin into native staging.
5. **No destructive schema changes, automatic production deployment, or Turso data resets as part of refactoring.**
6. **Keep legacy imports working until coverage is added.** Any directory migration needs a dedicated change, tests, and staging verification; it is not part of today's structure guard.
7. **Secrets must never be committed.** Keystores/passwords live outside the repository, with secured signing backups.

## Roadmap toward 10/10 engineering maturity

- **Stage A (implemented):** remove generated Vite artifacts; add architecture guard and manual-only signed staging workflow.
- **Stage B:** extract platform-owner UI through a stable module boundary; keep POS router contracts and tenancy authorization unchanged; add role/tenant navigation tests first.
- **Stage C:** move one fully tested backend domain at a time out of `server.js`. Start with pure helpers, then a narrow router; verify two-tenant contract and failure behavior. Follow `docs/MODULARIZATION.md`.
- **Stage D:** define stable shared API client, types, UI packages only when their use is demonstrated; do not introduce premature package splits.
- **Stage E:** verify all three apps' build/test pipelines, signed Android update over installed staging APK, production-like two-tenant E2E tests, rollback and restore drills.
- **Stage F:** maintain explicit release gates for tenant isolation, POS receipts, scheduled orders, payment callbacks, location tracking, and customer notifications.

## Release gates (not achieved merely by folder organization)

- API and auth contract tests passing, including cross-tenant negative tests
- POS receipt and sales-report printing regressions verified using real thermal printers
- Secure app signing key backed up, repeat signed in-place Android upgrade demonstrated
- Valid backup restoration rehearsed without touching live Turso data
- Android and iOS device test matrix with GPS, push, app restart and offline behavior
- Staging E2E purchase-to-delivery and owner-console workflows with no production writes
- Source changes reviewed and recoverable, rollbacks documented

## Validation command

`node scripts/check-repository-architecture.mjs`

This guard is deliberately conservative: it checks key paths, forbidden tracked artifacts, Android identity and release discipline. It does **not** prove feature correctness, complete tenant isolation or 10/10 product quality. CI runs it automatically for relevant changes.

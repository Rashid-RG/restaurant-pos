# Platform ownership and independent restaurants

The platform has one designated owner, separate from every restaurant's owner role. On the first upgrade, the configured ADMIN_USERNAME must identify an existing owner in default_tenant. A singleton platform_ownership row records that account. Later username or environment changes do not transfer ownership. There is no API for creating another platform owner or transferring this designation. Back up the database before upgrading an existing installation.

The staff sign-in response and authenticated GET /api/auth/me expose isPlatformAdmin. Authorization reloads the account and singleton from storage on each request; JWT flags, tenant headers and browser state cannot grant platform access. Other owners of default_tenant also lack platform access. The designated owner sees Platform admin in navigation. Restaurant owners retain their own workspace.

One authoritative management router supports restaurant listing, provisioning, plan/status changes and suspension/reactivation. Provisioning validates input, atomically creates a tenant, owner and settings, and returns random owner credentials once with Cache-Control: no-store. Passwords and PINs are hashed; listing never returns credentials. New storefronts start closed and empty. No email is sent. Share credentials securely and configure the restaurant before opening it. Plan changes record entitlement; they do not charge money or establish a billing subscription.

Suspension rejects new restaurant owner sign-ins, existing staff and driver sessions, and emits tenant status events after commit. The platform workspace cannot be suspended through this API. Permanent tenant deletion is blocked until retention, referential cleanup and backup/restore are verified.

This iteration also restricts platform commission reports and database inspection to the designated owner, scopes supplier contacts and staff timeclock lists, and rejects cross-restaurant ingredient edits, recipe references and waste adjustments. Generic restaurant APIs remain bound to the signed-in restaurant; platform ownership does not permit header-based impersonation. Secure cross-restaurant operational management and a platform-wide financial dashboard remain future work.

Validation: 188 HTTP/unit regression tests expected in this revision, including real application routes for provisioning, forged platform claims, ordinary default-restaurant owners, suspension, contact privacy and stock ownership. Production smoke checks cover local SQLite and libSQL file storage, cash-only startup and restart persistence. Hosted cross-restaurant checkout/transaction load, full route isolation, provider callbacks, hardware and migration/restore remain release gates. Staging is not a certified commercial rollout.

## Interface identity and motion

Custom GastroFlow G/fork marks are provided as SVG and 192/512px PNG assets: green for POS, terracotta for customer ordering and blue for drivers. Browser favicons, installed-app manifests and in-app headers use the custom identity. Shared SVG feature icons show cooking steam and stirring, order receipts, prepared food and delivery movement. Motion respects prefers-reduced-motion and does not imply a status change; order state remains server-owned.

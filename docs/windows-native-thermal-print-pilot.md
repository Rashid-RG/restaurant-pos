# Windows native thermal receipts — optional pilot (QZ Tray / ESC/POS)

**Scope:** Existing GastroFlow POS, branch `codex/production-readiness`. This is an **opt-in per-computer** feature, not a default deployment and not a replacement for restaurant-wide browser printing.

## Why

Some POS-80 Windows print drivers expose fixed-length forms (80 × 210 / 297 / 3276 mm). Browser print previews then add blank paper before/after the receipt. Direct ESC/POS passes the receipt to the Windows raw printer queue without using Edge's fixed-page paper size and adds a small feed + cutter command. Exact cutter/feed compatibility depends on the actual printer hardware.

## Operator setup (Windows, Chrome or Edge)

1. **Keep the currently working POS-80 printer driver and USB cable.** Verify that the Windows printer can print a test page; resolve port errors first. Do not reinstall or redirect ports just to enable native mode.
2. Download and install QZ Tray from **https://qz.io/download/**, then launch it on the same Windows laptop. Confirm QZ appears in the system tray. Official QZ site documents local WebSocket connections and supported native ESC/POS commands.
3. On the **staging** POS, sign in to the correct restaurant, open **Settings → Smart Printer & Paper Size → Windows Direct Thermal Print (ESC/POS)**.
4. Set **58 mm** or **80 mm** for the installed physical paper roll. Press **Connect QZ Tray / Find printers**. Approve QZ permission dialogs if you trust the specific GastroFlow staging origin. Select the exact **POS-80** printer from the detected Windows list.
5. Press **Send one native test slip**. Confirm the physical paper is readable and cut/feed looks correct, and the Windows print queue has no error. The application only knows the print request was accepted by the local bridge; it does **not** know when the hardware printed or cut.
6. Only after the test, enable native cashier receipt printing **on this computer**. Complete a sample paid order; verify a single printed bill. The browser receipt modal still has a **Browser Print** button for explicit manual fallback.
7. For rollback, uncheck **Enable native cashier receipt printing**. All other POS printing remains in browser mode.

### QZ security / commercial rollout

- The first pilot uses a pinned QZ browser JS file loaded **only after the workstation uses the native feature**; QZ Tray itself runs on the cashier's computer.
- **Unsigned QZ requests require user approval dialogs.** Never promise silent/unattended printing with this build. Production silent printing requires trusted certificate and signed requests, plus a licensed QZ configuration or a reviewed organization-controlled trust root. **Never ship private signing keys in frontend code.**
- Before commercial rollout, move the pinned QZ client library into reviewed self-hosted assets with an integrity-pinned release and create a secure server-side signing endpoint with proper session+tenant authorization, audit logging and request replay protection.
- Only trusted, authenticated POS users should choose native printers. Config is stored in `localStorage` for that *tenant on that computer*, never in Turso or cross-tenant settings.
- **Raw HTML -> ESC/POS** conversion is supplied by QZ Tray. Browser-specific `@page` rules are removed; actual logo/text appearance must be checked with a real printer. If QZ conversion or raw driver behavior isn't correct, disable native mode and keep existing browser printing.
- Never auto-repeat a failed/uncertain raw print job, or a delayed Windows spooler may produce duplicate receipts.
- The feature initially applies to **cashier bills only**; Sales Audit remains A4/PDF. Z/X reports and historical reprints stay on existing standalone browser printing until independently validated.
- This pilot does not replace printer paper-width profiles, USB port setup, cutter calibration, or a working Windows spooler.

## Required sign-off before general activation

- Windows 11 POS-80 USB: 80 mm roll, short bill (one line item), multi-item long bill, image logo, character encoding, full cut, no excessive top/bottom feed.
- Staging disabled: same cashier receipt preview and browser print as previous release.
- Staging enabled: one print only, QZ stopped/unavailable error, physical USB unplug/replug, print queue errors, reprints with manual Browser Print button, second restaurant on same machine remains disabled.
- Confirm no payment, order, inventory, database, or printer-setting migrations. Do **not** deploy production without a separate explicit approval.

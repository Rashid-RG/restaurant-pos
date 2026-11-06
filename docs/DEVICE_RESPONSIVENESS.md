# Responsive application follow-up

This release improves the POS/admin, customer and driver applications across compact phones, larger phones, tablets, landscape and desktop layouts. It does not certify every device or browser engine.

## Behavior

- The POS phone menu remains visible. Its order panel is a collapsible drawer with a live quantity/total, a Back to menu control, Escape dismissal and a scrollable bill. Desktop and larger-tablet side-by-side ordering remains available. The five phone navigation destinations, including More, fit without sideways navigation scrolling. Category names remain readable in their own horizontal strip.
- Customer controls use larger touch targets. Cart and account destinations remain in the bottom navigation on phones, while redundant header shortcuts are omitted to keep the header usable. The home/logo control is keyboard accessible. Hero decoration no longer overlaps store metadata; checkout forms retain a readable width on large monitors.
- Driver account, GPS and sign-out controls reflow into a phone-width row instead of compressing their labels vertically. Metrics adapt to the available width. Delivery-proof dialogs retain a usable signature/photo area and scrollable confirmation controls.
- All three entry pages allow pinch zoom. Form fields on narrow/coarse-pointer devices use readable sizing, and primary controls have a 44px minimum touch target. Safe-area padding, short-screen dialog scrolling, reduced-motion support and print behavior are retained.
- Platform provisioning, customer group/customizer/verification/payment and driver registration/proof dialogs receive viewport-aware height/scroll constraints. POS dialogs appear above fixed phone navigation.

## Local validation

| Viewport | Representative device shape |
|---|---|
| 320 × 740 | Compact phone |
| 360 × 800 | Small phone |
| 390 × 844 | Larger phone |
| 768 × 1024 | Portrait tablet |
| 1024 × 768 | Landscape tablet |
| 844 × 390 | Short landscape screen |
| 1440 × 900 | Desktop |
| 1920 × 1080 | Wide desktop |

A Chromium layout sweep covers ten staff destinations, six customer destinations and the driver dashboard at all eight sizes: 136 page/size combinations. It checks page-wide horizontal overflow and browser runtime errors. Wide tables and category strips may scroll within their own containers.

Separate interaction checks use a real open-shift fixture, not only the shift-opening screen. They add a POS menu item, open/close the phone bill, reach the payment dialog and its settlement control without making a payment, exercise More navigation, check customer header targets, operate the driver tabs, and open platform/group/delivery-proof dialogs at compact-phone, landscape, tablet and desktop sizes. Screenshots were visually reviewed to catch occluded content that a page-width assertion misses.

The existing interrupted-checkout browser test is also rerun against the responsive build: a lost response after commit and a reload recover one order with one stock deduction. The automated backend suite remains 253 tests, with syntax/type checks, three frontend builds and production-process restart smoke tests.

## Acceptance still required

Viewport emulation is not a physical-device test. Safari/iOS and Firefox engine checks, real virtual keyboards/notches, camera/signature use, GPS permissions/background behavior, poor mobile connectivity, assistive technology and printer/local-bridge workflows still require acceptance. No real payment, outgoing notification or customer delivery was performed by these layout tests. The production-data, concurrency and operations gates in [PRODUCTION_LAUNCH_PLAN.md](PRODUCTION_LAUNCH_PLAN.md) remain in force.

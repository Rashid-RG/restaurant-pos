# GastroFlow Food — Five-stage mobile checkout test plan

**Target:** `codex/production-readiness` on **gastroflow-staging** only, after explicit deployment approval. Do not submit orders through production or alter live Turso sales/customer records.

## Scope and release criteria

Customer journey: **Cart → Fulfilment → Details → Payment → Confirm → OTP (if required) → Order tracking**.

The release is **not validated** until the final deployed commit completes:
- GitHub Verify + CI + customer staging quality gate + order lifecycle integration checks.
- At least one device/browser run at each relevant phone width (320, 375, 390, 430 CSS px), plus desktop with a keyboard.
- One authorized test order from a staging restaurant through confirmed receipt/tracking. Use a dedicated test tenant and test contacts where possible.
- Server-calculated order totals match all customer-visible amounts, especially modifiers, promotions, tips, restaurant charges and delivery fees.
- No cross-tenant cart, coupon, address, rider or order leakage.

## Device review: layout and accessibility

1. On iPhone Safari or installed PWA, check that the step progress, content and Continue/Back controls are visible; neither keyboard nor bottom navigation obscures actions.
2. At every step, pressing Back preserves all entered values, including delivery pin, customer contacts, promo code, loyalty, tip and schedule.
3. Only the Confirm step is permitted to submit the order. Press Enter on intermediate text inputs and ensure no order is created.
4. Open each bottom sheet (Scheduling, Offers & Loyalty, Tips, Special Instructions) and verify: no background scrolling; overlay within viewport; iPhone safe areas; input keyboard visibility; outside click, close, Escape and Done; focus returns to the trigger; screen-reader dialog labels.
5. Repeat with reduced-motion enabled and 200% browser text zoom. No clipped content or inaccessible controls.
6. Verify opening, closing and stepping backwards never discard saved cart items.

## Fulfilment and delivery quote

1. Test available pickup, paused pickup, available delivery and disabled delivery. QR-bound dine-in must not silently change modes.
2. Restaurant closed: scheduled slots only, and server confirms each available slot; booking a full slot must not create an order.
3. Delivery: moving the customer map pin revokes previously confirmed entrance and quote. Confirm new entrance; verify new server quote, eligibility and final Total Payable.
4. Test missing restaurant coordinates, denied geolocation, unreachable location, outside delivery radius, road-routing unavailable and network offline. The checkout must not submit an unsupported or unquoted delivery.
5. Validate the same restaurant pin and customer entrance are used in owner fee preview and checkout.

## Pricing, promotions, loyalty, tips

1. Cart items with required/optional modifiers: line total uses `unitPrice × qty`, not menu base price; subtotal matches sum of line totals.
2. Apply an eligible promo, reject invalid and expired coupons, then Remove promo. Try tapping Apply twice during a slow request.
3. Change cart after applying promo: prior discount is cleared/revalidated, and the final amount is priced again on server.
4. Redeem loyalty where available; verify earn/redeem labels and server balance do not exceed available points.
5. Tips: none, 5%, 10%, 15%, custom valid number; verify zero tips and non-negative constraints. The server must reject an invalid/oversized tip rather than accept an invented total.
6. Compare the final payment amount with the actual server-confirmed delivery fee, discounts, service charge, tax and rounding. Do not label a delivery-pending subtotal as a confirmed payable total.

## Payments, OTP, recovery and safety

1. Cash: order receipt/tracking shows unpaid/COD as appropriate. Manual bank transfer remains unpaid until separately verified by manager.
2. Card/PayHere and LankaQR cannot be chosen when disabled; do not create a paid status on browser-only callback.
3. OTP: correctly delivered email code, wrong code, expired code, reused code, and account contact mismatch; no duplicate order during repeated verification.
4. Force a network timeout immediately after order submission. Recovery uses the saved idempotency key and must never duplicate an order or clear the cart prematurely.
5. Verify tenant isolation across two staging restaurants: switching stores does not leak prior cart, address, promo or order ID.
6. Validate order tracking shows the correct restaurant, order amount, stage, and delivery mode.

## Sign-off

Record: commit SHA, branch, Render deployment ID, staging URL, tenant/test order IDs, browser/device version, screenshots (with contact details masked), observed totals, and result for every case. Record blockers rather than silently marking unsupported physical-device or payment-provider flows as passed.

**Current status:** code checks have been run; final deployed mobile visual and end-to-end tests remain pending explicit staging deployment and device access.

# GastroFood final real-device acceptance checklist

Status: **DEFERRED BY PROJECT OWNER until the final application acceptance phase** (2026-11-14).

Do not interrupt each development batch by asking for a new phone test. Continue automated tests, builds, and staging deployment checks; retain this checklist for the final acceptance phase. Automated checks do not equal real-device certification.

## Final mobile/browser checks
- [ ] Registration and login with Brevo email OTP, resend, wrong code, expired code, account recovery and logout persistence
- [ ] OTP, password reset, email logo and transactional messages in actual Gmail and mobile inboxes
- [ ] Restaurant discovery with open/closed status, filters, delivery location and switching restaurants
- [ ] Menu sold-out changes reflected from POS, modifier selections, stock limits, prices, notes and quantity edits
- [ ] Cart restored after refresh, restaurant isolation, full checkout, payment-status handling, failed network retry and duplicate tap prevention
- [ ] Order from GastroFood through POS acceptance, kitchen, dispatch, GastroDriver, customer tracking and completion
- [ ] Driver GPS accuracy and graceful loss of GPS/network, real-time updates and ETA behavior
- [ ] Mobile viewport: iPhone Safari/PWA, Android Chrome/PWA, keyboard overlap, popup layering, scrolling and bottom navigation
- [ ] Sinhala/Tamil locale and accessibility (touch size, focus order, screen reader labels)
- [ ] Delivery and payment providers verified using authorized non-live or sandbox accounts first
- [ ] Restaurant owner approval before a real sales/order/thermal printing acceptance test
- [ ] Regression testing on both 58mm and 80mm thermal receipt paths with the shop operator

Production remains unchanged until the owner explicitly approves production promotion.

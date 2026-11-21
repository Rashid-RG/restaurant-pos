/**
 * Verify a registration OTP only for the restaurant selected by this request.
 * Keep the historical phone-first then optional email verification order and
 * purpose binding. A missing tenant fails closed rather than consulting the
 * global/default restaurant.
 */
export function createRegistrationOtpVerifier({ verifyOTPAsync }) {
  if (typeof verifyOTPAsync !== 'function') throw new TypeError('Registration requires an OTP verifier');

  return async function verifyRegistrationOtp({ tenantId, phone, email, code }) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) return false;
    if (await verifyOTPAsync(phone, code, 'phone_verify', tenantId)) return true;
    return email ? Boolean(await verifyOTPAsync(email, code, 'phone_verify', tenantId)) : false;
  };
}

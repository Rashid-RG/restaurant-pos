// Distinct OTP purposes must never be interchangeable.
// Login is the only OTP purpose permitted to mint a customer session token.
export const OTP_PURPOSES = Object.freeze(['login', 'phone_verify', 'order_verify']);
export const isOtpPurpose = purpose => OTP_PURPOSES.includes(purpose);
export const canCreateCustomerSession = purpose => purpose === 'login';

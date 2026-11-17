/** Identity-domain boundary for customer validation and staff provisioning. */
export { isValidSriLankanPhone, isValidAddress } from './contact-validation.js';
export { generateStrongPassword, generateSecurePin } from './credential-generation.js';

export { PASSWORD_RESET_TTL_MS, createPasswordResetIssuer } from './password-reset.js';

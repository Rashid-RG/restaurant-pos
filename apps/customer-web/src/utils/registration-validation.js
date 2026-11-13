// Shared, testable frontend validation. Backend independently enforces both constraints.
export function isSixDigitOtp(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value.trim());
}
export function validRegistrationPassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 72;
}

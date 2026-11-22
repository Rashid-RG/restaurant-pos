/**
 * Resolve an unconsumed password reset by private token or identifier + OTP.
 * The server supplies a database reader and hash function. Account lookup
 * stays with the route so customer tenant boundaries remain unchanged.
 */
export function createPasswordResetResolver({ dbGet, hashCode, now = () => Date.now() }) {
  if (typeof dbGet !== 'function' || typeof hashCode !== 'function' || typeof now !== 'function')
    throw new TypeError('Password reset resolver requires database, hash and clock providers');

  return async function resolveReset(userType, { token, email, code, lookupByEmail }) {
    const currentTime = now();
    if (token) {
      const row = await dbGet(
        'SELECT * FROM password_resets WHERE userType = ? AND tokenHash = ? AND consumedAt IS NULL',
        [userType, hashCode(token)]
      );
      if (row && row.expiresAt >= currentTime) return row;
      return null;
    }
    if (email && code) {
      const user = await lookupByEmail(email);
      if (!user) return null;
      const row = await dbGet(
        'SELECT * FROM password_resets WHERE userType = ? AND userId = ? AND codeHash = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
        [userType, user.id, hashCode(code)]
      );
      if (row && row.expiresAt >= currentTime) return row;
      return null;
    }
    return null;
  };
}

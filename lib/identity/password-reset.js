/**
 * Password-recovery record issuance for customer and staff flows.
 *
 * Preserves the existing reset ID format, token/OTP generators, 30-minute TTL,
 * and invalidate-before-insert sequence. The caller supplies persistence and
 * token functions; no database connection is opened here.
 */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export function createPasswordResetIssuer({
  dbRun, generateToken, generateOtp, hashCode,
  now = () => Date.now(), random = () => Math.random()
}) {
  for (const [name, dependency] of Object.entries({dbRun,generateToken,generateOtp,hashCode,now,random})) {
    if (typeof dependency !== 'function') throw new TypeError(`Password reset requires ${name}`);
  }
  return async function createPasswordReset(userType, userId) {
    const token = generateToken(24);
    const code = generateOtp(6);
    const id = `pr_${now()}_${random().toString(36).slice(2, 7)}`;
    await dbRun(
      'DELETE FROM password_resets WHERE userType = ? AND userId = ? AND consumedAt IS NULL',
      [userType, userId]
    );
    await dbRun(
      `INSERT INTO password_resets (id, userType, userId, tokenHash, codeHash, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userType, userId, hashCode(token), hashCode(code), now() + PASSWORD_RESET_TTL_MS, now()]
    );
    return {token, code};
  };
}

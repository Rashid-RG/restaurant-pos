// Test fixture: issue a real server-verifiable, tenant-bound proof in the
// isolated test database. No special production bypass or plaintext OTP.
import { issueOrderProof } from '../lib/order-verification.js';
export async function testCheckoutProof(dbRun, tenantId = 'default_tenant', destination = '0770000000') {
  const result = await issueOrderProof({dbRun,tenantId,destination});
  return result.checkoutProof;
}

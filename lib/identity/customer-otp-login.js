/**
 * Resolve an OTP-authenticated contact only inside the selected restaurant.
 * Registration saves phone numbers in E.164; the user may type 077... at login.
 * The OTP must already have passed single-use, purpose-bound verification.
 */
export function createCustomerOtpLoginLookup({dbGet,normalizeLkPhone}) {
  if(typeof dbGet!=='function'||typeof normalizeLkPhone!=='function')
    throw new TypeError('OTP login requires a database reader and phone normalizer');
  return async function findCustomerForOtpLogin(tenantId,contact) {
    if(typeof tenantId!=='string'||!tenantId.trim())
      throw new TypeError('Restaurant tenant required for customer OTP login');
    const clean=typeof contact==='string'?contact.trim():'';
    if(!clean)throw new TypeError('OTP login contact is required');
    if(clean.includes('@'))return dbGet(
      'SELECT * FROM customer_accounts WHERE tenant_id=? AND (LOWER(email)=? OR phone=? OR phone=?)',
      [tenantId,clean.toLowerCase(),'','']
    );
    const local=clean.replace(/[\s-]/g,'');
    const normalized=normalizeLkPhone(local);
    return dbGet(
      'SELECT * FROM customer_accounts WHERE tenant_id=? AND (LOWER(email)=? OR phone=? OR phone=?)',
      [tenantId,local,normalized,local]
    );
  };
}

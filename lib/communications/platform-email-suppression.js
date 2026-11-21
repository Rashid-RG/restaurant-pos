/**
 * Fail-closed recipient suppression for staged owner communications.
 * A verified provider suppression on an earlier message prevents further
 * sandbox sends to the same owner/address, even for new announcements.
 *
 * This module does not send mail or use addresses from an HTTP caller.
 */
const ADDRESS=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeSandboxAddress(value){
  const address=String(value||'').trim().toLowerCase();
  return address.length<=254&&ADDRESS.test(address)?address:null;
}

export async function ownerEmailIsSuppressed({dbGet,tenantId,userId,email}){
  const address=normalizeSandboxAddress(email);
  if(!tenantId||!userId||!address) return true;
  const row=await dbGet(`SELECT 1 AS suppressed
    FROM platform_owner_communication_email_receipts receipt
    JOIN platform_owner_communication_email_queue queued
      ON queued.announcementId=receipt.announcementId
      AND queued.tenant_id=receipt.tenant_id AND queued.userId=receipt.userId
    WHERE receipt.provider='brevo'
      AND queued.tenant_id=? AND queued.userId=?
      AND LOWER(queued.email)=?
      AND receipt.eventStatus IN ('hard_bounce','blocked','invalid','spam','unsubscribed')
    LIMIT 1`,[tenantId,userId,address]);
  return row?.suppressed===1 || row?.suppressed===true;
}

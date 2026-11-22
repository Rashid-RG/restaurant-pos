/**
 * Driver onboarding is a restaurant-owned trust decision.
 *
 * Platform owners may inspect aggregate state across tenants, not raw private
 * identity evidence or manager-facing review endpoints. A support session must
 * never substitute for a restaurant owner/manager authorization.
 */
export const DRIVER_REVIEW_PERMISSIONS=Object.freeze({
  platformOwner:Object.freeze(['verification:aggregate','verification:exceptions','verification:metrics']),
  restaurantOwner:Object.freeze(['verification:tenant-list','verification:tenant-document-read','verification:tenant-review','verification:tenant-final-approve']),
  restaurantManager:Object.freeze(['verification:tenant-list','verification:tenant-document-read','verification:tenant-review','verification:tenant-final-approve']),
  cashier:Object.freeze([]),
  driver:Object.freeze(['verification:own-submission'])
});
export function canReviewTenantDriver({role,tenantId},documentTenantId){
  return (role==='owner'||role==='manager') &&
    typeof tenantId==='string' && tenantId.length>0 && tenantId===documentTenantId;
}
export function safeDriverVerificationSummary(rows){
  // Count statuses only; never return driver IDs, phone numbers or identity images.
  const buckets={pending:0,manualApproved:0,manualResubmit:0,manualRejected:0,automatedIdentityVerified:0,automatedLicenceVerified:0};
  for(const row of rows){
    if(row.driver_status==='pending_approval')buckets.pending++;
    if(row.manual_review_status==='approved')buckets.manualApproved++;
    if(row.manual_review_status==='resubmit')buckets.manualResubmit++;
    if(row.manual_review_status==='rejected')buckets.manualRejected++;
    if(row.identity_status==='verified')buckets.automatedIdentityVerified++;
    if(row.licence_status==='verified')buckets.automatedLicenceVerified++;
  }
  return buckets;
}

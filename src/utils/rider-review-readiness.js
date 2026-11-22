import {managerLicenceClassMatches, verifiedLicenceExpiry} from '../../lib/driver-onboarding.js';

export function riderReviewReadiness(driver, review = {}, licence = {}, identityConfirmed = false) {
  const motor = driver.vehicleType !== 'Bicycle';
  const identity = review.identityKind || driver.applicationIdentityKind || 'nic';
  const kinds = ['identity_front', ...(identity === 'passport' ? [] : ['identity_back']), 'selfie',
    ...(motor ? ['licence_front', 'licence_back'] : [])];
  const received = new Set((driver.submittedDocumentKinds || '').split(','));
  const viewed = new Set((driver.reviewedDocumentKinds || '').split(','));
  const missing = kinds.filter(kind => !received.has(kind)).length;
  const unopened = kinds.filter(kind => !viewed.has(kind)).length;
  const licenceIssue = motor && !managerLicenceClassMatches(driver.vehicleType, licence.licenceClass)
    ? 'Select the matching vehicle class from the original licence.'
    : motor && verifiedLicenceExpiry(licence.expiry) === null ? 'Enter a valid licence expiry date.' : '';
  const manualIssue = missing ? `Waiting for ${missing} required document(s). Request resubmission if needed.`
    : unopened ? `Open the remaining ${unopened} document(s) before recording your review.`
    : !review.selfieMatched || !review.documentAuthenticityConfirmed ? 'Confirm the selfie match and the original documents.'
    : licenceIssue;
  const manualPass = driver.manualReviewStatus === 'approved';
  const providerPass = driver.providerIdentityEnabled && driver.identityStatus === 'verified' &&
    (!motor || !driver.providerLicenceRequired || driver.licenceDocumentStatus === 'verified');
  let evidenceIssue = '';
  if (!manualPass && !providerPass) evidenceIssue = 'Review the documents and record a manual pass before approving this rider.';
  else if (manualPass && motor && (driver.reviewedLicenceClass !== licence.licenceClass || driver.reviewedLicenceExpiry !== licence.expiry))
    evidenceIssue = 'Use the class and expiry from the saved review, or record a new document review.';
  else if (!manualPass && motor && driver.providerLicenceRequired &&
    (verifiedLicenceExpiry(driver.providerExpiry) === null || licence.expiry > driver.providerExpiry))
    evidenceIssue = 'Check the licence expiry against the provider record or complete a manual review.';
  const approvalIssue = evidenceIssue || licenceIssue || (!identityConfirmed ? 'Confirm the independent identity and vehicle check.' :
    motor && !licence.checked ? 'Confirm that you checked the original licence.' : '');
  return {manualIssue, evidenceIssue, approvalIssue};
}

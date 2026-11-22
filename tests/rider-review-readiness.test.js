import { expect, it } from 'vitest';
import { riderReviewReadiness } from '../src/utils/rider-review-readiness.js';

const docs = 'identity_front,identity_back,selfie,licence_front,licence_back';
const rider = { vehicleType:'Motorbike', submittedDocumentKinds:docs, reviewedDocumentKinds:docs };
const checks = { selfieMatched:true, documentAuthenticityConfirmed:true };
const licence = { licenceClass:'A', expiry:'2099-07-21', checked:true };
const assess = (changes = {}, fields = licence) => riderReviewReadiness({...rider,...changes}, checks, fields, true);

it('blocks final approval after licence attestation alone and permits recording the manual pass', () => {
  expect(assess().approvalIssue).toContain('manual pass');
  expect(assess().manualIssue).toBe('');
});
it('requires uploads and document views by this reviewer', () => {
  expect(assess({submittedDocumentKinds:'selfie'}).manualIssue).toContain('Waiting');
  expect(assess({reviewedDocumentKinds:'selfie'}).manualIssue).toContain('Open');
});
it('accepts an approved review only with matching licence details', () => {
  const saved = {manualReviewStatus:'approved', reviewedLicenceExpiry:licence.expiry, reviewedLicenceClass:'A'};
  expect(assess(saved).approvalIssue).toBe('');
  expect(assess(saved,{...licence,expiry:'2098-07-21'}).approvalIssue).toContain('saved review');
});
it('honours configured provider verification and expiry limits', () => {
  const provider = {providerIdentityEnabled:true, identityStatus:'verified', providerLicenceRequired:true,
    licenceDocumentStatus:'verified', providerExpiry:licence.expiry};
  expect(assess(provider).approvalIssue).toBe('');
  expect(assess({...provider,providerExpiry:'2090-01-01'}).approvalIssue).toContain('provider');
  expect(assess({...provider,licenceDocumentStatus:'review'}).approvalIssue).toContain('manual pass');
  expect(assess({...provider,providerIdentityEnabled:false}).approvalIssue).toContain('manual pass');
});
it('uses the passport and bicycle evidence requirements', () => {
  const docs='identity_front,selfie';
  const bicycle={vehicleType:'Bicycle',applicationIdentityKind:'passport',submittedDocumentKinds:docs,reviewedDocumentKinds:docs,manualReviewStatus:'approved'};
  expect(assess(bicycle,{})).toEqual({manualIssue:'',approvalIssue:'',evidenceIssue:''});
});

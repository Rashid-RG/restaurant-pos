import {describe,it,expect} from 'vitest';
import {DRIVER_REVIEW_PERMISSIONS,canReviewTenantDriver,safeDriverVerificationSummary} from '../lib/driver-review-access.js';

describe('Platform versus restaurant rider-document permission boundary',()=>{
 it('platform has oversight metrics, not private applicant evidence or final approval',()=>{
  expect(DRIVER_REVIEW_PERMISSIONS.platformOwner).toContain('verification:aggregate');
  expect(DRIVER_REVIEW_PERMISSIONS.platformOwner).not.toContain('verification:tenant-document-read');
  expect(DRIVER_REVIEW_PERMISSIONS.platformOwner).not.toContain('verification:tenant-final-approve');
  expect(DRIVER_REVIEW_PERMISSIONS.restaurantOwner).toContain('verification:tenant-document-read');
  expect(DRIVER_REVIEW_PERMISSIONS.restaurantManager).toContain('verification:tenant-review');
  expect(DRIVER_REVIEW_PERMISSIONS.cashier).toEqual([]);
 });
 it('limits document reviewer roles to their own restaurant',()=>{
  for(const role of ['owner','manager']){
   expect(canReviewTenantDriver({role,tenantId:'shop-1'},'shop-1')).toBe(true);
   expect(canReviewTenantDriver({role,tenantId:'shop-1'},'shop-2')).toBe(false);
  }
  for(const role of ['platformOwner','cashier','driver','staff']){
   expect(canReviewTenantDriver({role,tenantId:'shop-1'},'shop-1')).toBe(false);
  }
  expect(canReviewTenantDriver({role:'owner',tenantId:''},'')).toBe(false);
 });
 it('exposes only aggregate statuses and never source identity details',()=>{
  const rows=[
   {driver_status:'pending_approval',manual_review_status:'approved',identity_status:'verified',
     licence_status:'review',id:'sensitive-id',phone:'+94770000000',nic:'PRIVATE'},
   {driver_status:'pending_approval',manual_review_status:'resubmit',identity_status:'review',
     licence_status:'verified',email:'private@example.com'}
  ];
  const summary=safeDriverVerificationSummary(rows);
  expect(summary).toEqual({
   pending:2,manualApproved:1,manualResubmit:1,manualRejected:0,
   automatedIdentityVerified:1,automatedLicenceVerified:1
  });
  const serialized=JSON.stringify(summary);
  for(const secret of ['sensitive-id','+94770000000','PRIVATE','private@example.com'])
   expect(serialized).not.toContain(secret);
 });
});

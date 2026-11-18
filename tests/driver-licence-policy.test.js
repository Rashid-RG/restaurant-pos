import {describe,it,expect} from 'vitest';
import {verifiedLicenceExpiry, needsLicenceReview, requiredLicenceClass, managerLicenceClassMatches, providerLicenceClassMatches} from '../lib/driver-onboarding.js';

describe('restaurant-reviewed driver licence gate',()=>{
  const now=Date.parse('2026-11-18T12:00:00Z');
  it('accepts only an actual future ISO expiry date',()=>{
    expect(verifiedLicenceExpiry('2027-12-31',now)).toBe(Date.parse('2027-12-31T23:59:59.999Z'));
    for(const input of ['2026-11-17','2026-02-30','2027-13-01','2027-04-31','12/31/2027','']) {
      expect(verifiedLicenceExpiry(input,now)).toBeNull();
    }
  });
  it('blocks new self-registered rider sessions when licence missing or expired',()=>{
    expect(needsLicenceReview({licenseReviewRequired:1,licenseVerifiedUntil:null},now)).toBe(true);
    expect(needsLicenceReview({licenseReviewRequired:1,licenseVerifiedUntil:now-1},now)).toBe(true);
    expect(needsLicenceReview({licenseReviewRequired:1,licenseVerifiedUntil:now+10000},now)).toBe(false);
  });
  it('does not disrupt pre-existing restaurant drivers during migration',()=>{
    expect(needsLicenceReview({status:'available',licenseReviewRequired:0,licenseVerifiedUntil:null},now)).toBe(false);
  });
  it('enforces the correct Sri Lankan DMT class by courier vehicle', () => {
    expect(requiredLicenceClass('Motorbike')).toBe('A');
    expect(requiredLicenceClass('TukTuk')).toBe('B1');
    expect(requiredLicenceClass('Car')).toBe('B');
    expect(requiredLicenceClass('Bicycle')).toBeNull();
    for (const [vehicle,valid,wrong] of [
      ['Motorbike','A','B'],
      ['TukTuk','B1','B'],
      ['Car','B','A']
    ]) {
      expect(managerLicenceClassMatches(vehicle,valid)).toBe(true);
      expect(managerLicenceClassMatches(vehicle,wrong)).toBe(false);
    }
    expect(managerLicenceClassMatches('Bicycle',null)).toBe(true);
    expect(managerLicenceClassMatches('Helicopter','A')).toBe(false);
    // An A1-only licence is NOT enough for an unspecified larger motorbike.
    expect(managerLicenceClassMatches('Motorbike','A1')).toBe(false);
  });
  it('does not invent optional extracted licence categories',()=>{
    expect(providerLicenceClassMatches({},'Motorbike')).toBeNull();
    expect(providerLicenceClassMatches({additionalVerifiedData:{driversLicenseCategory:{A:true,B:false}}},'Motorbike')).toBe(true);
    expect(providerLicenceClassMatches({additionalVerifiedData:{driversLicenseCategory:{B:true}}},'Motorbike')).toBe(false);
    expect(providerLicenceClassMatches({additionalVerifiedData:{driversLicenseCategories:['B1']}},'TukTuk')).toBe(true);
    expect(providerLicenceClassMatches({additionalVerifiedData:{driversLicenseCategories:['B']}},'TukTuk')).toBe(false);
  });
});

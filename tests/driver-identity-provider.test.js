import {describe,it,expect,vi} from 'vitest';
import {veriffConfigured,trustedVeriffBase,veriffHmac,verifyVeriffWebhook,interpretVeriffDecision,createVeriffSession} from '../lib/driver-identity-provider.js';
const env={VERIFF_BASE_URL:'https://stationapi.veriff.com',VERIFF_API_KEY:'test-key',VERIFF_SHARED_SECRET:'test-secret'};

describe('Automated rider identity provider security boundary',()=>{
 it('refuses absent keys and untrusted API domains',()=>{
  expect(veriffConfigured({})).toBe(false);
  expect(()=>trustedVeriffBase('https://veriff.com.evil.example')).toThrow();
  expect(()=>trustedVeriffBase('http://stationapi.veriff.com')).toThrow();
  expect(trustedVeriffBase('https://stationapi.veriff.com')).toBe('https://stationapi.veriff.com');
 });
 it('verifies signed raw decision payloads and rejects tampering',()=>{
  const raw=Buffer.from(JSON.stringify({verification:{id:'session-1',status:'approved'}}));
  const signature=veriffHmac(raw,env.VERIFF_SHARED_SECRET);
  expect(verifyVeriffWebhook({rawBody:raw,signature,authClient:env.VERIFF_API_KEY,env})).toBe(true);
  expect(verifyVeriffWebhook({rawBody:Buffer.concat([raw,Buffer.from(' ')]),signature,authClient:env.VERIFF_API_KEY,env})).toBe(false);
  expect(verifyVeriffWebhook({rawBody:raw,signature,authClient:'other',env})).toBe(false);
  expect(verifyVeriffWebhook({rawBody:raw,signature:'wrong',authClient:env.VERIFF_API_KEY,env})).toBe(false);
 });
 it('maps provider decisions without assigning operational delivery access',()=>{
  expect(interpretVeriffDecision({verification:{id:'session-1',status:'approved'}})).toEqual({sessionId:'session-1',state:'verified'});
  expect(interpretVeriffDecision({verification:{id:'session-1',status:'resubmission_requested'}}).state).toBe('resubmit');
  expect(interpretVeriffDecision({verification:{id:'session-1',status:'unknown'}}).state).toBe('review');
  expect(interpretVeriffDecision({verification:{status:'approved'}})).toBeNull();
 });
 it('requires an actual approved LK driving licence and extracted future expiry',()=>{
   const base={verification:{id:'licence-session',status:'approved',document:{type:'DRIVERS_LICENSE',country:'LK',validUntil:'2028-01-31'}}};
   const accepted=interpretVeriffDecision(base,'driving_licence',Date.parse('2026-11-18T00:00:00Z'));
   expect(accepted).toEqual({sessionId:'licence-session',state:'verified',documentExpiry:'2028-01-31'});
   for(const document of [
     {type:'PASSPORT',country:'LK',validUntil:'2028-01-31'},
     {type:'DRIVERS_LICENSE',country:'US',validUntil:'2028-01-31'},
     {type:'DRIVERS_LICENSE',country:'LK',validUntil:null},
     {type:'DRIVERS_LICENSE',country:'LK',validUntil:'2020-01-01'},
     {type:'DRIVERS_LICENSE',country:'LK',validUntil:'2028-02-30'},
     {type:'DRIVERS_LICENSE',country:'LK',validUntil:'2028-01-31',specimen:{nonStandardDrivingLicense:true}},
     {type:'DRIVERS_LICENSE',country:'LK',validUntil:'2028-01-31',specimen:{hasSecurityRisk:true}}
   ]) {
     expect(interpretVeriffDecision({verification:{...base.verification,document}},'driving_licence',Date.parse('2026-11-18T00:00:00Z')).state).toBe('review');
   }
   expect(interpretVeriffDecision({verification:{id:'licence-session',status:'declined',document:base.verification.document}},'driving_licence').state).toBe('rejected');
 });
 it('routes extracted mismatching driving classes to manual review',()=>{
    const base={verification:{id:'licence-3',status:'approved',document:{type:'DRIVERS_LICENSE',country:'LK',validUntil:'2028-01-31'}}};
    const now=Date.parse('2026-11-18T00:00:00Z');
    expect(interpretVeriffDecision({...base,verification:{...base.verification,additionalVerifiedData:{driversLicenseCategories:['B']}}},'driving_licence',now,'Motorbike').state).toBe('review');
    expect(interpretVeriffDecision({...base,verification:{...base.verification,additionalVerifiedData:{driversLicenseCategories:['A']}}},'driving_licence',now,'Motorbike').state).toBe('verified');
    // Category extraction is optional; it cannot silently claim to verify a class.
    expect(interpretVeriffDecision(base,'driving_licence',now,'Motorbike').state).toBe('verified');
    expect(interpretVeriffDecision({...base,verification:{...base.verification,additionalVerifiedData:{driversLicenseCategory:{B1:true}}}},'driving_licence',now,'TukTuk').state).toBe('verified');
 });
 it('requests document-specific LK driving-licence capture at the provider, not an unrestricted ID', async()=>{
   const mock=vi.fn(async()=>({ok:true,json:async()=>({verification:{id:'license-1',url:'https://magic.veriff.com/v/licence-1'}})}));
   await createVeriffSession({driverId:'drv_1234567890-abc',checkType:'driving_licence',env,fetchImpl:mock});
   const payload=JSON.parse(mock.mock.calls[0][1].body);
   expect(payload.verification.document).toEqual({type:'DRIVERS_LICENSE',country:'LK'});
 });
 it('creates a provider-hosted session without sending identity documents or tenant secrets',async()=>{
  const mock=vi.fn(async(url,init)=>({ok:true,json:async()=>({verification:{id:'v-1',url:'https://magic.veriff.com/v/v-1'}})}));
  const result=await createVeriffSession({driverId:'drv_1234567890-abc',env,fetchImpl:mock});
  expect(result).toEqual({sessionId:'v-1',url:'https://magic.veriff.com/v/v-1'});
  const [url,options]=mock.mock.calls[0];
  expect(url).toBe('https://stationapi.veriff.com/v1/sessions');
  expect(JSON.parse(options.body)).toEqual({verification:{vendorData:'drv_1234567890-abc'}});
  expect(options.headers['x-hmac-signature']).toBe(veriffHmac(options.body,env.VERIFF_SHARED_SECRET));
 });
});

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

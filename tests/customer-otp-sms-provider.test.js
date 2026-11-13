import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectedSmsProvider, isSmsConfigured, sendSms } from '../lib/notifications.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Sri Lanka SMS OTP provider configuration', () => {
  it('defaults to Twilio only when its credentials are complete', () => {
    expect(selectedSmsProvider({})).toBe('twilio');
    expect(isSmsConfigured({ TWILIO_ACCOUNT_SID:'a',TWILIO_AUTH_TOKEN:'b', TWILIO_FROM_NUMBER:'c' })).toBe(true);
    expect(isSmsConfigured({ TWILIO_ACCOUNT_SID:'a' })).toBe(false);
  });
  it('requires an approved Notify.lk sender ID and keys; never enables a demo sender', () => {
    expect(selectedSmsProvider({ SMS_PROVIDER:'notifylk' })).toBe('notifylk');
    expect(isSmsConfigured({SMS_PROVIDER:'notifylk',NOTIFY_LK_USER_ID:'1',NOTIFY_LK_API_KEY:'secret',NOTIFY_LK_SENDER_ID:'NotifyDEMO'})).toBe(false);
    expect(isSmsConfigured({SMS_PROVIDER:'notifylk',NOTIFY_LK_USER_ID:'1',NOTIFY_LK_API_KEY:'secret',NOTIFY_LK_SENDER_ID:'GastroFlow'})).toBe(true);
    expect(selectedSmsProvider({SMS_PROVIDER:'dev'})).toBe('unavailable');
  });
  it('sends to Notify.lk via POST without credentials in the URL and never fakes acceptance', async () => {
    vi.stubEnv('SMS_PROVIDER','notifylk');
    vi.stubEnv('NOTIFY_LK_USER_ID','usr');
    vi.stubEnv('NOTIFY_LK_API_KEY','secret');
    vi.stubEnv('NOTIFY_LK_SENDER_ID','GastroFlow');
    const fetchMock=vi.fn().mockResolvedValue({ ok:true, json:async()=>({status:'success'}) });
    vi.stubGlobal('fetch',fetchMock);
    expect(await sendSms({to:'0771234567',message:'test code'})).toMatchObject({success:true,provider:'notifylk'});
    const [url,options]=fetchMock.mock.calls[0];
    expect(url).toBe('https://app.notify.lk/api/v1/send');
    expect(options.method).toBe('POST');
    expect(url).not.toContain('secret');
    const body=new URLSearchParams(options.body);
    expect(body.get('to')).toBe('94771234567');
    expect(body.get('sender_id')).toBe('GastroFlow');
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({status:'failed'})});
    expect((await sendSms({to:'0771234567',message:'test'})).success).toBe(false);
  });
});

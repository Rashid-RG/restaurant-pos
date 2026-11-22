import { describe, it, expect, vi } from 'vitest';
import { brevoSettings, sendBrevoEmail } from '../lib/brevo-email.js';
import { isEmailConfigured } from '../lib/notifications.js';

const env = {
  EMAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'fake-test-api-key',
  BREVO_FROM_EMAIL: 'hello@example.test',
  BREVO_FROM_NAME: 'GastroFlow'
};
const message = {to:'buyer@example.test',subject:'Verification',html:'<p>Code</p>',text:'Code'};

describe('Brevo free-tier transactional OTP adapter', () => {
  it('requires both a server API key and a sender address', () => {
    expect(brevoSettings({BREVO_API_KEY:'abc'}).configured).toBe(false);
    expect(brevoSettings({BREVO_FROM_EMAIL:'hello@example.test'}).configured).toBe(false);
    expect(brevoSettings({BREVO_API_KEY:'abc',BREVO_FROM_EMAIL:'bad'}).configured).toBe(false);
    expect(brevoSettings(env).configured).toBe(true);
    expect(isEmailConfigured({...env,BREVO_API_KEY:''})).toBe(false);
    expect(isEmailConfigured({...env,BREVO_FROM_EMAIL:''})).toBe(false);
    expect(isEmailConfigured(env)).toBe(true);
  });
  it('submits an OTP only to the secure Brevo transactional email API', async () => {
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({messageId:'id-123'})});
    const result=await sendBrevoEmail({...message,env,fetcher});
    expect(result).toEqual({success:true,provider:'brevo',messageId:'id-123'});
    const [url,config]=fetcher.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(config.method).toBe('POST');
    expect(config.headers['api-key']).toBe('fake-test-api-key');
    expect(config.body).not.toContain('fake-test-api-key');
    expect(JSON.parse(config.body).sender).toEqual({name:'GastroFlow',email:'hello@example.test'});
  });
  it('does not report delivery success if Brevo rejects or cannot confirm the request', async () => {
    for (const response of [
      {ok:false,status:400},
      {ok:false,status:429},
      {ok:true,json:async()=>({})}
    ]) {
      const result=await sendBrevoEmail({...message,env,fetcher:vi.fn().mockResolvedValue(response)});
      expect(result.success).toBe(false);
    }
    const result=await sendBrevoEmail({...message,env,fetcher:vi.fn().mockRejectedValue(Error('offline'))});
    expect(result).toMatchObject({success:false});
    expect(JSON.stringify(result)).not.toContain('fake-test-api-key');
  });
  it('never attempts a provider request with missing configuration', async () => {
    const fetcher=vi.fn();
    expect((await sendBrevoEmail({...message,env:{BREVO_API_KEY:'fake'},fetcher})).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

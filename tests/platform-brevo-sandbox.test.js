import {describe,it,expect,vi} from 'vitest';
import {createSandboxBrevoSender,sandboxBrevoReady} from '../lib/communications/platform-brevo-sandbox.js';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'test@example.test',
 PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT:'brevo_sandbox',
 BREVO_API_KEY:'fake-test-key',
 BREVO_FROM_EMAIL:'approved-sender@example.test'
};
const job={to:'test@example.test',subject:'System announcement',text:'This is a test notice',idempotencyKey:'notice1:tenant1:user1'};
describe('Explicit Brevo sandbox adapter (never auto mounted)',()=>{
  it('fails closed without the separate provider-send flag',async()=>{
    const fetcher=vi.fn();
    const send=createSandboxBrevoSender({env:{...env,PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'false'},fetcher});
    expect((await send(job)).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never calls provider for an address outside exact staging allowlist',async()=>{
    const fetcher=vi.fn();
    const send=createSandboxBrevoSender({env,fetcher});
    expect((await send({...job,to:'customer@example.com'})).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires a valid verified sender configuration',()=>{
    expect(sandboxBrevoReady({...env,BREVO_API_KEY:''})).toBe(false);
    expect(sandboxBrevoReady({...env,PLATFORM_COMMUNICATIONS_STAGE:'production'})).toBe(false);
    expect(sandboxBrevoReady({...env,PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'})).toBe(false);
    expect(sandboxBrevoReady(env)).toBe(true);
  });
  it('returns provider acceptance as acceptance, not final mailbox delivery',async()=>{
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'sandbox-msg-1'})}));
    const send=createSandboxBrevoSender({env,fetcher});
    const result=await send(job);
    expect(result).toMatchObject({success:true,accepted:true,provider:'brevo',providerMessageId:'sandbox-msg-1'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,request]=fetcher.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    const body=JSON.parse(request.body);
    expect(body.to).toEqual([{email:'test@example.test'}]);
    expect(body.textContent).toBe(job.text);
  });
  it('does not expose provider error body',async()=>{
    const fetcher=vi.fn(async()=>({ok:false,status:400}));
    const send=createSandboxBrevoSender({env,fetcher});
    const result=await send(job);
    expect(result).toEqual({success:false,reason:'BREVO_UNCONFIRMED'});
  });
});

import {describe,it,expect} from 'vitest';
import {platformCommunicationDeliveryReadiness} from '../lib/communications/platform-delivery-readiness.js';

const readyConfiguration={
  PLATFORM_COMMUNICATIONS_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_STAGE:'staging',
  PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
  PLATFORM_COMMUNICATIONS_TEST_EMAILS:'first@example.test,second@example.test',
  PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT:'brevo_sandbox',
  BREVO_API_KEY:'fake-not-a-real-key',
  BREVO_FROM_EMAIL:'sender@example.test',
  PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN:'staging-fake-test-token-00000000000000000',
  PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_STOP:'false',
  PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK:'I_APPROVE_STAGING_SANDBOX_WORKER',
  PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'2'
};

describe('Platform Communication Center read-only readiness',()=>{
  it('fails closed without any configuration or side effects',()=>{
    const result=platformCommunicationDeliveryReadiness({});
    expect(result).toMatchObject({
      stagingFeatureEnabled:false,stagingDatabaseIsolationAttested:false,
      sandboxEmailQueueEnabled:false,sandboxTransportReady:false,
      webhookAuthenticationConfigured:false,workerConfigurationReady:false,
      workerEmergencyStopArmed:true,
      automaticProviderDeliveryEnabled:false,verifiedSandboxMailboxDelivery:false,
      nativePushOperational:false,commercialReleaseReady:false,
      schedulerConnected:false,configuredTestRecipientCount:0
    });
    expect(JSON.stringify(result)).not.toContain('api-key');
  });
  it('does not claim a deployment or live mailbox success even when all flags are configured',()=>{
    const result=platformCommunicationDeliveryReadiness(readyConfiguration);
    expect(result).toMatchObject({
      stagingFeatureEnabled:true,stagingDatabaseIsolationAttested:true,
      sandboxEmailQueueEnabled:true,sandboxTransportReady:true,
      webhookAuthenticationConfigured:true,workerConfigurationReady:true,
      workerEmergencyStopArmed:false,configuredDailyMax:2,
      configuredTestRecipientCount:2,automaticProviderDeliveryEnabled:false,
      verifiedSandboxMailboxDelivery:false,nativePushOperational:false,
      commercialReleaseReady:false,schedulerConnected:false
    });
    const output=JSON.stringify(result);
    expect(output).not.toContain(readyConfiguration.BREVO_API_KEY);
    expect(output).not.toContain(readyConfiguration.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN);
    expect(output).not.toContain('first@example.test');
    expect(output).not.toContain('sender@example.test');
  });
  it('treats an armed emergency stop and absent database attestation as blocked',()=>{
    const disabled=platformCommunicationDeliveryReadiness({...readyConfiguration,
      PLATFORM_COMMUNICATIONS_EMAIL_STOP:'true',
      PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'
    });
    expect(disabled.workerConfigurationReady).toBe(false);
    expect(disabled.workerEmergencyStopArmed).toBe(true);
    expect(disabled.sandboxTransportReady).toBe(false);
    expect(disabled.webhookAuthenticationConfigured).toBe(false);
    expect(disabled.stagingDatabaseIsolationAttested).toBe(false);
    expect(disabled.commercialReleaseReady).toBe(false);
  });
  it('does not expose Brevo configuration in a production context',()=>{
    const result=platformCommunicationDeliveryReadiness({...readyConfiguration,PLATFORM_COMMUNICATIONS_STAGE:'production'});
    expect(result.stagingFeatureEnabled).toBe(false);
    expect(result.sandboxTransportReady).toBe(false);
    expect(result.workerConfigurationReady).toBe(false);
    expect(result.commercialReleaseReady).toBe(false);
  });
});

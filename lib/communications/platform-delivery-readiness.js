/**
 * Non-operational, read-only staging readiness snapshot.
 * Do NOT treat configured credentials or a feature gate as proof of delivery.
 * This module never contacts a provider, reads an email, or enables a sender.
 */
import {sandboxEmailConfig} from './platform-email-queue.js';
import {sandboxBrevoReady} from './platform-brevo-sandbox.js';
import {brevoWebhookEnabled} from './platform-brevo-webhook.js';
import {sandboxWorkerConfig} from './platform-sandbox-email-worker.js';
import {fcmSandboxConfig} from './platform-fcm-sandbox.js';
import {fcmTokenEnrollmentEnabled} from './platform-fcm-token-registry.js';

export function platformCommunicationDeliveryReadiness(env={}){
  const enabled=env.PLATFORM_COMMUNICATIONS_ENABLED==='true'&&
    env.PLATFORM_COMMUNICATIONS_STAGE==='staging';
  const queue=sandboxEmailConfig(env);
  const worker=sandboxWorkerConfig(env);
  const fcm=fcmSandboxConfig(env);
  return {
    stagingFeatureEnabled:enabled,
    stagingDatabaseIsolationAttested:enabled &&
      env.PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED==='true',
    sandboxEmailQueueEnabled:queue.enabled,
    configuredTestRecipientCount:queue.allowed.size,
    sandboxTransportReady:sandboxBrevoReady(env),
    webhookAuthenticationConfigured:brevoWebhookEnabled(env),
    workerConfigurationReady:worker.enabled,
    workerEmergencyStopArmed:env.PLATFORM_COMMUNICATIONS_EMAIL_STOP!=='false',
    configuredDailyMax:worker.dailyCap,
    schedulerConnected:false,
    automaticProviderDeliveryEnabled:false,
    verifiedSandboxMailboxDelivery:false,
    firebaseFcmAdapterConfigured:fcm.configured,
    firebaseFcmStagingGatesReady:fcm.enabled,
    firebaseFcmEmergencyStopArmed:env.PLATFORM_COMMUNICATIONS_FCM_STOP!=='false',
    firebaseFcmTokenEnrollmentReady:fcmTokenEnrollmentEnabled(env),
    firebaseFcmTokenRegistrationVerified:false,
    firebaseFcmDispatchConnected:false,
    nativePushOperational:false,
    commercialReleaseReady:false,
    sendingMode:'manual_unmounted',
    note:'Flags are configuration only. No provider delivery, mailbox receipt, database isolation, native push or commercial readiness is verified by this endpoint.'
  };
}

// Safe staging-only CORS configuration gate. Never outputs configured browser
// domains, API tokens, database identifiers, or other Render environment data.
import {auditStagingNativeCorsConfig} from '../lib/customer-cors-policy.js';

export function evaluateNativeStagingReadiness(env={}){
  const audit=auditStagingNativeCorsConfig({
    nativeOrigins:env.CUSTOMER_NATIVE_ORIGINS,
    corsOrigin:env.CORS_ORIGIN
  });
  const staging=env.RENDER_SERVICE_ID==='srv-dblpvdt9el5s73eebt0g' &&
    env.GASTROFLOW_TARGET==='staging';
  return {
    ready:staging&&audit.ready,
    stagingTargetVerified:staging,
    missingNativeOrigins:audit.missingNativeOrigins,
    invalidNativeOriginCount:audit.invalidNativeOriginCount,
    reservedNativeOriginInBrowserCors:audit.reservedNativeOriginInBrowserCors
  };
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=evaluateNativeStagingReadiness(process.env);
  console.log(JSON.stringify(result));
  if(!result.ready){
    console.error('Native staging CORS release gate failed. No environment settings were changed.');
    process.exitCode=1;
  }
}

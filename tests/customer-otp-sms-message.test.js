import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildTenantOtpSmsMessage} from '../lib/identity/otp-message.js';

describe('tenant-specific SMS verification',()=>{
  it('sends the correct restaurant name without sharing codes across tenants',()=>{
    expect(buildTenantOtpSmsMessage({storeName:'KB2C BBQ',code:'123456'})).toContain('Your KB2C BBQ verification code is 123456');
    expect(buildTenantOtpSmsMessage({storeName:'Another Shop',code:'123456'})).not.toContain('KB2C');
  });
  it('uses a safe fallback and rejects malformed verification codes',()=>{
    expect(buildTenantOtpSmsMessage({storeName:'',code:'234567'})).toContain('Your GastroFlow');
    expect(()=>buildTenantOtpSmsMessage({storeName:'Restaurant',code:'123'})).toThrow(/six-digit/);
  });
  it('loads the SMS store identity from the verified OTP tenant',()=>{
    const source=readFileSync('server.js','utf8');
    expect(source).toContain("getSettingAny(otpTenantId,['restaurantName','businessName'],'GastroFlow')");
    expect(source).toContain('buildTenantOtpSmsMessage({storeName,code})');
    expect(source).not.toContain('const msg = `Your ${storeName} verification code');
  });
});

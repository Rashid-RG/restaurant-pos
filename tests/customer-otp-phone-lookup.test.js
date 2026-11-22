import { describe,it,expect,vi } from 'vitest';
import { createCustomerOtpLoginLookup } from '../lib/identity/customer-otp-login.js';

const normalizeLkPhone = input => input.startsWith('0') ? '+94'+input.slice(1) : input;
describe('GastroFlow customer OTP login contact lookup',()=>{
  it('resolves local-format phone against canonical +94 registration in the same restaurant',async()=>{
    const calls=[];
    const dbGet=vi.fn(async(sql,args)=>{calls.push({sql,args});return {id:'acct-a',phone:'+94771234567'};});
    const lookup=createCustomerOtpLoginLookup({dbGet,normalizeLkPhone});
    expect(await lookup('tenant-a','0771234567')).toMatchObject({id:'acct-a'});
    expect(calls[0].args).toEqual(['tenant-a','0771234567','+94771234567','0771234567']);
    expect(calls[0].sql).toContain('WHERE tenant_id=?');
  });
  it('supports canonical phone and case-insensitive email without broad tenant access',async()=>{
    const dbGet=vi.fn(async()=>null);
    const lookup=createCustomerOtpLoginLookup({dbGet,normalizeLkPhone});
    await lookup('tenant-b','+94771234567');
    await lookup('tenant-b',' CUSTOMER@EXAMPLE.COM ');
    expect(dbGet.mock.calls[0][1][0]).toBe('tenant-b');
    expect(dbGet.mock.calls[1][1]).toEqual(['tenant-b','customer@example.com','', '']);
  });
  it('does not accept missing tenant or malformed contact',async()=>{
    const lookup=createCustomerOtpLoginLookup({dbGet:vi.fn(),normalizeLkPhone});
    await expect(lookup('','0771234567')).rejects.toThrow(/tenant/i);
    await expect(lookup('tenant-a','')).rejects.toThrow(/contact/i);
  });
});

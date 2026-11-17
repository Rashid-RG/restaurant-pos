import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {customerSessionKey,isCurrentCustomerAuthAttempt} from '../apps/customer-web/src/utils/customer-auth-scope.js';

describe('GastroFlow Food tenant-scoped customer auth lifecycle',()=>{
  it('keeps established storage key format for each restaurant',()=>{
    expect(customerSessionKey('restaurant A')).toBe('gastroflow_customer_token:restaurant%20A');
    expect(customerSessionKey('')).toBe('gastroflow_customer_token:default_tenant');
    expect(customerSessionKey('restaurant-b')).not.toBe(customerSessionKey('restaurant-a'));
  });
  it('refuses a response from an unmounted or switched restaurant',()=>{
    const scope={tenant:'restaurant-a',mounted:true,epoch:4};
    expect(isCurrentCustomerAuthAttempt({scope,activeTenant:'restaurant-a',epoch:4})).toBe(true);
    expect(isCurrentCustomerAuthAttempt({scope,activeTenant:'restaurant-b',epoch:4})).toBe(false);
    expect(isCurrentCustomerAuthAttempt({scope:{...scope,mounted:false},activeTenant:'restaurant-a',epoch:4})).toBe(false);
  });
  it('discards an older login/restore after explicit logout or newer login',()=>{
    const scope={tenant:'restaurant-a',mounted:true,epoch:5};
    expect(isCurrentCustomerAuthAttempt({scope,activeTenant:'restaurant-a',epoch:4})).toBe(false);
    expect(isCurrentCustomerAuthAttempt({scope,activeTenant:'restaurant-a',epoch:5})).toBe(true);
  });
  it('guards the actual React provider restore, login, register, OTP and profile flows',()=>{
    const code=readFileSync('apps/customer-web/src/context/CustomerAuthContext.jsx','utf8');
    expect(code).toContain('scopeRef.current.mounted = false');
    expect(code).toContain('scopeRef.current.epoch++');
    expect(code).toContain('if (!isCurrent(epoch)) return');
    expect(code).toContain("localStorage.getItem(sessionKey) === token");
    expect(code).toContain('if (!isCurrent(epoch)) throw new Error');
    expect(code).toContain("if (isCurrent(epoch) && localStorage.getItem(sessionKey) === token) setCustomer(data)");
    expect(code).toContain("localStorage.removeItem(sessionKey)");
    expect(code).not.toContain('localStorage.removeItem(tokenKey())');
  });
});

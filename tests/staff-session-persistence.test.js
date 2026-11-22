import { describe,it,expect } from 'vitest';
import { isExpiredStaffSession,restoreStaffSession } from '../src/utils/staff-session.js';

describe('POS browser-refresh login persistence',()=>{
  const store=(values)=>({getItem:key=>values[key]??null});
  it('restores a valid existing employee account only when a token exists',()=>{
    const user={id:'cashier-123',tenant_id:'restaurant-42',username:'cashier',role:'cashier'};
    expect(restoreStaffSession(store({'gastroflow_token':'valid-token','gastroflow_user':JSON.stringify(user)}))).toEqual(user);
    expect(restoreStaffSession(store({'gastroflow_user':JSON.stringify(user)}))).toBe(null);
  });
  it('recovers safely from damaged session JSON and never leaks another restaurant',()=>{
    expect(restoreStaffSession(store({'gastroflow_token':'abc','gastroflow_user':'{broken'}))).toBe(null);
    expect(restoreStaffSession(store({'gastroflow_token':'abc','gastroflow_user':'{"id":"cashier"}'}))).toBe(null);
  });
  it('does not sign out on billing restrictions, suspended tenant, permission errors, or transient server failures',()=>{
    expect(isExpiredStaffSession(403,{code:'SUBSCRIPTION_PAST_DUE',error:'Subscription needs attention.'})).toBe(false);
    expect(isExpiredStaffSession(403,{code:'TENANT_SUSPENDED',error:'This restaurant is unavailable.'})).toBe(false);
    expect(isExpiredStaffSession(403,{error:'Unauthorized. Insufficient role privileges.'})).toBe(false);
    expect(isExpiredStaffSession(403,{error:'Only an owner can perform this action.'})).toBe(false);
    expect(isExpiredStaffSession(503,{error:'Service temporarily unavailable'})).toBe(false);
    expect(isExpiredStaffSession(403,{})).toBe(false);
  });
  it('expires only on explicit invalid or expired login token responses',()=>{
    expect(isExpiredStaffSession(403,{error:'Token is invalid or has expired.'})).toBe(true);
    expect(isExpiredStaffSession(401,{error:'Authentication token required.'})).toBe(true);
    expect(isExpiredStaffSession(403,{code:'TOKEN_EXPIRED'})).toBe(true);
  });
});

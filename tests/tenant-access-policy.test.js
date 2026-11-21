import {describe,expect,it} from 'vitest';
import {
 STAFF_ROLES,isStaffClaim,isStaffAccountAuthorized,isExpectedRestaurant,
 isPlatformOwner,hasStaffRole,isCustomerTenantMatch
} from '../lib/tenancy/access-policy.js';

describe('commercial multi-tenant authentication policy',()=>{
  it('accepts only established staff JWT claim roles, never customer claims',()=>{
    for(const role of STAFF_ROLES)
      expect(isStaffClaim({id:'user_1',role,tenant_id:'shop_A'})).toBe(true);
    expect(isStaffClaim({id:'user_1',role:'owner',type:'customer'})).toBe(false);
    expect(isStaffClaim({id:'user_1',role:'driver'})).toBe(false);
    expect(isStaffClaim({role:'manager',tenant_id:'shop_A'})).toBe(false);
  });
  it('rejects token reuse from a different restaurant and revoked staff roles',()=>{
    const user={id:'user_1',role:'cashier',tenant_id:'shop_A'};
    expect(isStaffAccountAuthorized(user,{id:'user_1',role:'cashier',tenant_id:'shop_A'})).toBe(true);
    expect(isStaffAccountAuthorized(user,{id:'user_1',role:'cashier',tenant_id:'shop_B'})).toBe(false);
    expect(isStaffAccountAuthorized({...user,role:'driver'},{id:'user_1',role:'cashier',tenant_id:'shop_A'})).toBe(false);
    expect(isStaffAccountAuthorized(null,{tenant_id:'shop_A'})).toBe(false);
  });
  it('rejects wrong-store URLs at login and on authenticated requests',()=>{
    expect(isExpectedRestaurant({id:'shop_A'},'shop_A')).toBe(true);
    expect(isExpectedRestaurant({id:'shop_B'},'shop_A')).toBe(false);
    expect(isExpectedRestaurant(undefined,'shop_A')).toBe(false);
    expect(isExpectedRestaurant({id:'shop_A'},'')).toBe(false);
  });
  it('keeps platform owner privilege separate from restaurant owner role',()=>{
    expect(isPlatformOwner({role:'owner',isPlatformAdmin:1})).toBe(true);
    expect(isPlatformOwner({role:'owner',isPlatformAdmin:0})).toBe(false);
    expect(isPlatformOwner({role:'owner',isPlatformAdmin:true})).toBe(false);
    expect(isPlatformOwner({role:'manager',isPlatformAdmin:1})).toBe(false);
    expect(hasStaffRole({role:'manager'},['owner','manager'])).toBe(true);
    expect(hasStaffRole({role:'cashier'},['owner','manager'])).toBe(false);
  });
  it('keeps customer session restaurant binding and optional selector semantics',()=>{
    expect(isCustomerTenantMatch(undefined,'shop_A')).toBe(true);
    expect(isCustomerTenantMatch('shop_A','shop_A')).toBe(true);
    expect(isCustomerTenantMatch('shop_B','shop_A')).toBe(false);
  });
});

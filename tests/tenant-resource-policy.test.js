import {describe,expect,it} from 'vitest';
import {tenantResourceRequest,resourceIdsToAuthorize,resourceBelongsToTenant} from '../lib/tenancy/resource-policy.js';

describe('legacy POS multi-tenant resource ownership policy',()=>{
  it('maps only enumerated resource paths to safe database tables',()=>{
    const expected={
      '/orders/oa':'orders','/tables/t1':'tables','/menu_items/m1':'menu_items',
      '/categories/c1':'categories','/customers/a':'customers',
      '/ingredients/i1':'ingredients','/delivery/drivers/d1':'drivers',
      '/tickets/x':'support_tickets','/support/tickets/x':'support_tickets'
    };
    for(const [path,table] of Object.entries(expected))
      expect(tenantResourceRequest(path).table).toBe(table);
    expect(tenantResourceRequest('/unknown/x')).toBeNull();
    expect(tenantResourceRequest('/orders/anything/driver-chat')).toBeNull();
    expect(tenantResourceRequest('/tables/t1/qr')).toBeNull();
    expect(tenantResourceRequest(null)).toBeNull();
  });
  it('protects both path IDs and body-provided IDs for shop ownership checks',()=>{
    expect(resourceIdsToAuthorize(tenantResourceRequest('/orders/sale%20abc'),{id:'order-from-body'}))
      .toEqual(['sale abc','order-from-body']);
    expect(resourceIdsToAuthorize(tenantResourceRequest('/tables/transfer'),{
      id:'target',fromTableId:'from',toTableId:'to',sourceTableId:'source',targetTableId:'destination'
    })).toEqual(['target','from','to','source','destination']);
    expect(resourceIdsToAuthorize(tenantResourceRequest('/orders/offline-sync'),{})).toEqual([]);
  });
  it('rejects existing foreign records and permits current tenant IDs',()=>{
    expect(resourceBelongsToTenant({tenant_id:'restaurant-A'},'restaurant-A')).toBe(true);
    expect(resourceBelongsToTenant({tenant_id:'restaurant-B'},'restaurant-A')).toBe(false);
    expect(resourceBelongsToTenant({tenant_id:null},'restaurant-A')).toBe(false);
    expect(resourceBelongsToTenant(null,'restaurant-A')).toBe(true);
  });
});

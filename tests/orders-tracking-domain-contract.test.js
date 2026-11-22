import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import * as orders from '../lib/orders/index.js';
import * as legacy from '../lib/order-tracking.js';

describe('orders domain tracking compatibility and privacy', () => {
  it('preserves every previous tracking export', () => {
    for (const name of ['createTrackingGuard','makeTrackingAccess','publicTrackingEvent','loadAssignedDriverLocation'])
      expect(orders[name]).toBe(legacy[name]);
  });

  it('binds tracking capability to the exact order and tenant', () => {
    const access = orders.makeTrackingAccess('order-A', 'restaurant-A');
    expect(jwt.verify(access,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']}))
      .toMatchObject({type:'order_tracking',orderId:'order-A',tenantId:'restaurant-A'});
  });

  it('never exposes unrestricted payment or internal credentials in tracking events', () => {
    expect(orders.publicTrackingEvent({
      id:'order-A',status:'preparing',total:1200,tenant_id:'restaurant-A',
      customerPassword:'secret',paymentGatewaySecret:'secret',internalNotes:'private'
    })).toEqual({id:'order-A',status:'preparing',total:1200});
    expect(orders.publicTrackingEvent({type:'driver_location',lat:6.9,lng:79.8,driverToken:'private'}))
      .toEqual({type:'driver_location',lat:6.9,lng:79.8});
    expect(orders.publicTrackingEvent({type:'driver_assigned',orderId:'order-A',privateDriverPhone:'hidden'}))
      .toEqual({type:'driver_assigned',orderId:'order-A'});
  });

  it('limits rider GPS lookup to the requested order, tenant and assigned driver', async () => {
    const dbGet = vi.fn(async()=>({lat:6.9,lng:79.8}));
    await orders.loadAssignedDriverLocation(dbGet,'order-A','restaurant-A','driver-A');
    expect(dbGet).toHaveBeenCalledTimes(1);
    const [sql,params] = dbGet.mock.calls[0];
    expect(sql).toContain('o.tenant_id=? AND o.driverId=?');
    expect(params).toEqual(['order-A','restaurant-A','driver-A']);
    await expect(orders.loadAssignedDriverLocation(dbGet,'order-A','restaurant-A',null)).resolves.toBeNull();
    expect(dbGet).toHaveBeenCalledTimes(1);
  });

  it('returns not found before authorization when an order is not owned by tenant', async () => {
    const dbGet = vi.fn(async()=>null);
    const guard=orders.createTrackingGuard({
      dbGet,resolvePublicTenant:async()=> 'restaurant-B',
      authenticateToken:vi.fn(),authenticateDriver:vi.fn()
    });
    const req={params:{id:'restaurant-A-order'},headers:{}};
    const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
    const next=vi.fn();
    await guard(req,res,next);
    expect(dbGet).toHaveBeenCalledWith(
      expect.stringContaining('id=? AND tenant_id=?'),
      ['restaurant-A-order','restaurant-B']
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});

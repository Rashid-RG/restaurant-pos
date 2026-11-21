import {describe,it,expect} from 'vitest';
import {buildOrderStatusEmail} from '../lib/order-status-email.js';

const order = {id:'ord_online_test123',orderType:'takeaway',total:1800};
describe('restaurant-branded order stage email', () => {
  it('includes the actual restaurant and order for kitchen stages', () => {
    for (const status of ['preparing','ready','served','completed']) {
      const result=buildOrderStatusEmail({order,status,restaurantName:'KB2C BBQ'});
      expect(result.subject).toContain('KB2C BBQ');
      expect(result.html).toContain('KB2C BBQ');
      expect(result.html).toContain('ord_online_test123');
      expect(result.text).toContain('LKR 1800.00');
    }
  });
  it('emails delivered status for delivery without announcing kitchen handover as delivery', () => {
    const delivery={...order,orderType:'delivery'};
    expect(buildOrderStatusEmail({order:delivery,status:'served',restaurantName:'KB2C BBQ'})).toBeNull();
    const arrived=buildOrderStatusEmail({order:delivery,status:'delivered',restaurantName:'KB2C BBQ'});
    expect(arrived.subject).toContain('Order delivered');
    expect(buildOrderStatusEmail({order:delivery,status:'ready',restaurantName:'KB2C BBQ'}).subject).toContain('Food ready');
  });
  it('escapes untrusted restaurant text and ignores unsupported statuses', () => {
    const msg=buildOrderStatusEmail({order,status:'ready',restaurantName:'<script>alert(1)</script>'});
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(buildOrderStatusEmail({order,status:'payment_pending',restaurantName:'KB2C BBQ'})).toBeNull();
  });
});

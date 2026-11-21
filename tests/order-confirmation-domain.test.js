import { describe, expect, it, vi } from 'vitest';
import { createOrderConfirmationSender } from '../lib/communications/index.js';

function harness(overrides = {}) {
  const getSettingAny = vi.fn(async () => 'Restaurant A');
  const dbAll = vi.fn(async () => [{name:'Rice',quantity:2,price:250}]);
  const customerAppUrl = vi.fn(() => 'https://food.example.test');
  const buildOrderConfirmationEmail = vi.fn(() => '<p>Receipt</p>');
  const sendEmail = vi.fn(async () => {});
  const sendSms = vi.fn(async () => {});
  const logger = {error:vi.fn()};
  const dependencies = {
    getSettingAny,dbAll,customerAppUrl,buildOrderConfirmationEmail,sendEmail,sendSms,logger,
    ...overrides
  };
  return { sender:createOrderConfirmationSender(dependencies),...dependencies };
}
const order = {id:'order-A',tenant_id:'restaurant-A',invoiceNumber:42,total:1200,customerEmail:'test@example.test',customerPhone:'0771234567'};

describe('communication domain order confirmation contract', () => {
  it('requires explicit database and messaging providers', () => {
    expect(() => createOrderConfirmationSender({})).toThrow(TypeError);
  });

  it('uses the owning tenant for restaurant branding and sends the legacy receipt format', async () => {
    const h=harness();
    await h.sender(order);
    expect(h.getSettingAny).toHaveBeenCalledWith('restaurant-A',['businessName','restaurantName'],'GastroFlow');
    expect(h.dbAll).toHaveBeenCalledWith(
      'SELECT name, quantity, price FROM order_items WHERE orderId = ?', ['order-A']
    );
    expect(h.buildOrderConfirmationEmail).toHaveBeenCalledWith({
      order,invoiceNumber:'INV-000042',items:[{name:'Rice',quantity:2,price:250}],
      businessName:'Restaurant A',trackingUrl:'https://food.example.test/?track=order-A'
    });
    expect(h.sendEmail).toHaveBeenCalledWith({
      to:'test@example.test',
      subject:'GastroFlow · Order received from Restaurant A (INV-000042)',
      html:'<p>Receipt</p>'
    });
    expect(h.sendSms).toHaveBeenCalledWith({
      to:'0771234567',
      message:'Restaurant A: Order INV-000042 confirmed! Total: LKR 1200.00. Track: https://food.example.test/?track=order-A'
    });
  });

  it('continues SMS notification when email provider fails', async () => {
    const h=harness({sendEmail:vi.fn(async()=>{throw Error('smtp unavailable')})});
    await expect(h.sender(order)).resolves.toBeUndefined();
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledWith('[EMAIL] Order confirmation email failed:','smtp unavailable');
  });

  it('does not propagate SMS failure into order settlement', async () => {
    const h=harness({sendSms:vi.fn(async()=>{throw Error('sms unavailable')})});
    await expect(h.sender(order)).resolves.toBeUndefined();
    expect(h.logger.error).toHaveBeenCalledWith('sendOrderConfirmation error:','sms unavailable');
  });

  it('skips unavailable channels and retains order ID for unnumbered orders', async () => {
    const h=harness();
    await h.sender({id:'order-no-invoice',tenant_id:'restaurant-A',total:55});
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.dbAll).toHaveBeenCalledTimes(1);
  });
});

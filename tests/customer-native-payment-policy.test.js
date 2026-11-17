import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {canUseHostedPayHereGateway,payHerePaymentDisabled} from '../apps/customer-web/src/utils/native-payment-policy.js';

describe('GastroFlow Food native payment and hosted web isolation',()=>{
  it('leaves enabled hosted web checkout unchanged',()=>{
    expect(canUseHostedPayHereGateway('production')).toBe(true);
    expect(payHerePaymentDisabled('production',true)).toBe(false);
    expect(payHerePaymentDisabled('production',false)).toBe(true);
  });
  it('always blocks PayHere gateway in native even if server settings enable cards',()=>{
    expect(canUseHostedPayHereGateway('native')).toBe(false);
    expect(payHerePaymentDisabled('native',true)).toBe(true);
    expect(payHerePaymentDisabled('native',false)).toBe(true);
  });
  it('guards both order submission and HTML redirect, not merely the displayed radio button',()=>{
    const source=readFileSync('apps/customer-web/src/views/CartCheckoutView.jsx','utf8');
    expect(source).toContain("paymentMethod === 'payhere' && payHerePaymentDisabled(import.meta.env.MODE, rates.payhereEnabled)");
    expect(source).toContain("if (!canUseHostedPayHereGateway(import.meta.env.MODE)) throw new Error");
    expect(source).toContain("!payHereRedirectData || !canUseHostedPayHereGateway(import.meta.env.MODE)");
    expect(source).toContain("payHerePaymentDisabled(import.meta.env.MODE, rates.payhereEnabled)");
    expect(source).toContain("id: 'cash'");
    expect(source).toContain("id: 'bank_transfer'");
  });
});

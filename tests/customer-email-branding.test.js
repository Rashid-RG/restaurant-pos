import { describe, it, expect } from 'vitest';
import {buildWelcomeEmail,buildOtpEmail,buildOrderConfirmationEmail,buildPasswordResetEmail,buildSignInAlertEmail} from '../lib/email_templates.js';

describe('GastroFlow transactional email identity and accuracy', () => {
 it('brands customer welcome as GastroFlow without leaking the QA tenant name or making up rewards', () => {
   const html=buildWelcomeEmail({name:'Customer',loginUrl:'https://gastroflow-staging.onrender.com/customer/',businessName:'QA concurrency restaurant 1'});
   expect(html).toContain('Welcome to GastroFlow');
   expect(html).toContain('GastroFood customer account');
   expect(html).not.toContain('QA concurrency restaurant 1');
   expect(html).not.toContain('1 Loyalty Point');
   expect(html).not.toContain('123 Galle Road');
   expect(html).not.toContain('0760130922');
 });
 it('sends an accurate, non-reflected single-use 10-minute code', () => {
   const html=buildOtpEmail({code:'042315',purpose:'phone_verify',destination:'person@example.com',businessName:'QA concurrency restaurant 1'});
   expect(html).toContain('042315');
   expect(html).toContain('10 minutes');
   expect(html).not.toContain('5 minutes');
   expect(html).not.toContain('QA concurrency restaurant 1');
   expect(html).not.toContain('Your Verification Code: 042315');
 });
 it('keeps restaurant name on order acknowledgments without claiming unpaid orders have been paid', () => {
   const html=buildOrderConfirmationEmail({order:{id:'order1',total:2000,subtotal:2000,paymentStatus:'pending'},invoiceNumber:'INV-000321',items:[{name:'Rice',quantity:1,price:2000}],businessName:'Actual Restaurant',trackingUrl:'https://gastroflow-staging.onrender.com/customer/?track=order1'});
   expect(html).toContain('Actual Restaurant');
   expect(html).toContain('Gastro');
   expect(html).toContain('INV-000321');
   expect(html).not.toContain('INV-INV');
   expect(html).toContain('Payment pending');
   expect(html).not.toContain('Total Paid:');
 });
 it('escapes untrusted restaurant and item text in HTML and disallows javascript links', () => {
   const html=buildOrderConfirmationEmail({order:{id:'o',total:900},items:[{name:'<script>alert(1)</script>',quantity:1,price:900}],businessName:'<img src=x>',trackingUrl:'javascript:alert(1)'});
   expect(html).not.toContain('<script>');
   expect(html).not.toContain('<img src=x>');
   expect(html).not.toContain('href="javascript:');
   expect(html).toContain('&lt;script&gt;');
 });
 it('brands customer reset and sign-in alerts as GastroFlow', () => {
   const reset=buildPasswordResetEmail({userType:'customer',resetUrl:'https://gastroflow-staging.onrender.com/customer/?reset=abc',businessName:'QA concurrency restaurant 1'});
   const signIn=buildSignInAlertEmail({name:'Customer',loginTime:'13 Nov 2026',appUrl:'https://gastroflow-staging.onrender.com/customer/'});
   expect(reset).toContain('GastroFlow');
   expect(reset).not.toContain('QA concurrency restaurant 1');
   expect(signIn).toContain('New sign-in');
   expect(signIn).not.toContain('123 Galle Road');
 });
});

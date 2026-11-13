import { describe, expect, it } from 'vitest';
import { buildWelcomeEmail, buildOtpEmail, buildPasswordResetEmail, buildSignInAlertEmail, buildOrderConfirmationEmail } from '../lib/email_templates.js';

describe('email HTML structure and Gmail layout regression', () => {
  const outputs = [
    ['welcome', buildWelcomeEmail({name:'Test Customer'})],
    ['otp', buildOtpEmail({code:'123456',purpose:'login'})],
    ['reset', buildPasswordResetEmail({name:'Test Customer',userType:'customer',code:'111111'})],
    ['sign-in', buildSignInAlertEmail({name:'Test Customer',loginTime:'13 Nov 2026'})],
    ['order', buildOrderConfirmationEmail({order:{id:'order-1',total:1200},items:[],businessName:'Demo Restaurant'})],
  ];
  for (const [kind, html] of outputs) {
    it('renders a single header and valid table wrapper for '+kind, () => {
      expect(html.match(/<html\b/gi)?.length).toBe(1);
      expect(html.match(/<body\b/gi)?.length).toBe(1);
      expect(html.match(/<\/body>/gi)?.length).toBe(1);
      expect(html.match(/<\/html>/gi)?.length).toBe(1);
      expect((html.match(/gastroflow-email-logo\.png/g)||[]).length).toBe(1);
      expect((html.match(/FOOD · ORDER · TRACK/g)||[]).length).toBe(1);
      expect(html).not.toContain('2);">');
      expect(html).not.toContain('🍽️');
      expect(html).not.toContain('text-shadow: 0 2px');
      expect((html.match(/<table\b/gi)||[]).length).toBe((html.match(/<\/table\s*>/gi)||[]).length);
      expect((html.match(/<tr\b/gi)||[]).length).toBe((html.match(/<\/tr\s*>/gi)||[]).length);
      expect((html.match(/<td\b/gi)||[]).length).toBe((html.match(/<\/td\s*>/gi)||[]).length);
      expect(html).toContain('max-width:600px');
      expect(html).toContain('The GastroFlow Team');
    });
  }
});

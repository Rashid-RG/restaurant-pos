import { describe, it, expect } from 'vitest';
import {
  renderEmailBase, gastroFlowEmailLogoUrl,
  buildWelcomeEmail, buildOtpEmail, buildPasswordResetEmail,
  buildOrderConfirmationEmail, buildSignInAlertEmail
} from '../lib/email_templates.js';

describe('GastroFlow email logo rendering', () => {
  const png = 'https://gastroflow-staging.onrender.com/gastroflow-email-logo.png';
  it('uses the public PNG asset, not an unreliable SVG or internal data URI', () => {
    expect(gastroFlowEmailLogoUrl({RENDER_EXTERNAL_URL:'https://gastroflow-staging.onrender.com'})).toBe(png);
    expect(gastroFlowEmailLogoUrl({RENDER_EXTERNAL_URL:'http://insecure.example'})).toBe(png);
    expect(gastroFlowEmailLogoUrl({GASTROFLOW_EMAIL_ASSET_ORIGIN:'https://gastroflow.example'})).toBe('https://gastroflow.example/gastroflow-email-logo.png');
  });
  it('puts one accessible GastroFlow logo image at the top of each transactional template', () => {
    const emails = [
      buildWelcomeEmail({name:'User'}),
      buildOtpEmail({code:'098765'}),
      buildPasswordResetEmail({userType:'customer'}),
      buildOrderConfirmationEmail({order:{id:'test',total:120},items:[],businessName:'Test Restaurant'}),
      buildSignInAlertEmail({name:'User'})
    ];
    for (const html of emails) {
      expect(html).toContain('gastroflow-email-logo.png');
      expect(html).toContain('alt="GastroFlow"');
      expect(html).toContain('width="230" height="59"');
      expect((html.match(/gastroflow-email-logo.png/g) || []).length).toBe(1);
      expect(html).not.toContain('src="data:image');
    }
  });
  it('retains order restaurant identity without replacing GastroFlow platform logo', () => {
    const email = buildOrderConfirmationEmail({order:{id:'one',total:450},businessName:'My Restaurant'});
    expect(email).toContain('My Restaurant');
    expect(email).toContain('alt="GastroFlow"');
    expect(email).not.toContain('alt="My Restaurant"');
  });
});

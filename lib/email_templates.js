const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeLink = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? htmlEscape(url.toString()) : ''; } catch { return ''; } };
const moneyEmail = value => 'LKR ' + (Number(value) || 0).toFixed(2);

/**
 * GastroFlow — Modern HTML Email Template Engine
 * Features:
 *  - Sleek dark/violet gradient header banner with GastroFlow logo icon
 *  - Responsive card container with clean typography and spacing
 *  - High-contrast Call to Action (CTA) buttons
 *  - Context-relevant security & operational notes
 *  - Professional team signature & Sri Lanka business contact details footer
 */

export function renderEmailBase({ title, preheader, bodyHtml, businessName = 'GastroFlow' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f8f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; max-height: 0px; overflow: hidden;">${preheader}</div>` : ''}

  <!-- Main Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f8f6; padding: 30px 12px;">
    <tr>
      <td align="center">
        <!-- Email Container (600px Max) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #d9ebe0;">
          
          <!-- Header Banner with Logo -->
          <tr>
            <td style="background-color: #08694a; padding: 32px 24px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <!-- Brand Icon -->
                    <div style="display: inline-block; width: 56px; height: 56px; line-height: 56px; background: rgba(255, 255, 255, 0.2); border-radius: 16px; font-size: 32px; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
                      🍽️
                    </div>
                    <h1 style="color: #ffffff; font-size: 26px; font-weight: 800; margin: 14px 0 4px; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                      Gastro<span style="color:#ffce8f">Flow</span>
                    </h1>
                    <p style="color: #e0e7ff; font-size: 13px; margin: 0; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">
                      FOOD · ORDER · TRACK
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td style="padding: 32px 26px; color: #19372e; font-size: 15px; line-height: 1.6;">
              ${bodyHtml}

              <!-- Signature Section -->
              <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid #e0ebe5;">
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">Warm regards,</p>
                <p style="margin: 4px 0 0; color: #f8fafc; font-size: 15px; font-weight: 700;">The GastroFlow Team</p>
                <p style="margin: 2px 0 0; color: #64748b; font-size: 12px;">Customer account and ordering services</p>
              </div>
            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="background-color: #f3f8f5; padding: 22px 26px; text-align: center; border-top: 1px solid #e0ebe5; color: #64748b; font-size: 12px; line-height: 1.6;">
              <p style="margin:0 0 6px;color:#087653;font-weight:700">GastroFlow · Food ordering and restaurant technology</p>
              <p style="margin:0 0 8px">For help, visit the support section in the GastroFood app.</p>
              <p style="margin: 12px 0 0; color: #475569; font-size: 11px;">
                © ${new Date().getFullYear()} GastroFlow. This is an account or order notification.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * 1. Order Confirmation & Receipt Email Template
 */
export function buildOrderConfirmationEmail({ order = {}, invoiceNumber, items = [], businessName = 'Your restaurant', trackingUrl = '' } = {}) {
  const invRaw = String(invoiceNumber || order.invoiceNumber || order.id || 'Pending').replace(/^INV-/i, '');
  const inv = invRaw === 'Pending' ? 'Pending' : `INV-${invRaw}`;
  const paid = String(order.paymentStatus || '').toLowerCase() === 'paid';
  const paymentLabel = paid ? 'Paid' : 'Payment pending / payable at pickup or delivery';
  const rows = items.map(item => {
    const subtotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
    return `<tr><td style="padding:12px 3px 12px 0;border-bottom:1px solid #e7efe9;font-size:13px;color:#183b30">${htmlEscape(item.name)}${item.notes ? `<div style="font-size:12px;color:#64748b;margin-top:4px">Note: ${htmlEscape(item.notes)}</div>` : ''}</td><td align="center" style="padding:12px 3px;border-bottom:1px solid #e7efe9;color:#526c60;font-size:13px">${htmlEscape(item.quantity)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e7efe9;color:#183b30;font-weight:700;font-size:13px">${moneyEmail(subtotal)}</td></tr>`;
  }).join('');
  const amountRow = (label, amount, emphasis = false) => `<tr><td style="padding:9px 0;font-size:${emphasis ? 16 : 13}px;font-weight:${emphasis ? 800 : 500};color:#183b30">${label}</td><td align="right" style="padding:9px 0;font-size:${emphasis ? 18 : 13}px;font-weight:${emphasis ? 800 : 600};color:${emphasis ? '#08694a' : '#183b30'}">${moneyEmail(amount)}</td></tr>`;
  const link = safeLink(trackingUrl);
  const bodyHtml = `
    <h2 style="color:#143d30;font-size:25px;line-height:1.25;margin:0 0 14px">Your order has been received</h2>
    <p style="font-size:15px;color:#4a6055;line-height:1.7;margin:0 0 22px">Your order with <strong>${htmlEscape(businessName)}</strong> is recorded. Check its status in GastroFood for preparation and delivery updates.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eff9f3;border-radius:12px;margin:0 0 25px"><tr><td style="padding:18px">
      <p style="margin:0 0 8px;color:#526c60;font-size:12px">Order reference</p><p style="margin:0 0 11px;color:#08694a;font-size:18px;font-weight:800">${htmlEscape(inv)}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#183b30">Restaurant: <strong>${htmlEscape(businessName)}</strong></p>
      <p style="margin:0;font-size:13px;color:#183b30">Payment: <strong>${htmlEscape(paymentLabel)}</strong></p>
    </td></tr></table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><th align="left" style="color:#64748b;font-size:12px;padding:0 0 10px">Item</th><th style="color:#64748b;font-size:12px;padding:0 0 10px">Qty</th><th align="right" style="color:#64748b;font-size:12px;padding:0 0 10px">Price</th></tr>${rows}</table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:15px 0 8px">
      ${amountRow('Subtotal',order.subtotal ?? order.total)}
      ${Number(order.discount)>0 ? amountRow('Discount',-Number(order.discount)) : ''}
      ${Number(order.serviceCharge)>0 ? amountRow('Service charge',order.serviceCharge) : ''}
      ${Number(order.tax)>0 ? amountRow('Tax',order.tax) : ''}
      ${Number(order.deliveryFee)>0 ? amountRow('Delivery fee',order.deliveryFee) : ''}
      ${amountRow('Total',order.total,true)}
    </table>
    ${link ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="background-color:#087653;border-radius:12px"><a href="${link}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px">Track your order</a></td></tr></table>` : ''}
    <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.7">This order acknowledgment is not proof of payment unless the payment status above is marked Paid.</p>
  `;
  return renderEmailBase({title:`GastroFlow order ${inv} — ${businessName}`,preheader:`Order ${inv} received from ${businessName}.`,bodyHtml,businessName});
}
/**
 * 2. OTP Verification Email Template
 */
export function buildOtpEmail({ code, purpose = 'phone_verify', destination = '' } = {}) {
  const action = purpose === 'login' ? 'sign in to your account' : purpose === 'order_verify' ? 'confirm your order' : 'create your GastroFood account';
  const bodyHtml = `
    <h2 style="color:#143d30;font-size:25px;font-weight:800;line-height:1.3;margin:0 0 15px">Your verification code</h2>
    <p style="color:#4a6055;font-size:15px;line-height:1.7;margin:0 0 22px">Use the following one-time code to ${htmlEscape(action)}${destination ? ` for <strong>${htmlEscape(destination)}</strong>` : ''}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff9f3;border:1px solid #cce6d7;border-radius:13px"><tr><td align="center" style="padding:24px 9px">
      <p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:1.3px;color:#087653">ONE-TIME CODE</p>
      <p style="font-size:36px;line-height:42px;font-weight:800;letter-spacing:7px;color:#08694a;font-family:Arial,Helvetica,sans-serif;margin:0">${htmlEscape(code)}</p>
      <p style="color:#526c60;font-size:12px;margin:13px 0 0">Expires in 10 minutes · Single use</p>
    </td></tr></table>
    <p style="font-size:13px;color:#53695d;line-height:1.7;margin:20px 0 0">Never share this code with anyone, including restaurant staff or GastroFlow support. If you didn't request this, you can ignore this email.</p>
  `;
  return renderEmailBase({title:'Your GastroFlow verification code',preheader:'A GastroFlow verification code was requested. Valid for 10 minutes.',bodyHtml,businessName:'GastroFlow'});
}
/**
 * 3. Password Reset Email Template
 */
export function buildPasswordResetEmail({ name, userType = 'customer', resetUrl = '', code = '', businessName = 'GastroFlow' } = {}) {
  const isStaff = userType !== 'customer';
  const context = isStaff ? `your staff account at ${htmlEscape(businessName)}` : 'your GastroFlow customer account';
  const link = safeLink(resetUrl);
  const bodyHtml = `
    <h2 style="color:#143d30;font-size:25px;font-weight:800;line-height:1.3;margin:0 0 15px">Reset your password</h2>
    <p style="color:#4a6055;font-size:15px;line-height:1.7;margin:0 0 20px">${name ? `Hi <strong>${htmlEscape(name)}</strong>, ` : ''}We received a request to reset the password for ${context}.</p>
    ${link ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background-color:#087653;border-radius:12px"><a href="${link}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800">Reset password</a></td></tr></table>` : ''}
    ${code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eff9f3;border:1px solid #d2e7da;border-radius:12px;margin:22px 0"><tr><td align="center" style="padding:20px"><p style="font-size:12px;color:#526c60;margin:0 0 10px">Or use this reset code</p><p style="font-size:30px;letter-spacing:6px;color:#08694a;font-weight:800;margin:0">${htmlEscape(code)}</p></td></tr></table>` : ''}
    <p style="color:#526c60;font-size:13px;line-height:1.7;margin:22px 0 0">This request expires in 30 minutes. If you didn't request it, ignore this email; your password will not change.</p>
  `;
  return renderEmailBase({title:'Reset your GastroFlow password',preheader:'Password reset instructions for your GastroFlow account.',bodyHtml,businessName:isStaff?businessName:'GastroFlow'});
}
/**
 * 4. Welcome Email Template
 */
export function buildWelcomeEmail({ name = 'there', loginUrl = '' } = {}) {
  const safeName = htmlEscape(name);
  const url = safeLink(loginUrl);
  const bodyHtml = `
    <h2 style="color:#143d30;font-size:25px;font-weight:800;line-height:1.3;margin:0 0 16px">Welcome to GastroFlow!</h2>
    <p style="color:#4a6055;font-size:15px;line-height:1.75;margin:0 0 22px">Hi <strong>${safeName}</strong>, your GastroFood customer account is ready. You can explore restaurants and order food through the app.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eff9f3;border:1px solid #d3eadd;border-radius:12px;margin:0 0 22px"><tr><td style="padding:18px">
      <p style="margin:0 0 9px;color:#08694a;font-weight:800;font-size:14px">Your account is ready</p>
      <p style="margin:0;color:#4a6055;font-size:13px;line-height:1.7">Browse restaurants that are accepting orders, save your delivery details and follow your order status. Available features vary by restaurant.</p>
    </td></tr></table>
    ${url ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:#087653;border-radius:12px"><a href="${url}" style="color:#ffffff;text-decoration:none;display:inline-block;padding:14px 22px;font-size:14px;font-weight:800">Open GastroFood</a></td></tr></table>` : ''}
    <p style="font-size:12px;line-height:1.65;color:#64748b;margin:24px 0 0">If you did not create this account, please contact GastroFlow support from the app.</p>
  `;
  return renderEmailBase({title:'Welcome to GastroFlow',preheader:'Your GastroFood account is ready.',bodyHtml,businessName:'GastroFlow'});
}

/**
 * GastroFlow — Modern HTML Email Template Engine
 * Features:
 *  - Sleek dark/violet gradient header banner with GastroFlow logo icon
 *  - Responsive card container with clean typography and spacing
 *  - High-contrast Call to Action (CTA) buttons
 *  - Context-relevant security & operational notes
 *  - Professional team signature & Sri Lanka business contact details footer
 */

export function renderEmailBase({ title, preheader, bodyHtml, businessName = 'GastroFlow Bistro' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; max-height: 0px; overflow: hidden;">${preheader}</div>` : ''}

  <!-- Main Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Email Container (600px Max) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);">
          
          <!-- Header Banner with Logo -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #9333ea 100%); padding: 36px 32px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <!-- Brand Icon -->
                    <div style="display: inline-block; width: 56px; height: 56px; line-height: 56px; background: rgba(255, 255, 255, 0.2); border-radius: 16px; font-size: 32px; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
                      🍕
                    </div>
                    <h1 style="color: #ffffff; font-size: 26px; font-weight: 800; margin: 14px 0 4px; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                      ${businessName}
                    </h1>
                    <p style="color: #e0e7ff; font-size: 13px; margin: 0; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">
                      Automated POS & Customer Services
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td style="padding: 32px; color: #f8fafc; font-size: 15px; line-height: 1.6;">
              ${bodyHtml}

              <!-- Signature Section -->
              <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid #334155;">
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">Warm regards,</p>
                <p style="margin: 4px 0 0; color: #f8fafc; font-size: 15px; font-weight: 700;">The ${businessName} Team 🍕</p>
                <p style="margin: 2px 0 0; color: #64748b; font-size: 12px;">Customer Support & Operations</p>
              </div>
            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: center; border-top: 1px solid #334155; color: #64748b; font-size: 12px; line-height: 1.6;">
              <p style="margin: 0 0 6px; color: #94a3b8; font-weight: 600;">
                📍 ${businessName} · 123 Galle Road, Colombo 03, Sri Lanka
              </p>
              <p style="margin: 0 0 8px;">
                📞 Support: <a href="tel:+94112345678" style="color: #818cf8; text-decoration: none; font-weight: 600;">+94 11 234 5678</a> · 
                ✉️ Email: <a href="mailto:support@gastroflow.lk" style="color: #818cf8; text-decoration: none; font-weight: 600;">support@gastroflow.lk</a>
              </p>
              <p style="margin: 12px 0 0; color: #475569; font-size: 11px;">
                © ${new Date().getFullYear()} GastroFlow POS. All rights reserved. This email was sent to notify you of activity on your account.
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
export function buildOrderConfirmationEmail({ order, invoiceNumber, items = [], businessName = 'GastroFlow Bistro', trackingUrl = '' }) {
  const inv = invoiceNumber ? `INV-${String(invoiceNumber).padStart(6, '0')}` : order.id;
  const formattedDate = new Date(order.paymentTimestamp || order.timestamp || Date.now()).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const itemRowsHtml = items.map(item => `
    <tr style="border-bottom: 1px solid #334155;">
      <td style="padding: 12px 0; color: #f8fafc; font-weight: 500;">
        ${item.name}
        ${item.notes ? `<div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">⚠️ Note: ${item.notes}</div>` : ''}
      </td>
      <td style="padding: 12px 0; text-align: center; color: #94a3b8;">x${item.quantity}</td>
      <td style="padding: 12px 0; text-align: right; color: #f8fafc; font-weight: 600;">LKR ${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const bodyHtml = `
    <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 8px;">Order Confirmed! 🎉</h2>
    <p style="color: #94a3b8; margin: 0 0 20px; font-size: 14px;">
      Thank you for dining with <strong>${businessName}</strong>. We've received your payment and your order is being prepared.
    </p>

    <!-- Receipt Meta Box -->
    <div style="background-color: #0f172a; padding: 16px 20px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 24px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13px;">
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Invoice Number:</td>
          <td align="right" style="color: #6366f1; font-weight: 700; font-family: monospace; font-size: 14px;">${inv}</td>
        </tr>
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Date & Time:</td>
          <td align="right" style="color: #f8fafc;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Order Type:</td>
          <td align="right" style="color: #f8fafc; text-transform: capitalize;">${order.diningType || 'Dine-In'}</td>
        </tr>
        <tr>
          <td style="color: #94a3b8;">Payment Method:</td>
          <td align="right" style="color: #22c55e; font-weight: 600; text-transform: uppercase;">${order.paymentMethod || 'Paid'}</td>
        </tr>
      </table>
    </div>

    <!-- Items Table -->
    <table width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px; font-size: 14px;">
      <thead>
        <tr style="border-bottom: 2px solid #334155; text-transform: uppercase; font-size: 11px; color: #64748b; letter-spacing: 0.5px;">
          <th align="left" style="padding-bottom: 8px;">Item Description</th>
          <th align="center" style="padding-bottom: 8px;">Qty</th>
          <th align="right" style="padding-bottom: 8px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
      </tbody>
    </table>

    <!-- Totals Summary -->
    <div style="background-color: #0f172a; padding: 16px 20px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 24px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13px;">
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Subtotal:</td>
          <td align="right" style="color: #f8fafc;">LKR ${(order.subtotal || order.total).toFixed(2)}</td>
        </tr>
        ${order.discount > 0 ? `
        <tr>
          <td style="color: #ef4444; padding-bottom: 6px;">Discount (${order.discountValue}${order.discountType === 'percent' ? '%' : ''}):</td>
          <td align="right" style="color: #ef4444;">-LKR ${order.discount.toFixed(2)}</td>
        </tr>` : ''}
        ${order.serviceCharge > 0 ? `
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Service Charge:</td>
          <td align="right" style="color: #f8fafc;">LKR ${order.serviceCharge.toFixed(2)}</td>
        </tr>` : ''}
        ${order.tax > 0 ? `
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Tax / VAT:</td>
          <td align="right" style="color: #f8fafc;">LKR ${order.tax.toFixed(2)}</td>
        </tr>` : ''}
        ${order.tip > 0 ? `
        <tr>
          <td style="color: #94a3b8; padding-bottom: 6px;">Staff Tip:</td>
          <td align="right" style="color: #f8fafc;">LKR ${order.tip.toFixed(2)}</td>
        </tr>` : ''}
        <tr style="border-top: 1px solid #334155;">
          <td style="color: #f8fafc; font-weight: 700; font-size: 16px; padding-top: 10px;">Total Paid:</td>
          <td align="right" style="color: #6366f1; font-weight: 800; font-size: 18px; padding-top: 10px;">LKR ${order.total.toFixed(2)}</td>
        </tr>
      </table>
    </div>

    ${trackingUrl ? `
    <!-- CTA Button -->
    <div style="text-align: center; margin: 28px 0 20px;">
      <a href="${trackingUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 30px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
        📍 Track Order Status Live
      </a>
    </div>` : ''}

    <!-- Relevant Note -->
    <div style="background-color: rgba(99, 102, 241, 0.1); border-left: 4px solid #6366f1; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #cbd5e1; margin-top: 20px;">
      ℹ️ <strong>Note:</strong> Please show this digital invoice to our staff or driver upon pickup/delivery.
    </div>
  `;

  return renderEmailBase({
    title: `Order Confirmed (${inv}) — ${businessName}`,
    preheader: `Thank you! Your order ${inv} has been confirmed.`,
    bodyHtml,
    businessName
  });
}

/**
 * 2. OTP Verification Email Template
 */
export function buildOtpEmail({ code, purpose = 'phone_verify', destination = '', businessName = 'GastroFlow Bistro' }) {
  const bodyHtml = `
    <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 8px;">Verification Code</h2>
    <p style="color: #94a3b8; margin: 0 0 24px; font-size: 14px;">
      Please use the following 6-digit One-Time Password (OTP) to complete your verification for <strong>${destination || 'your account'}</strong>.
    </p>

    <!-- OTP Code Display Card -->
    <div style="background-color: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <div style="color: #818cf8; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
        One-Time Password
      </div>
      <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; color: #ffffff; letter-spacing: 10px; margin: 0;">
        ${code}
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 10px;">
        ⏳ Valid for <strong>5 minutes</strong> · Single-use code
      </div>
    </div>

    <!-- Security Note -->
    <div style="background-color: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #fca5a5;">
      🔒 <strong>Security Warning:</strong> Never share this code with anyone. ${businessName} staff will never ask for your verification code.
    </div>
  `;

  return renderEmailBase({
    title: `Your Verification Code: ${code} — ${businessName}`,
    preheader: `Your GastroFlow verification code is ${code}. Valid for 5 minutes.`,
    bodyHtml,
    businessName
  });
}

/**
 * 3. Password Reset Email Template
 */
export function buildPasswordResetEmail({ name, userType = 'customer', resetUrl = '', code = '', businessName = 'GastroFlow Bistro' }) {
  const bodyHtml = `
    <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 8px;">Password Reset Request</h2>
    <p style="color: #94a3b8; margin: 0 0 20px; font-size: 14px;">
      We received a request to reset the password for your <strong>${businessName}</strong> ${userType} account.
    </p>

    ${resetUrl ? `
    <!-- CTA Button -->
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
        🔑 Reset Your Password
      </a>
    </div>` : ''}

    ${code ? `
    <!-- Code Box -->
    <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center; margin: 20px 0;">
      <div style="color: #94a3b8; font-size: 12px; margin-bottom: 4px;">Alternatively, enter this 6-digit code:</div>
      <div style="font-family: monospace; font-size: 28px; font-weight: 700; color: #818cf8; letter-spacing: 6px;">${code}</div>
    </div>` : ''}

    <!-- Relevant Note -->
    <div style="background-color: rgba(234, 179, 8, 0.1); border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #fde047; margin-top: 20px;">
      ⏳ This link and code expire in <strong>30 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
    </div>
  `;

  return renderEmailBase({
    title: `Reset Your Password — ${businessName}`,
    preheader: `Reset the password for your ${businessName} account.`,
    bodyHtml,
    businessName
  });
}

/**
 * 4. Welcome Email Template
 */
export function buildWelcomeEmail({ name = 'Diner', loginUrl = '', businessName = 'GastroFlow Bistro' }) {
  const bodyHtml = `
    <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 8px;">Welcome, ${name}! 👋</h2>
    <p style="color: #94a3b8; margin: 0 0 20px; font-size: 14px;">
      Thank you for registering with <strong>${businessName}</strong>. Your account is active and you can now order online, earn loyalty rewards, and track orders in real time.
    </p>

    <!-- Value Prop Box -->
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; border: 1px solid #334155; margin-bottom: 24px;">
      <div style="color: #818cf8; font-weight: 700; font-size: 14px; margin-bottom: 8px;">🎁 Account Perks:</div>
      <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 13px; line-height: 1.8;">
        <li>Earn <strong>1 Loyalty Point</strong> for every LKR 10 spent</li>
        <li>Instant live order tracking with driver GPS</li>
        <li>Fast checkout with saved delivery addresses</li>
        <li>Exclusive member promotions & discount vouchers</li>
      </ul>
    </div>

    ${loginUrl ? `
    <!-- CTA Button -->
    <div style="text-align: center; margin: 28px 0 20px;">
      <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
        🍽️ Browse Menu & Order Now
      </a>
    </div>` : ''}
  `;

  return renderEmailBase({
    title: `Welcome to ${businessName}! 🎉`,
    preheader: `Welcome to ${businessName}. Your account is ready!`,
    bodyHtml,
    businessName
  });
}

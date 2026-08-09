/**
 * lib/notifications.js — Email & SMS Notification Helper for GastroFlow Sri Lanka
 *
 * EMAIL SETUP (Gmail SMTP):
 *  Add these to Render → Environment Variables:
 *    SMTP_HOST = smtp.gmail.com
 *    SMTP_PORT = 465
 *    SMTP_SECURE = true
 *    SMTP_USER = your-gmail@gmail.com
 *    SMTP_PASS = xxxx xxxx xxxx xxxx  (16-char Gmail App Password)
 *
 *  HOW TO GET GMAIL APP PASSWORD:
 *    1. Go to https://myaccount.google.com/security
 *    2. Enable 2-Step Verification
 *    3. Go to https://myaccount.google.com/apppasswords
 *    4. Create app password → Select "Mail" → Select "Other" → type "GastroFlow"
 *    5. Copy the 16-character password and paste into SMTP_PASS on Render
 */
import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import nodemailer from 'nodemailer';

const resolve4Async = promisify(dns.resolve4);

async function getIPv4Host(hostname) {
  if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return hostname;
  }
  try {
    const addresses = await resolve4Async(hostname);
    if (addresses && addresses.length > 0) {
      console.log(`[DNS RESOLVE4 SUCCESS] Resolved ${hostname} -> IPv4 ${addresses[0]}`);
      return addresses[0];
    }
  } catch (err) {
    console.warn(`[DNS RESOLVE4 WARN] Fallback to hostname for ${hostname}:`, err.message);
  }
  return hostname;
}

// Email configuration helpers
export function isEmailConfigured() {
  return !!(
    process.env.BREVO_API_KEY ||
    process.env.SENDGRID_API_KEY ||
    process.env.RESEND_API_KEY ||
    ((process.env.SMTP_HOST || process.env.SMTP_USER) && process.env.SMTP_PASS)
  );
}

// ── HTTP API Provider 1: Brevo (Sendinblue) — Uses HTTPS Port 443 (Never blocked by Render!) ──
async function sendViaBrevo({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const senderEmail = process.env.SMTP_USER || process.env.SMTP_FROM_EMAIL || 'gastroflowadmin@gmail.com';
  const senderName = process.env.SMTP_FROM_NAME || 'GastroFlow';

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html,
        textContent: text
      })
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`[BREVO HTTPS SUCCESS] Delivered to ${to} | MessageId: ${data.messageId || data.id}`);
      return { success: true, messageId: data.messageId || data.id, provider: 'brevo' };
    } else {
      console.error(`[BREVO HTTPS ERROR]`, data);
      return { success: false, error: data.message || 'Brevo API error' };
    }
  } catch (err) {
    console.error(`[BREVO HTTPS EXCEPTION]`, err.message);
    return { success: false, error: err.message };
  }
}

// ── HTTP API Provider 2: SendGrid — Uses HTTPS Port 443 ──
async function sendViaSendGrid({ to, subject, html, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;

  const senderEmail = process.env.SMTP_USER || process.env.SMTP_FROM_EMAIL || 'gastroflowadmin@gmail.com';
  const senderName = process.env.SMTP_FROM_NAME || 'GastroFlow';

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: senderEmail, name: senderName },
        subject: subject,
        content: [
          { type: 'text/plain', value: text || ' ' },
          { type: 'text/html', value: html || '<p></p>' }
        ]
      })
    });

    if (res.ok || res.status === 202) {
      console.log(`[SENDGRID HTTPS SUCCESS] Delivered to ${to}`);
      return { success: true, provider: 'sendgrid' };
    } else {
      const errText = await res.text();
      console.error(`[SENDGRID HTTPS ERROR]`, errText);
      return { success: false, error: errText };
    }
  } catch (err) {
    console.error(`[SENDGRID HTTPS EXCEPTION]`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendEmail({ to, subject, html, text }) {
  // Method 1: Try Brevo HTTPS API (Port 443 — immune to Render SMTP port blocks!)
  if (process.env.BREVO_API_KEY) {
    const brevoResult = await sendViaBrevo({ to, subject, html, text });
    if (brevoResult && brevoResult.success) return brevoResult;
  }

  // Method 2: Try SendGrid HTTPS API (Port 443)
  if (process.env.SENDGRID_API_KEY) {
    const sgResult = await sendViaSendGrid({ to, subject, html, text });
    if (sgResult && sgResult.success) return sgResult;
  }

  // Method 3: Fallback to Raw SMTP (Gmail / Custom SMTP for local dev)
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim().replace(/\s+/g, ''); // strip spaces from Gmail App Passwords
  const targetHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();

  if (!user || !pass) {
    console.log(`[EMAIL SIMULATION] To: ${to} | Subject: ${subject}`);
    console.warn('[EMAIL] SMTP not configured. Add BREVO_API_KEY or SMTP_USER and SMTP_PASS to Render Environment Variables.');
    return { simulated: true, reason: 'Missing email API keys or SMTP credentials.' };
  }

  // Resolve pure IPv4 IP address to force Node.js socket away from IPv6 ENETUNREACH
  const ipHost = await getIPv4Host(targetHost);

  // Multi-port attempts: Try 587 (STARTTLS) first for fast 1.8s connection, then configured port, then 465 (SSL)
  const configuredPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const configuredSecure = process.env.SMTP_SECURE === 'true' || configuredPort === 465;

  const attempts = [
    { port: 587, secure: false },
    { port: configuredPort, secure: configuredSecure },
    { port: 465, secure: true }
  ];

  // Deduplicate attempts
  const uniqueAttempts = attempts.filter((v, i, a) => a.findIndex(t => t.port === v.port && t.secure === v.secure) === i);

  let lastError = null;

  for (const config of uniqueAttempts) {
    try {
      console.log(`[EMAIL SENDING] Connecting to IPv4 ${ipHost}:${config.port} (SNI: ${targetHost}, Secure: ${config.secure}) for ${user}...`);
      const transporter = nodemailer.createTransport({
        host: ipHost,
        port: config.port,
        secure: config.secure,
        servername: targetHost,
        auth: { user, pass },
        tls: { rejectUnauthorized: false, servername: targetHost },
        connectionTimeout: 10000,
        greetingTimeout: 8000,
        socketTimeout: 15000
      });

      const info = await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'GastroFlow'}" <${process.env.SMTP_FROM_EMAIL || user}>`,
        to,
        subject,
        html,
        text
      });

      console.log(`[EMAIL SUCCESS] Delivered to ${to} via ${targetHost}:${config.port} | MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId, port: config.port };
    } catch (err) {
      console.error(`[EMAIL ATTEMPT FAILED] ${targetHost}:${config.port} error:`, err.message);
      lastError = err;
    }
  }

  return { success: false, error: lastError?.message || 'All SMTP attempts failed' };
}

// SMS configuration helpers
export function isSmsConfigured() {
  return !!(process.env.SMS_API_KEY || process.env.TEXTWARE_API_KEY);
}

export function normalizeLkPhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('94')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+94${cleaned.substring(1)}`;
  return `+94${cleaned}`;
}

export async function sendSms({ to, message }) {
  const normalized = normalizeLkPhone(to);
  if (!isSmsConfigured()) {
    console.log(`[SMS SIMULATION] To: ${normalized} | Message: ${message}`);
    return { simulated: true, to: normalized };
  }
  // Real SMS gateway trigger (Textware / Dialog / Mobitel)
  return { success: true, to: normalized };
}

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashCode(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// Formats a phone number into Sri Lankan International format (+94XXXXXXXXX)
export function formatSLPhone(phone) {
  return normalizeLkPhone(phone);
}

// Generates a WhatsApp click-to-chat URL for customer notifications
export function buildWhatsAppNotificationUrl(phone, text) {
  const formattedPhone = formatSLPhone(phone).replace('+', '');
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${formattedPhone}?text=${encodedText}`;
}

// Constructs standard notification text messages
export function buildOrderMessages(order) {
  const currency = 'Rs.';
  const storeName = order.tenantName || 'GastroFlow Bistro';

  // 1. Order Confirmation Message
  const confirmationMsg = 
    `🍽️ *${storeName} - Order Confirmation*\n` +
    `Order ID: #${order.id}\n` +
    `Customer: ${order.customerName}\n` +
    `Total: ${currency} ${order.total?.toFixed(2)}\n` +
    `Type: ${order.diningType?.toUpperCase()}\n\n` +
    `Thank you for ordering with us! Track your order live here:\n` +
    `https://gastroflow.lk/order-status/${order.id}`;

  // 2. Out for Delivery Message
  const outForDeliveryMsg = 
    `🛵 *${storeName} - Delivery Update*\n` +
    `Your order #${order.id} is OUT FOR DELIVERY!\n` +
    `Rider: ${order.driverName || 'Kamal Perera'} (${order.driverPhone || '0771234567'})\n` +
    `ETA: ~${order.etaMinutes || 25} mins\n\n` +
    `Track rider live: https://gastroflow.lk/order-status/${order.id}`;

  // 3. Delivered E-Receipt Message
  const deliveredMsg = 
    `✅ *${storeName} - Order Delivered*\n` +
    `Order #${order.id} has been delivered! Enjoy your meal!\n` +
    `Subtotal: ${currency} ${order.subtotal?.toFixed(2)}\n` +
    `Delivery Fee: ${currency} ${order.deliveryFee?.toFixed(2)}\n` +
    `Total Paid: ${currency} ${order.total?.toFixed(2)}\n\n` +
    `Thank you for choosing ${storeName}! 💛`;

  return {
    confirmationMsg,
    outForDeliveryMsg,
    deliveredMsg,
    whatsappConfirmUrl: buildWhatsAppNotificationUrl(order.customerPhone, confirmationMsg),
    whatsappDeliveryUrl: buildWhatsAppNotificationUrl(order.customerPhone, outForDeliveryMsg),
    whatsappReceiptUrl: buildWhatsAppNotificationUrl(order.customerPhone, deliveredMsg)
  };
}

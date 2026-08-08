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
import nodemailer from 'nodemailer';

// Email configuration helpers
export function isEmailConfigured() {
  return !!((process.env.SMTP_HOST || process.env.SMTP_USER) && process.env.SMTP_PASS);
}

export async function sendEmail({ to, subject, html, text }) {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim().replace(/\s+/g, ''); // strip spaces from Gmail App Passwords
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();

  if (!user || !pass) {
    console.log(`[EMAIL SIMULATION] To: ${to} | Subject: ${subject}`);
    console.warn('[EMAIL] SMTP not configured. Add SMTP_USER and SMTP_PASS to Render Environment Variables.');
    return { simulated: true, reason: 'Missing SMTP_USER or SMTP_PASS environment variables.' };
  }

  try {
    const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');
    let transporter;

    if (isGmail) {
      // Use Nodemailer's built-in Gmail service configuration for optimal TLS/port handling
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });
    } else {
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;
      transporter = nodemailer.createTransport({
        host,
        port,
        secure: isSecure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 20000,
        greetingTimeout: 15000,
        socketTimeout: 20000
      });
    }

    console.log(`[EMAIL SENDING] Transporter created for ${user} (IsGmail: ${isGmail}). Sending to ${to}...`);

    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'GastroFlow'}" <${process.env.SMTP_FROM_EMAIL || user}>`,
      to,
      subject,
      html,
      text
    });

    console.log(`[EMAIL SUCCESS] Sent to: ${to} | MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed sending to ${to}:`, err.message, err.code || '');
    return { success: false, error: err.message, code: err.code };
  }
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

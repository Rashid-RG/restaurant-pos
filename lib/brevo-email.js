/**
 * Brevo transactional email adapter.
 *
 * Server-only environment variables:
 * BREVO_API_KEY, BREVO_FROM_EMAIL, optional BREVO_FROM_NAME.
 * Never ship credentials to the browser or expose provider response bodies.
 */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function brevoSettings(env = process.env) {
  const sender = String(env.BREVO_FROM_EMAIL || env.SMTP_FROM_EMAIL || env.SMTP_USER || '').trim();
  const key = String(env.BREVO_API_KEY || '').trim();
  return {
    configured: Boolean(key && emailPattern.test(sender)),
    sender,
    senderName: String(env.BREVO_FROM_NAME || env.SMTP_FROM_NAME || 'GastroFlow').trim().slice(0, 80) || 'GastroFlow'
  };
}

export async function sendBrevoEmail({to, subject, html, text, env = process.env, fetcher = fetch}) {
  const settings = brevoSettings(env);
  if (!settings.configured) return { success: false, error: 'Brevo is not configured with a verified sender.' };
  if (!emailPattern.test(String(to || '').trim())) return {success:false,error:'Invalid recipient email address.'};
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {accept:'application/json','api-key':String(env.BREVO_API_KEY).trim(),'content-type':'application/json'},
      body: JSON.stringify({
        sender: {name:settings.senderName,email:settings.sender},
        to: [{email:String(to).trim()}],
        subject,
        htmlContent:html,
        textContent:text
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      // No provider response body is logged or returned: it can contain personal data.
      return {success:false,error: response.status === 429 ? 'Email provider rate limit reached.' : 'Email provider rejected the request.',status:response.status};
    }
    const result = await response.json().catch(()=>null);
    if (!result?.messageId) return {success:false,error:'Email provider did not confirm acceptance.'};
    return {success:true,provider:'brevo',messageId:result.messageId};
  } catch {
    return {success:false,error:'Email provider connection timed out or failed.'};
  }
}

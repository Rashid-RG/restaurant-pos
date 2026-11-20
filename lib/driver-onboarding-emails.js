// Tenant-branded rider onboarding messages. All content is escaped; identity
// document images, application tokens, NIC and licence numbers are excluded.
const safe=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const messages={
  submitted:{subject:'GastroDriver rider application received',title:'Your rider journey begins',body:'Your GastroDriver application has been received. Next, securely submit your required identity documents and selfie in GastroDriver. Your restaurant will review your documents and driving eligibility before you can accept deliveries.'},
  resubmit:{subject:'GastroDriver: action required on your application',title:'One more step for your rider application',body:'Your restaurant needs updated verification evidence. Open GastroDriver and use the secure application recovery process, or contact your restaurant for assistance. Never reply to this email with identity photos.'},
  manual_approved:{subject:'Driver identity evidence reviewed',title:'Document review completed',body:'The restaurant manager reviewed your submitted evidence. Your account is not active until the restaurant completes final driver approval.'},
  manual_rejected:{subject:'Driver identity evidence needs attention',title:'Document review unsuccessful',body:'Your submitted evidence was not accepted. Please contact the restaurant for next steps.'},
  approved:{subject:'Welcome to GastroDriver — rider approved',title:'You are approved to ride',body:'Your restaurant has approved your GastroDriver rider application. Sign in to GastroDriver with your registered phone and password, review your availability and delivery assignments, and follow restaurant pickup instructions.'},
  rejected:{subject:'Driver application rejected',title:'Application not approved',body:'Your restaurant did not approve the driver application. Contact the restaurant for further information.'},
  manager_pending:{subject:'GastroDriver: new rider waiting for review',title:'A new rider has applied',body:'A new rider application is waiting for your restaurant team. Open the Rider Verification Center to check uploaded evidence, licence eligibility and the application audit trail before making a decision.'}
};
export function riderEmailTemplate({event,restaurant,rider}){
  const message=messages[event];
  if(!message)throw new Error('Unsupported rider onboarding email event');
  const name=String(restaurant||'Your restaurant').slice(0,150);
  const person=String(rider||'').slice(0,120);
  const subject=`${name} — ${message.subject}`;
  const text=`${message.title}\n\n${person?'Hello '+person+',\n\n':''}${message.body}\n\nRestaurant: ${name}\nPowered by GastroFlow, RS Technologies.`;
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px;color:#16223b"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;padding:28px"><div style="font-weight:700;color:#087f5b">GastroFlow · GastroDriver</div><h2 style="margin:16px 0 12px">${safe(message.title)}</h2><p>${person?'Hello '+safe(person)+',':''}</p><p style="line-height:1.6">${safe(message.body)}</p><p style="color:#64748b">Restaurant: <strong>${safe(name)}</strong></p><hr style="border:none;border-top:1px solid #edf2f7"><small>Powered by RS Technologies. This message contains no identity documents or confidential application links.</small></div></body></html>`;
  return {subject,text,html};
}

/** Rider-only OTP email; never reuse the GastroFood customer onboarding copy. */
export function riderOtpEmailTemplate({code,email,purpose='register',assetOrigin='https://gastroflow-staging.onrender.com'}){
  if(!/^\d{6}$/.test(String(code)))throw new Error('Invalid rider email code');
  if(!['register','recover'].includes(purpose))throw new Error('Invalid rider verification purpose');
  const title=purpose==='recover'?'Resume your GastroDriver application':'Verify your GastroDriver email';
  const explanation=purpose==='recover'
    ? 'Use this code to securely resume your existing pending rider application and complete your documents.'
    : 'Use this code to verify your email before completing your rider application.';
  let logo='';
  try{const url=new URL(assetOrigin);if(url.protocol==='https:')logo=url.origin+'/driver-logo.png';}catch(_){}
  const safeEmail=safe(String(email||'').slice(0,254));
  const body=`<div style="margin:0;background:#eef5f1;padding:26px 12px;color:#193e32;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:auto;border:1px solid #d5e6dc;border-radius:20px;overflow:hidden;background:#fff">
  <header style="padding:25px 26px;background:#f3faf6;border-bottom:3px solid #267a5d;text-align:center">${logo?`<img alt="GastroDriver" src="${safe(logo)}" height="56" style="max-width:100%;height:56px;width:auto"/>`:''}<div style="font-size:23px;font-weight:800;color:#226d51">GastroDriver</div><div style="font-size:11px;letter-spacing:2px;color:#547968;margin-top:5px">RIDE · DELIVER · GROW</div></header>
  <main style="padding:28px 27px"><h1 style="font-size:23px;line-height:1.25;margin:0 0 14px;color:#183f32">${safe(title)}</h1><p style="font-size:15px;line-height:1.65;color:#526b5e">${safe(explanation)}</p><p style="font-size:13px;color:#5b7569">Email: <strong>${safeEmail}</strong></p>
  <div style="text-align:center;background:#edf7f0;border-radius:14px;padding:24px 10px;margin:25px 0"><div style="font-size:11px;letter-spacing:2px;font-weight:800;color:#276e52">YOUR ONE-TIME CODE</div><div style="font-size:38px;font-weight:800;letter-spacing:9px;color:#185e46;margin:12px 0">${safe(code)}</div><div style="font-size:12px;color:#55776a">Expires in 10 minutes · Single use</div></div>
  <p style="font-size:12px;line-height:1.6;color:#62796d">Never share this code with anyone, including restaurant staff. If you did not request it, ignore this email. We will never request identity photos by email.</p></main>
  <footer style="background:#f4f9f6;padding:18px 24px;text-align:center;border-top:1px solid #e1eee4;color:#648073;font-size:11px">GastroDriver by GastroFlow · Powered by RS Technologies</footer></div></div>`;
  return {subject:'GastroDriver — '+title,html:`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title></head><body>${body}</body></html>`,
    text:`${title}\n\n${explanation}\n\nOne-time code: ${code}\nExpires in 10 minutes. Single use.\n\nGastroDriver by GastroFlow, RS Technologies.`};
}

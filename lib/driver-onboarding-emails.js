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

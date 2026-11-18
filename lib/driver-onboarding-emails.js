// Tenant-branded rider onboarding messages. All content is escaped; identity
// document images, application tokens, NIC and licence numbers are excluded.
const safe=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const messages={
  submitted:{subject:'Driver application received',title:'Application received',body:'Your application was received and is awaiting document and restaurant-manager review.'},
  resubmit:{subject:'Driver verification: resubmission requested',title:'More information needed',body:'The restaurant has asked you to resubmit your identification evidence. Please contact the restaurant for a secure new submission link.'},
  manual_approved:{subject:'Driver identity evidence reviewed',title:'Document review completed',body:'The restaurant manager reviewed your submitted evidence. Your account is not active until the restaurant completes final driver approval.'},
  manual_rejected:{subject:'Driver identity evidence needs attention',title:'Document review unsuccessful',body:'Your submitted evidence was not accepted. Please contact the restaurant for next steps.'},
  approved:{subject:'Driver application approved',title:'Application approved',body:'Your restaurant has approved your driver application. You may now sign in to GastroDriver.'},
  rejected:{subject:'Driver application rejected',title:'Application not approved',body:'Your restaurant did not approve the driver application. Contact the restaurant for further information.'},
  manager_pending:{subject:'New GastroDriver application',title:'New rider application',body:'A driver applied to join your restaurant. Open your restaurant POS Rider Verification Center to review the applicant.'}
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

import React, { useState } from 'react';

/**
 * Guided rider application. The first step performs real server OTP verification
 * and receives a short-lived email-bound proof before the application can advance.
 */
export default function RiderRegistrationWizard({reg,setReg,onSendCode,codeSentTo,sendingCode,onVerifyCode,verifyingCode,verificationToken,onSubmit,submitting,onClose,restaurant}) {
  const [step,setStep]=useState(0);
  const steps=['Email','Your details','Vehicle','Review'];
  const update=(field,value)=>setReg(prev=>({...prev,[field]:value}));
  const correctEmail=reg.email.trim().toLowerCase()===codeSentTo;
  const readyEmail=correctEmail&&Boolean(verificationToken);
  const nextAllowed=[readyEmail,Boolean(reg.name.trim()&&reg.phone.trim()&&reg.password.length>=10&&reg.password.length<=72),Boolean(reg.vehicleType&&(reg.vehicleType==='Bicycle'||reg.plateNumber.trim())),Boolean(reg.privacyAccepted)][step];
  return <div className="rider-wizard-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="rider-wizard" role="dialog" aria-modal="true" aria-labelledby="rider-wizard-title">
      <header className="rider-wizard-header">
        <div><div className="rider-wizard-eyebrow">GastroDriver · Rider onboarding</div><h2 id="rider-wizard-title">Join {restaurant?.name||'your restaurant'}</h2><p>Step {step+1} of {steps.length} · {steps[step]}</p></div>
        <button type="button" onClick={onClose} className="rider-wizard-close" aria-label="Close registration">✕</button>
      </header>
      <nav className="rider-wizard-progress" aria-label="Registration progress">{steps.map((name,index)=><div key={name} className={index<=step?'active':''}><span>{index<step?'✓':index+1}</span><small>{name}</small></div>)}</nav>
      <form onSubmit={e=>{e.preventDefault();if(step===3&&nextAllowed)onSubmit(e);}} className="rider-wizard-body">
        {step===0&&<div className="rider-wizard-fields">
          <h3>First, verify your email</h3><p>Enter your email and verify the six-digit code before continuing. An email already registered with GastroDriver cannot be used again.</p>
          <label>Email address<input required className="input-field" type="email" autoComplete="email" value={reg.email} onChange={e=>{update('email',e.target.value);update('verificationCode','');}} placeholder="you@example.com"/></label>
          <button type="button" className="btn-outline" disabled={sendingCode||!reg.email.trim()} onClick={onSendCode}>{sendingCode?'Sending code…':correctEmail?'Resend verification code':'Send verification code'}</button>
          {correctEmail&&<label>Six-digit code<input required className="input-field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={reg.verificationCode} onChange={e=>update('verificationCode',e.target.value.replace(/\D/g,''))} placeholder="000000"/></label>}
          {correctEmail&&<><button type="button" className="btn-emerald" onClick={onVerifyCode} disabled={verifyingCode||Boolean(verificationToken)||!/^\d{6}$/.test(reg.verificationCode)}>{verificationToken?'✓ Email verified':verifyingCode?'Verifying…':'Verify email code'}</button><small role="status">{verificationToken?'Email verified securely. You can continue.':`Code sent to ${codeSentTo}. Valid for 10 minutes. Do not share it.`}</small></>}
        </div>}
        {step===1&&<div className="rider-wizard-fields">
          <h3>Tell us about yourself</h3><p>Use the name printed on your identity document.</p>
          <label>Full legal name<input className="input-field" required value={reg.name} autoComplete="name" onChange={e=>update('name',e.target.value)} placeholder="Full name"/></label>
          <label>Mobile number<input className="input-field" required type="tel" inputMode="tel" autoComplete="tel" value={reg.phone} onChange={e=>update('phone',e.target.value)} placeholder="0771234567"/></label>
          <label>Create password<input className="input-field" required type="password" autoComplete="new-password" minLength={10} maxLength={72} value={reg.password} onChange={e=>update('password',e.target.value)} placeholder="10–72 characters"/></label>
        </div>}
        {step===2&&<div className="rider-wizard-fields">
          <h3>Your delivery vehicle</h3><p>Choose the vehicle you will use. The restaurant verifies eligibility before approval.</p>
          <div className="rider-wizard-vehicles">{[['Motorbike','🛵','Motorbike'],['TukTuk','🛺','Three-wheeler'],['Car','🚗','Car / Van'],['Bicycle','🚲','Bicycle']].map(([value,emoji,title])=><button key={value} type="button" className={reg.vehicleType===value?'selected':''} aria-pressed={reg.vehicleType===value} onClick={()=>update('vehicleType',value)}><span>{emoji}</span>{title}</button>)}</div>
          {reg.vehicleType!=='Bicycle'&&<label>Registration plate<input className="input-field" value={reg.plateNumber} onChange={e=>update('plateNumber',e.target.value)} placeholder="e.g. WP BZ-9988" required/></label>}
        </div>}
        {step===3&&<div className="rider-wizard-fields">
          <h3>Review your application</h3><p>Your email is verified. Submit this application, then upload your selfie and required documents securely.</p>
          <dl className="rider-wizard-summary"><div><dt>Restaurant</dt><dd>{restaurant?.name}</dd></div><div><dt>Email</dt><dd>{reg.email}</dd></div><div><dt>Rider</dt><dd>{reg.name}</dd></div><div><dt>Vehicle</dt><dd>{reg.vehicleType}</dd></div></dl>
          <label className="rider-wizard-consent"><input type="checkbox" checked={reg.privacyAccepted} onChange={e=>update('privacyAccepted',e.target.checked)}/><span>I understand my details are shared only with the selected restaurant for application review. Email verification does not prove identity, phone ownership, driving eligibility or licence validity.</span></label>
          <label className="rider-wizard-consent"><input type="checkbox" checked={reg.identityConsent} onChange={e=>update('identityConsent',e.target.checked)}/><span>Optional: I consent to third-party identity verification under the provider's privacy notice. If unavailable, secure manual document review is available.</span></label>
        </div>}
        <footer className="rider-wizard-actions">{step>0?<button className="btn-outline" type="button" onClick={()=>setStep(s=>s-1)}>Back</button>:<button className="btn-outline" type="button" onClick={onClose}>Cancel</button>}
          {step<3?<button className="btn-emerald" type="button" disabled={!nextAllowed} onClick={()=>setStep(s=>s+1)}>Continue →</button>:<button className="btn-emerald" type="submit" disabled={!nextAllowed||submitting||!restaurant}>{submitting?'Submitting securely…':'Submit & continue to documents'}</button>}
        </footer>
      </form>
    </section>
  </div>;
}

import React,{useState} from 'react';

/** Uses existing encrypted upload endpoint. No document bytes are persisted locally. */
export default function RiderEvidenceWizard({evidence,vehicleType,identityType,savingIdentityType,onIdentityChange,consent,setConsent,uploading,onUpload,selfieCandidate,onSelfieCapture,onClearSelfie}) {
  const [stage,setStage]=useState(0);
  const stages=['Selfie','Identity',...(vehicleType==='Bicycle'?[]:['Driving licence']),'Finish'];
  const required=stage===0?['selfie']:stage===1?(identityType==='passport'?['identity_front']:['identity_front','identity_back']):stage===2&&vehicleType!=='Bicycle'?['licence_front','licence_back']:[];
  const ready=required.every(key=>evidence[key]);
  const uploadField=(kind,label,front=false)=><div className="rider-evidence-field" key={kind}>
    <div><strong>{evidence[kind]?'✓ ':''}{label}</strong><small>{evidence[kind]?'Uploaded securely':'JPEG, PNG or WebP · maximum 2 MB'}</small></div>
    <label className="rider-evidence-upload">{evidence[kind]?'Replace photo':'Take photo or choose file'}<input type="file" accept="image/jpeg,image/png,image/webp" {...(front?{capture:'user'}:{})} disabled={!consent||Boolean(uploading)} onChange={e=>{const file=e.target.files?.[0];if(file){if(kind==='selfie')onSelfieCapture(file);else void onUpload(kind,file);}e.target.value='';}}/></label>
    {uploading===kind&&<small role="status">Encrypting and uploading…</small>}
  </div>;
  return <section className="card rider-evidence-wizard" aria-label="Secure rider document onboarding">
    <div className="rider-evidence-heading"><span>SECURE RIDER VERIFICATION</span><h2>Finish your application</h2><p>Your documents are securely uploaded for restaurant-manager review. Photos do not establish identity or official DMT clearance.</p></div>
    <div className="rider-evidence-progress" aria-label="Document progress">{stages.map((s,i)=><button type="button" key={s} className={stage===i?'active':''} disabled={i>stage&&!required.every(k=>evidence[k])} onClick={()=>{if(i<=stage)setStage(i);}}>{i+1}. {s}</button>)}</div>
    <label className="rider-evidence-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I consent to the encrypted storage and restricted manager review of my selfie, identity document and licence (if applicable). A selfie is not an automated liveness or biometric check.</span></label>
    {stage===0&&<div className="rider-evidence-stage"><h3>1. Take your selfie</h3><p>Face the camera with your whole face visible, without sunglasses and in good light.</p>{uploadField('selfie','Front-facing selfie',true)}
      {selfieCandidate&&<div className="rider-evidence-preview"><img src={selfieCandidate.url} alt="Selfie photo preview before confirmation"/><div><button type="button" className="btn-outline" onClick={onClearSelfie}>Retake</button><button type="button" className="btn-emerald" disabled={!consent||!!uploading} onClick={()=>onUpload('selfie',selfieCandidate.file)}>Confirm and upload</button></div></div>}
    </div>}
    {stage===1&&<div className="rider-evidence-stage"><h3>2. Choose your identity document</h3><p>Select one identity type. National ID needs front and back. Passport needs the photo/information page only.</p>
      <div className="rider-wizard-vehicles">{[['nic','🪪','National ID'],['passport','🛂','Passport']].map(([value,emoji,title])=><button type="button" key={value} className={identityType===value?'selected':''} aria-pressed={identityType===value} disabled={savingIdentityType} onClick={()=>void onIdentityChange(value)}><span>{emoji}</span>{title}</button>)}</div>
      {!identityType?<p>Please select NIC or passport to continue.</p>:identityType==='nic'?<>{uploadField('identity_front','NIC front')}{uploadField('identity_back','NIC back')}</>:uploadField('identity_front','Passport photo / information page')}
    </div>}
    {stage===2&&vehicleType!=='Bicycle'&&<div className="rider-evidence-stage"><h3>3. Driving licence</h3><p>Upload a clear photo of both sides of your valid driving licence. Your manager must also check the original, permitted vehicle class and expiry.</p>{uploadField('licence_front','Licence front')}{uploadField('licence_back','Licence back')}</div>}
    {stage===stages.length-1&&<div className="rider-evidence-stage"><h3>Documents submitted</h3><p>Your evidence is stored for restricted restaurant review. Check your email for status updates. Approval is not automatic; your restaurant must review identity and licence eligibility.</p></div>}
    <div className="rider-wizard-actions">{stage>0?<button type="button" className="btn-outline" onClick={()=>setStage(s=>s-1)}>Back</button>:<span/>}<button type="button" className="btn-emerald" disabled={!consent||!!uploading||savingIdentityType||!ready||(stage===1&&!identityType)||stage===stages.length-1} onClick={()=>setStage(s=>Math.min(stages.length-1,s+1))}>{stage===stages.length-2?'Finish':'Continue →'}</button></div>
    <small>Encrypted uploads only · 2 MB per image · never send identity evidence in chat or email.</small>
  </section>;
}

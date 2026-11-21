import React,{useCallback,useEffect,useState} from 'react';
import {Bell,CheckCheck,ShieldAlert,X} from 'lucide-react';

/** Restaurant-owner in-app inbox. No delivery to cashiers/managers. */
export default function OwnerCommunicationsInbox({currentUser}) {
  const [messages,setMessages]=useState([]);
  const [moduleAvailable,setModuleAvailable]=useState(false);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [pushPreference,setPushPreference]=useState(null);
  const [installations,setInstallations]=useState(null);
  const [receipts,setReceipts]=useState({});
  const [language,setLanguage]=useState(()=>{try{const v=localStorage.getItem('gastroflow_owner_notice_lang');return ['en','si','ta'].includes(v)?v:'en'}catch{return 'en'}});
  const isOwner=currentUser?.role==='owner'&&currentUser?.isPlatformAdmin!==true;
  const load=useCallback(async()=>{
    if(!isOwner)return;
    try{
      const response=await fetch('/api/owner/communications?lang='+encodeURIComponent(language),{
        headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},
        cache:'no-store'
      });
      if(response.status===404){setModuleAvailable(false);setMessages([]);return;} // module not enabled
      if(!response.ok)throw new Error('Could not load platform notices.');
      setMessages(await response.json());setModuleAvailable(true);setError('');
    }catch(e){setError(e.message)}
  },[isOwner,language]);
  useEffect(()=>{
    if(!isOwner)return;
    load();
    const timer=setInterval(load,60000);
    return ()=>clearInterval(timer);
  },[isOwner,load]);
  if(!isOwner||(!moduleAvailable&&!error))return null;
  const act=async(id,action)=>{
    setBusy(true);
    try{
      const response=await fetch(`/api/owner/communications/${encodeURIComponent(id)}/${action}`,{
        method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`,'Content-Type':'application/json'},
        body:JSON.stringify({language})
      });
      if(!response.ok)throw new Error('Could not save acknowledgment.');
      await load();
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  const unread=messages.filter(m=>!m.readAt).length;
  return <section aria-label="Platform messages for restaurant owners"
    style={{border:'1px solid var(--border-color,#ddd)',borderRadius:12,padding:14,marginBottom:18,background:'var(--bg-card)'}}>
    <button type="button" className="btn btn-outline" onClick={()=>setOpen(x=>!x)}
      aria-expanded={open} style={{display:'flex',gap:8,alignItems:'center',width:'100%',justifyContent:'space-between'}}>
      <span style={{display:'flex',gap:8,alignItems:'center'}}><Bell size={18}/> Platform messages for owner</span>
      <strong>{unread?unread+' unread':messages.length+' notices'}</strong>
    </button>
    {open&&<div style={{display:'grid',gap:12,marginTop:12}}>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={async()=>{
        try{const response=await fetch('/api/owner/communications/push-preference',{headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`}});
          if(!response.ok)throw new Error('Could not load push preference.');setPushPreference(await response.json());setError('')}
        catch(e){setError(e.message)}
      }}>View future push preference</button>
      {pushPreference&&<div style={{display:'grid',gap:6}}>
        <button className="btn btn-outline" type="button" disabled={busy} onClick={async()=>{
          setBusy(true);try{
            const response=await fetch('/api/owner/communications/devices',{
              headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},cache:'no-store'
            });
            if(response.status===404){setInstallations({unavailable:true,devices:[]});return}
            if(!response.ok)throw new Error('Could not load enrolled installations.');
            setInstallations(await response.json());setError('');
          }catch(e){setError(e.message)}finally{setBusy(false)}
        }}>View registered installations (no notifications active)</button>
        {installations&&<div role="status" style={{fontSize:12}}>
          {installations.unavailable?'Installation enrollment is disabled on this environment.'
            :installations.devices?.length?
              installations.devices.map(d=><p key={d.deviceId}>{d.platform.toUpperCase()} · {d.revokedAt?'Revoked':'Enrolled'} · {d.deviceId}</p>)
              :'No installations enrolled.'}
        </div>}
      </div>}
      {pushPreference&&<label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" disabled={busy}
        checked={pushPreference.optedIn} onChange={async e=>{setBusy(true);try{
          const response=await fetch('/api/owner/communications/push-preference',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},body:JSON.stringify({optedIn:e.target.checked})});
          if(!response.ok)throw new Error('Could not update push preference.');setPushPreference(await response.json());setError('')
        }catch(err){setError(err.message)}finally{setBusy(false)}}}/>Opt in to future platform push notices (push delivery is not active)</label>}
      <label style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        Notice language
        <select aria-label="Preferred platform notice language" value={language} onChange={e=>{
          const next=e.target.value;setLanguage(next);
          try{localStorage.setItem('gastroflow_owner_notice_lang',next)}catch{}
        }}>
          <option value="en">English</option>
          <option value="si">සිංහල</option>
          <option value="ta">தமிழ்</option>
        </select>
      </label>
      {error&&<p role="alert">{error}</p>}
      {messages.map(m=><article key={m.id} style={{border:'1px solid var(--border-color,#ddd)',borderRadius:10,padding:14}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {m.requiresAcknowledgment?<ShieldAlert size={18}/>:<Bell size={18}/>}
          <strong>{m.title}</strong>
          {!m.readAt&&<small style={{marginLeft:'auto'}}>NEW</small>}
        </div>
        <small style={{display:'block',marginTop:6}}>{m.category}{m.policyVersion?' · Version '+m.policyVersion:''} · {new Date(m.publishedAt).toLocaleString()}</small>
        {language!=='en'&&m.contentLanguage==='en'&&<small style={{display:'block',marginTop:5}}>English original · Translation not available</small>}
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.body}</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {!m.readAt&&<button disabled={busy} className="btn btn-outline" type="button" onClick={()=>act(m.id,'read')}>Mark read</button>}
          {Boolean(m.requiresAcknowledgment)&&!m.acknowledgedAt&&<button disabled={busy} className="btn btn-primary" type="button"
            onClick={()=>act(m.id,'acknowledge')}><CheckCheck size={16}/> I have read and acknowledge this notice</button>}
          {m.acknowledgedAt&&<small>Acknowledged {new Date(m.acknowledgedAt).toLocaleString()}</small>}
          {m.acknowledgedAt&&<button className="btn btn-outline" type="button" disabled={busy} onClick={async()=>{
            setBusy(true);try{
              const response=await fetch('/api/owner/communications/'+encodeURIComponent(m.id)+'/receipt',{
                headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`}
              });
              if(!response.ok)throw new Error('Could not load acknowledgment receipt.');
              const receipt=await response.json();
              setReceipts(old=>({...old,[m.id]:receipt}));setError('');
            }catch(e){setError(e.message)}finally{setBusy(false)}
          }}>View acknowledgment receipt</button>}
          {receipts[m.id]&&<div style={{fontSize:12,overflowWrap:'anywhere',marginTop:8}}>
            <strong>Recorded acknowledgment</strong>
            <p>Language: {receipts[m.id].contentLanguage.toUpperCase()} · Version: {receipts[m.id].policyVersion||'—'}</p>
            <p>Content SHA-256: <code>{receipts[m.id].contentHash}</code></p>
            <p>Recorded: {new Date(receipts[m.id].acknowledgedAt).toLocaleString()}</p>
          </div>}
        </div>
      </article>)}
    </div>}
  </section>;
}

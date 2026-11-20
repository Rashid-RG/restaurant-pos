import React,{useCallback,useEffect,useState} from 'react';
import {Bell,CheckCheck,ShieldAlert,X} from 'lucide-react';

/** Restaurant-owner in-app inbox. No delivery to cashiers/managers. */
export default function OwnerCommunicationsInbox({currentUser}) {
  const [messages,setMessages]=useState([]);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const isOwner=currentUser?.role==='owner'&&currentUser?.isPlatformAdmin!==true;
  const load=useCallback(async()=>{
    if(!isOwner)return;
    try{
      const response=await fetch('/api/owner/communications',{
        headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},
        cache:'no-store'
      });
      if(response.status===404)return; // module not enabled for this deployment
      if(!response.ok)throw new Error('Could not load platform notices.');
      setMessages(await response.json());setError('');
    }catch(e){setError(e.message)}
  },[isOwner]);
  useEffect(()=>{
    if(!isOwner)return;
    load();
    const timer=setInterval(load,60000);
    return ()=>clearInterval(timer);
  },[isOwner,load]);
  if(!isOwner||(!messages.length&&!error))return null;
  const act=async(id,action)=>{
    setBusy(true);
    try{
      const response=await fetch(`/api/owner/communications/${encodeURIComponent(id)}/${action}`,{
        method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`}
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
      {error&&<p role="alert">{error}</p>}
      {messages.map(m=><article key={m.id} style={{border:'1px solid var(--border-color,#ddd)',borderRadius:10,padding:14}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {m.requiresAcknowledgment?<ShieldAlert size={18}/>:<Bell size={18}/>}
          <strong>{m.title}</strong>
          {!m.readAt&&<small style={{marginLeft:'auto'}}>NEW</small>}
        </div>
        <small style={{display:'block',marginTop:6}}>{m.category}{m.policyVersion?' · Version '+m.policyVersion:''} · {new Date(m.publishedAt).toLocaleString()}</small>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.body}</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {!m.readAt&&<button disabled={busy} className="btn btn-outline" type="button" onClick={()=>act(m.id,'read')}>Mark read</button>}
          {Boolean(m.requiresAcknowledgment)&&!m.acknowledgedAt&&<button disabled={busy} className="btn btn-primary" type="button"
            onClick={()=>act(m.id,'acknowledge')}><CheckCheck size={16}/> I have read and acknowledge this notice</button>}
          {m.acknowledgedAt&&<small>Acknowledged {new Date(m.acknowledgedAt).toLocaleString()}</small>}
        </div>
      </article>)}
    </div>}
  </section>;
}

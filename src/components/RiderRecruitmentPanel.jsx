import React,{useEffect,useState} from 'react';
import {Link2,Search,Copy,RefreshCw,ShieldCheck,Users,XCircle} from 'lucide-react';

export default function RiderRecruitmentPanel({onRefresh}){
 const [settings,setSettings]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [invitation,setInvitation]=useState(null);
 const [copied,setCopied]=useState(false);
 const token=()=>localStorage.getItem('gastroflow_token');
 const call=async(path,options={})=>{
  const res=await fetch('/api/delivery/driver-recruitment'+path,{
   ...options,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...options.headers},cache:'no-store'
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Restaurant hiring settings unavailable.');
  return data;
 };
 const load=async()=>{try{setSettings(await call(''));setError('');}catch(e){setError(e.message);}};
 useEffect(()=>{void load();},[]);
 const changeVisible=async()=>{
  setBusy(true);setError('');
  try{
   await call('',{method:'POST',body:JSON.stringify({discoverable:!settings.discoverable})});
   await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const generate=async()=>{
  setBusy(true);setError('');setCopied(false);
  try{
   const result=await call('/invitations',{method:'POST',body:'{}'});
   const params=new URLSearchParams({invite:result.code});
   const url=window.location.origin+'/driver-app/?'+params.toString();
   setInvitation({url,expiresAt:result.expiresAt});
   await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const revoke=async()=>{
  if(!window.confirm('Revoke all outstanding rider invitation codes for this restaurant?'))return;
  setBusy(true);setError('');
  try{
   await call('/invitations/revoke-all',{method:'POST',body:'{}'});
   setInvitation(null);await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const copy=async(text)=>{
  try{await navigator.clipboard.writeText(text);setCopied(true);}catch(_){setError('Copy is unavailable. Select and copy the invitation URL manually.');}
 };

 const surface={border:'1px solid var(--border-color)',borderRadius:16,padding:18,background:'var(--bg-card)'};
 const muted={fontSize:13,color:'var(--text-muted)',lineHeight:1.55,margin:0};
 const action={display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,borderRadius:11,minHeight:42};
 const stateTag=(on)=>({display:'inline-flex',alignItems:'center',gap:7,padding:'6px 10px',borderRadius:99,fontSize:12,fontWeight:750,background:on?'rgba(16,185,129,.11)':'rgba(148,163,184,.13)',color:on?'#168360':'var(--text-muted)'});
 if(!settings)return <section className="card" style={{...surface,display:'grid',gap:10}} aria-label="Restaurant rider recruitment">
   <h3 style={{margin:0}}>Rider recruitment</h3>
   {error?<><p role="alert" style={{color:'#dc2626',margin:0}}>{error}</p><button type="button" className="btn btn-outline" style={{...action,justifySelf:'start'}} onClick={load}><RefreshCw size={16}/> Retry loading</button></>:<p role="status" style={muted}>Loading recruitment settings…</p>}
 </section>;
 return <section aria-label="Restaurant rider recruitment" style={{...surface,display:'grid',gap:18,padding:'clamp(16px,2vw,24px)'}}>
   <header style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
     <div style={{display:'grid',gap:7}}>
       <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
         <span style={{display:'grid',placeItems:'center',width:38,height:38,background:'rgba(16,185,129,.11)',borderRadius:12,color:'#168360'}}><Users size={21}/></span>
         <h2 style={{margin:0,fontSize:'clamp(19px,2vw,23px)',letterSpacing:'-.025em'}}>Recruit drivers for {settings.restaurant.name}</h2>
       </div>
       <p style={muted}>Choose how drivers can join your restaurant. Every application stays private to your restaurant.</p>
     </div>
     <button type="button" className="btn btn-outline" style={action} disabled={busy} onClick={load}><RefreshCw size={15}/> Refresh</button>
   </header>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,290px),1fr))',gap:14}}>
     <article style={{...surface,display:'grid',gap:13,alignContent:'start',background:'var(--bg-card)'}}>
       <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
         <strong style={{display:'flex',alignItems:'center',gap:8,fontSize:16}}><Search size={18}/> Public restaurant search</strong>
         <span style={stateTag(settings.discoverable)}><span aria-hidden="true">●</span>{settings.discoverable?'Visible':'Hidden'}</span>
       </div>
       <p style={muted}>Allow new drivers to find <strong>{settings.restaurant.name}</strong> when searching GastroDriver.</p>
       <label style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--bg-secondary,rgba(148,163,184,.07))',border:'1px solid var(--border-color)',borderRadius:12,cursor:busy?'wait':'pointer',fontSize:14,fontWeight:700}}>
         <input type="checkbox" checked={settings.discoverable} disabled={busy} onChange={changeVisible} style={{width:19,height:19,accentColor:'#168360',flexShrink:0}}/>
         {settings.discoverable?'Listed for rider applications':'Enable restaurant discovery'}
       </label>
       <p style={{...muted,fontSize:12}}>{settings.discoverable?'Drivers can search for this restaurant and apply. Approval is still required.':'Only drivers with a valid private invitation can join.'}</p>
     </article>
     <article style={{...surface,display:'grid',gap:13,alignContent:'start',background:'var(--bg-card)'}}>
       <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
         <strong style={{display:'flex',alignItems:'center',gap:8,fontSize:16}}><Link2 size={18}/> Invite a driver</strong>
         <span style={stateTag(settings.activeInviteCount>0)}>{settings.activeInviteCount} active</span>
       </div>
       <p style={muted}>Send a private, restaurant-specific invitation to a driver. The link is valid for 14 days.</p>
       <div style={{display:'flex',gap:9,flexWrap:'wrap'}}>
         <button type="button" className="btn btn-primary" style={{...action,flex:'1 1 180px'}} disabled={busy} onClick={generate}><Link2 size={16}/> Generate invitation</button>
         {settings.activeInviteCount>0&&<button type="button" className="btn btn-outline" style={action} disabled={busy} onClick={revoke}><XCircle size={15}/> Revoke all</button>}
       </div>
       <p style={{...muted,fontSize:12}}>Invite codes are shown once. Copy the link before leaving this page.</p>
     </article>
   </div>
   {invitation&&<aside aria-label="New restaurant invitation" style={{display:'grid',gap:11,borderRadius:14,border:'1px solid rgba(16,185,129,.35)',padding:16,background:'rgba(16,185,129,.06)'}}>
     <strong style={{display:'flex',alignItems:'center',gap:8}}><ShieldCheck size={18}/> Your invitation is ready</strong>
     <p style={{...muted,fontSize:12}}>Expires {new Date(invitation.expiresAt).toLocaleString()}. Share only with the intended driver.</p>
     <div style={{display:'flex',flexWrap:'wrap',gap:9}}>
       <input readOnly aria-label="Copyable GastroDriver invitation link" className="form-input" value={invitation.url} onFocus={e=>e.target.select()} style={{flex:'1 1 240px',minWidth:0}}/>
       <button type="button" className="btn btn-primary" style={action} onClick={()=>copy(invitation.url)}><Copy size={15}/>{copied?'Copied':'Copy link'}</button>
     </div>
   </aside>}
   <div style={{display:'grid',gap:12,padding:'14px 16px',borderRadius:14,background:'var(--bg-secondary,rgba(148,163,184,.07))'}}>
     <strong style={{fontSize:14}}>How a driver joins</strong>
     <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,150px),1fr))',gap:12}}>
       {['Find restaurant or open invite','Register and verify email','Submit required documents','Manager reviews and approves'].map((step,index)=><div key={step} style={{display:'flex',alignItems:'flex-start',gap:9}}>
         <span aria-hidden="true" style={{display:'grid',placeItems:'center',width:25,height:25,borderRadius:9,background:'rgba(16,185,129,.12)',color:'#168360',fontWeight:800,fontSize:12,flexShrink:0}}>{index+1}</span>
         <span style={{fontSize:12,lineHeight:1.55}}>{step}</span>
       </div>)}
     </div>
   </div>
   {error&&<p role="alert" style={{color:'#dc2626',fontSize:13,margin:0}}>{error}</p>}
 </section>;
}

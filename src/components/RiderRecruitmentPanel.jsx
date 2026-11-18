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
 if(!settings)return <section className="card" style={{padding:22}}><h3>Restaurant rider recruitment</h3>{error?<p role="alert">{error}</p>:<p role="status">Loading hiring controls…</p>}</section>;
 return <section className="card" aria-label="Restaurant rider recruitment" style={{padding:22,display:'grid',gap:16,borderRadius:18}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:12,flexWrap:'wrap'}}>
   <div><h3 style={{margin:0,display:'flex',gap:8,alignItems:'center'}}><Users size={22}/>Recruit riders for {settings.restaurant.name}</h3>
    <p style={{color:'var(--text-muted)',fontSize:13,margin:'7px 0 0'}}>One GastroDriver app for every restaurant. Invitations and public discovery are controlled by your restaurant.</p>
   </div>
   <button className="btn btn-outline" type="button" disabled={busy} onClick={load}><RefreshCw size={15}/> Refresh</button>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}>
   <div style={{border:'1px solid var(--border-color)',borderRadius:13,padding:16}}>
    <h4 style={{margin:'0 0 6px',display:'flex',alignItems:'center',gap:7}}><Search size={17}/> Find my restaurant</h4>
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Allow interested riders to find this restaurant in GastroDriver. Off by default.</p>
    <label style={{display:'flex',gap:10,alignItems:'center',fontSize:13,fontWeight:700}}>
     <input type="checkbox" checked={settings.discoverable} disabled={busy} onChange={changeVisible}/>
     {settings.discoverable?'Listed for rider applications':'Not listed publicly'}
    </label>
   </div>
   <div style={{border:'1px solid var(--border-color)',borderRadius:13,padding:16}}>
    <h4 style={{margin:'0 0 6px',display:'flex',alignItems:'center',gap:7}}><Link2 size={17}/> Private hiring invitations</h4>
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Generate an invitation valid for 14 days. It connects riders only to {settings.restaurant.name}.</p>
    <p style={{fontSize:12}}>{settings.activeInviteCount} active invitation(s)</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button className="btn btn-primary" type="button" disabled={busy} onClick={generate}>Generate invitation</button>
     <button className="btn btn-outline" type="button" disabled={busy||!settings.activeInviteCount} onClick={revoke}><XCircle size={15}/> Revoke all</button>
    </div>
   </div>
  </div>
  {invitation&&<div style={{padding:16,border:'1px solid rgba(16,185,129,.35)',background:'rgba(16,185,129,.07)',borderRadius:13,display:'grid',gap:9}}>
   <strong style={{display:'flex',alignItems:'center',gap:8}}><ShieldCheck size={18}/> New restaurant invitation</strong>
   <p style={{fontSize:12,margin:0}}>Expires {new Date(invitation.expiresAt).toLocaleString()}. The private invitation is displayed only now; save it securely.</p>
   <input readOnly aria-label="Copyable GastroDriver invitation link" className="form-input" value={invitation.url} onFocus={e=>e.target.select()}/>
   <button className="btn btn-primary" type="button" onClick={()=>copy(invitation.url)}><Copy size={15}/>{copied?'Copied':'Copy invitation link'}</button>
  </div>}
  {error&&<p role="alert" style={{color:'#dc2626',fontSize:13}}>{error}</p>}
 </section>;
}

import React,{useEffect,useState} from 'react';
import {Megaphone,ShieldCheck,Send,RefreshCw,AlertTriangle,CheckCircle2} from 'lucide-react';

const defaultDraft={title:'',body:'',category:'announcement',requiresAcknowledgment:false,scope:'all',tenantIds:[],expiresInDays:'30',policyVersion:''};
const token=()=>localStorage.getItem('gastroflow_token');
async function api(path,options={}){
  const response=await fetch('/api/platform/communications'+path,{
    ...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed: ${response.status}`);
  return data;
}
export default function PlatformCommunicationCenter({restaurants=[]}){
  const [draft,setDraft]=useState(defaultDraft);
  const [items,setItems]=useState([]);
  const [templates,setTemplates]=useState([]);
  const [templateName,setTemplateName]=useState('');
  const [preview,setPreview]=useState(null);
  const [report,setReport]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [filter,setFilter]=useState('');
  const update=(key,value)=>{setDraft(x=>({...x,[key]:value}));setPreview(null);};
  const audience=()=>({scope:draft.scope,tenantIds:draft.scope==='specific'?draft.tenantIds:[]});
  const refresh=async()=>{try{const [announcements,savedTemplates]=await Promise.all([api(''),api('/templates')]);setItems(announcements);setTemplates(savedTemplates);setError('')}catch(e){setError(e.message)}};
  useEffect(()=>{refresh()},[]);
  const act=async(fn)=>{setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}};
  const eligible=restaurants.filter(x=>x.id!=='default_tenant'&&x.status==='active'
    &&(`${x.name} ${x.subdomain}`.toLowerCase().includes(filter.toLowerCase())));
  const toggle=(id,checked)=>update('tenantIds',checked?[...new Set([...draft.tenantIds,id])]:draft.tenantIds.filter(x=>x!==id));
  return <section style={{display:'grid',gap:20}} aria-label="Platform Communication Center">
    <header style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap'}}>
      <div><h2 style={{margin:0,display:'flex',alignItems:'center',gap:8}}><Megaphone size={24}/> Communication Center</h2>
      <p style={{margin:'7px 0',color:'var(--text-muted)'}}>Owner-only announcements, important notices and policy acknowledgments. In-app delivery on staging.</p></div>
      <button type="button" className="btn btn-outline" onClick={refresh}><RefreshCw size={16}/> Refresh</button>
    </header>
    {error&&<p role="alert" style={{padding:12,borderRadius:10,background:'var(--bg-card)',color:'var(--danger,#c0392b)'}}>{error}</p>}
    {notice&&<p role="status" style={{padding:12,borderRadius:10,background:'var(--bg-card)'}}>{notice}</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:16,alignItems:'start'}}>
      <form onSubmit={e=>{e.preventDefault();act(async()=>{
        const data=await api('',{method:'POST',body:JSON.stringify({
          title:draft.title,body:draft.body,category:draft.category,
          requiresAcknowledgment:draft.requiresAcknowledgment||['policy','disclaimer'].includes(draft.category),
          policyVersion:['policy','disclaimer'].includes(draft.category)?draft.policyVersion:null,
          expiresAt:draft.expiresInDays?Date.now()+Number(draft.expiresInDays)*86400000:null,
          audience:audience()})});
        setNotice('Draft created. Review it below before publishing. ID: '+data.id);
        setDraft(defaultDraft);setPreview(null);await refresh();
      })}} style={{display:'grid',gap:12,padding:20,border:'1px solid var(--border-color,#ddd)',borderRadius:14,background:'var(--bg-card)'}}>
        <h3 style={{margin:0}}>Compose owner announcement</h3>
        <label>Use saved template<select value="" onChange={e=>{
          const selected=templates.find(t=>t.id===e.target.value);
          if(selected){setDraft(d=>({...d,title:selected.title,body:selected.body,category:selected.category,requiresAcknowledgment:Boolean(selected.requiresAcknowledgment)}));setPreview(null)}
        }}>
          <option value="">Start from blank</option>
          {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <label>Title<input required maxLength={140} minLength={3} value={draft.title} onChange={e=>update('title',e.target.value)} placeholder="Important update for restaurant owners"/></label>
        <label>Message<textarea required minLength={5} maxLength={10000} rows={6} value={draft.body} onChange={e=>update('body',e.target.value)} placeholder="Explain the change, action required and effective date."/></label>
        <label>Message category<select value={draft.category} onChange={e=>update('category',e.target.value)}>
          {['announcement','urgent','maintenance','policy','disclaimer','feature'].map(x=><option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</option>)}
        </select></label>
        {['policy','disclaimer'].includes(draft.category)&&<label>Policy version (required)
          <input required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={draft.policyVersion}
            onChange={e=>update('policyVersion',e.target.value)} placeholder="e.g. 2026-11-v1"/>
          <small>Version is recorded with a SHA-256 content fingerprint at creation.</small>
        </label>}
        <label>Recipients<select value={draft.scope} onChange={e=>update('scope',e.target.value)}>
          <option value="all">All active restaurant owners</option>
          <option value="specific">Selected restaurants only</option>
        </select></label>
        {draft.scope==='specific'&&<div style={{display:'grid',gap:9,maxHeight:220,overflow:'auto',padding:10,border:'1px solid var(--border-color,#ddd)',borderRadius:8}}>
          <input aria-label="Find restaurants" placeholder="Search restaurants" value={filter} onChange={e=>setFilter(e.target.value)}/>
          {eligible.map(x=><label key={x.id} style={{display:'flex',gap:9,alignItems:'center'}}>
            <input type="checkbox" checked={draft.tenantIds.includes(x.id)} onChange={e=>toggle(x.id,e.target.checked)}/>{x.name}
          </label>)}
          {!eligible.length&&<small>No active restaurants match.</small>}
        </div>}
        <label style={{display:'flex',gap:8,alignItems:'center'}}>
          <input type="checkbox" checked={draft.requiresAcknowledgment||['policy','disclaimer'].includes(draft.category)} disabled={['policy','disclaimer'].includes(draft.category)} onChange={e=>update('requiresAcknowledgment',e.target.checked)}/>
          Require owner acknowledgment
        </label>
        <label>Expiry in days<input type="number" min="1" max="365" value={draft.expiresInDays} onChange={e=>update('expiresInDays',e.target.value)}/></label>
        <button type="button" className="btn btn-outline" disabled={busy||(draft.scope==='specific'&&!draft.tenantIds.length)}
          onClick={()=>act(async()=>setPreview(await api('/preview',{method:'POST',body:JSON.stringify({audience:audience()})})))}>Preview recipients</button>
        {preview&&<div style={{padding:12,border:'1px solid var(--border-color,#ddd)',borderRadius:10}}>
          <ShieldCheck size={18}/> <strong>{preview.recipientCount} verified owners</strong> in {preview.restaurantCount} restaurants
          <p style={{fontSize:12}}>Only server-verified active restaurant owners are eligible. This is not a send confirmation.</p>
        </div>}
        <section style={{display:'grid',gap:8,padding:12,borderRadius:10,border:'1px solid var(--border-color,#ddd)'}}>
          <strong>Reusable templates</strong>
          <input value={templateName} maxLength={100} placeholder="Template name" aria-label="New template name" onChange={e=>setTemplateName(e.target.value)}/>
          <button type="button" className="btn btn-outline" disabled={busy||templateName.trim().length<2||draft.title.trim().length<3||draft.body.trim().length<5}
            onClick={()=>act(async()=>{
              await api('/templates',{method:'POST',body:JSON.stringify({name:templateName,title:draft.title,body:draft.body,category:draft.category,requiresAcknowledgment:draft.requiresAcknowledgment||['policy','disclaimer'].includes(draft.category)})});
              setTemplateName('');await refresh();setNotice('Template saved.');
            })}>Save current message as template</button>
        </section>
        <button type="submit" className="btn btn-primary" disabled={busy||(draft.scope==='specific'&&!draft.tenantIds.length)}>
          Save as draft
        </button>
      </form>
      <section style={{display:'grid',gap:12,padding:20,border:'1px solid var(--border-color,#ddd)',borderRadius:14,background:'var(--bg-card)'}}>
        <h3 style={{margin:0}}>Announcement history</h3>
        <p style={{fontSize:12,color:'var(--text-muted)',margin:0}}>Publishing is immediate to the owners' in-app inbox. It does not send emails or push notifications.</p>
        {!items.length&&<p>No announcements yet.</p>}
        {items.map(x=><article key={x.id} style={{padding:14,border:'1px solid var(--border-color,#ddd)',borderRadius:10,display:'grid',gap:9}}>
          <div style={{display:'flex',gap:8,justifyContent:'space-between'}}><strong>{x.title}</strong><small>{x.status}</small></div>
          <small>{x.category}{x.policyVersion?' · Version '+x.policyVersion:''} · {new Date(x.createdAt).toLocaleString()}</small>
          {x.status==='draft'&&<button type="button" className="btn btn-primary" disabled={busy}
            onClick={()=>{if(!window.confirm('Publish this announcement to all currently eligible selected owners?'))return;
              act(async()=>{const result=await api('/'+encodeURIComponent(x.id)+'/publish',{method:'POST'});
                setNotice(`Published to ${result.recipientCount} owners in ${result.restaurantCount} restaurants.`);await refresh();})}}>
            <Send size={15}/> Publish now</button>}
          {x.status==='published'&&<button type="button" className="btn btn-outline" disabled={busy}
            onClick={()=>act(async()=>{setReport(await api('/'+encodeURIComponent(x.id)+'/report'))})}>Delivery and acknowledgment report</button>}
          {x.status!=='cancelled'&&<button type="button" className="btn btn-outline" disabled={busy}
            onClick={()=>{if(!window.confirm('Cancel this notice?'))return;act(async()=>{await api('/'+encodeURIComponent(x.id)+'/cancel',{method:'POST'});await refresh()})}}>
            Cancel notice</button>}
        </article>)}
        {report&&<div role="status" style={{padding:14,borderRadius:10,border:'1px solid var(--border-color,#ddd)'}}>
          <h4 style={{marginTop:0}}>Delivery report: {report.announcement.title}</h4>
          <p>Inbox recipients: {report.stats.recipients||0}<br/>Restaurants: {report.stats.restaurants||0}<br/>
          Read: {report.stats.readCount||0}<br/>Acknowledged: {report.stats.acknowledgedCount||0}</p>
          <small>Inbox delivery does not prove the owner has viewed the message.</small>
        </div>}
      </section>
    </div>
    <p style={{fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:7}}>
      <AlertTriangle size={16}/> Staging foundation. Automated scheduling, native push, email, multilingual translations and formal legal consent workflows remain pending.
    </p>
  </section>;
}

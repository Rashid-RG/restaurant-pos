import React,{useCallback,useEffect,useState} from 'react';
import { Megaphone,Plus,RefreshCw,Image as ImageIcon,Eye,PauseCircle,PlayCircle,CalendarDays,Gift } from 'lucide-react';
import './PromotionManager.css';

const blank=()=>({title:'',subtitle:'',offerLabel:'',imageUrl:'',cta:'Explore menu',status:'draft',startsAt:null,endsAt:null,showPopup:false,autoCreative:true});
const datetime=value=>value?new Date(value).toISOString().slice(0,16):'';
const parseDate=value=>value?new Date(value).getTime():null;

export default function PromotionManager({platform=false,restaurants=[]}) {
  const [campaigns,setCampaigns]=useState([]);
  const [form,setForm]=useState(blank);
  const [tenant,setTenant]=useState('');
  const [editing,setEditing]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const endpoint=platform?'/api/platform/food-promotions':'/api/food-promotions/manage';
  const request=useCallback(async(url,options={})=>{
    const token=localStorage.getItem('gastroflow_token');
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||'')}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Promotion request failed.');
    return data;
  },[]);
  const refresh=useCallback(async()=>{
    try { const data=await request(endpoint);setCampaigns(Array.isArray(data.campaigns)?data.campaigns:[]);setError(''); }
    catch(err){setError(err.message);}
  },[endpoint,request]);
  useEffect(()=>{void refresh()},[refresh]);
  const update=(key,value)=>setForm(prev=>({...prev,[key]:value}));
  const edit=c=>{
    setEditing(c.id);setTenant(c.tenantId||'');
    setForm({title:c.title,subtitle:c.subtitle||'',offerLabel:c.offerLabel||'',imageUrl:c.imageUrl||'',
      cta:c.cta||'Explore menu',status:c.status,startsAt:c.startsAt,endsAt:c.endsAt,
      showPopup:!!c.showPopup,autoCreative:c.autoCreative!==false});
    setError('');setNotice('');
  };
  const reset=()=>{setForm(blank());setEditing(null);setTenant('');};
  const save=async(e)=>{
    e.preventDefault();if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      if(form.endsAt&&form.startsAt&&form.endsAt<=form.startsAt)throw new Error('End date must be after start date.');
      const body={...form,...platform&&!editing?{tenantId:tenant||null}:{}};
      const url=editing?endpoint+'/'+encodeURIComponent(editing):endpoint;
      await request(url,{method:editing?'PATCH':'POST',body:JSON.stringify(body)});
      setNotice('Campaign saved. Active promotions appear automatically when their dates are valid.');
      reset();await refresh();
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  const setStatus=async(c,status)=>{
    setBusy(true);setError('');
    try{
      const payload={title:c.title,subtitle:c.subtitle||'',offerLabel:c.offerLabel||'',imageUrl:c.imageUrl||'',
        cta:c.cta||'Explore menu',status,startsAt:c.startsAt,endsAt:c.endsAt,showPopup:!!c.showPopup,autoCreative:c.autoCreative!==false};
      await request(endpoint+'/'+encodeURIComponent(c.id),{method:'PATCH',body:JSON.stringify(payload)});
      await refresh();
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  const entry=(label,key,props={})=><label className="gf-campaign-field"><span>{label}</span>
    <input {...props} value={form[key]} onChange={e=>update(key,e.target.value)} /></label>;
  return <section className="gf-campaign-manager" aria-label="Food promotions and advertising manager">
    <header className="gf-campaign-heading"><div><span><Megaphone size={16}/> GASTROFLOW CAMPAIGN STUDIO</span><h2>Offers & advertisements</h2><p>Create real promotions once; the app generates an elegant campaign banner and can rotate it automatically.</p></div><button type="button" onClick={refresh}><RefreshCw size={16}/> Refresh</button></header>
    {error&&<p role="alert" className="gf-campaign-error">{error}</p>}
    {notice&&<p role="status" className="gf-campaign-success">{notice}</p>}
    <div className="gf-campaign-layout">
      <form className="gf-campaign-form" onSubmit={save}>
        <h3>{editing?'Edit promotion':'Create promotion'}</h3>
        {platform&&!editing&&<label className="gf-campaign-field"><span>Where should this appear?</span><select value={tenant} onChange={e=>setTenant(e.target.value)}>
          <option value="">Entire GastroFlow marketplace</option>{restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>}
        {entry('Campaign headline','title',{required:true,minLength:3,maxLength:90,placeholder:'Friday BBQ Special'})}
        <label className="gf-campaign-field"><span>Offer details (must match the real offer)</span><textarea value={form.subtitle} maxLength={180} placeholder="Example: Save 10% on selected BBQ dishes this Friday" onChange={e=>update('subtitle',e.target.value)}/></label>
        <div className="gf-campaign-two">
          {entry('Offer badge','offerLabel',{maxLength:55,placeholder:'Limited time'})}
          {entry('Button label','cta',{required:true,maxLength:40})}
        </div>
        {entry('Campaign image URL (optional)','imageUrl',{maxLength:1000,placeholder:'https://... or /uploads/...'})}
        <div className="gf-campaign-two">
          <label className="gf-campaign-field"><span>Starts (optional)</span><input type="datetime-local" value={datetime(form.startsAt)} onChange={e=>update('startsAt',parseDate(e.target.value))}/></label>
          <label className="gf-campaign-field"><span>Ends (optional)</span><input type="datetime-local" value={datetime(form.endsAt)} onChange={e=>update('endsAt',parseDate(e.target.value))}/></label>
        </div>
        <label className="gf-campaign-field"><span>Publishing</span><select value={form.status} onChange={e=>update('status',e.target.value)}><option value="draft">Draft — not public</option><option value="active">Active — publish on dates</option><option value="paused">Paused</option></select></label>
        <label className="gf-campaign-check"><input type="checkbox" checked={form.autoCreative} onChange={e=>update('autoCreative',e.target.checked)}/> Automatically generate branded advertisement design</label>
        <label className="gf-campaign-check"><input type="checkbox" checked={form.showPopup} onChange={e=>update('showPopup',e.target.checked)}/> Display dismissible customer offer popup once per session</label>
        <p className="gf-campaign-caution">Advertisement content must represent a genuine offer. Creating a campaign does not automatically change menu prices or validate a discount code at checkout.</p>
        <div className="gf-campaign-actions"><button type="submit" disabled={busy}><Plus size={17}/>{busy?'Saving…':editing?'Save changes':'Create campaign'}</button>{editing&&<button type="button" onClick={reset}>Cancel</button>}</div>
      </form>
      <div className="gf-campaign-list">
        <h3>Campaigns <small>{campaigns.length}</small></h3>
        {campaigns.length===0&&<p>No campaigns yet. Create your first advertisement using the form.</p>}
        {campaigns.map(c=><article key={c.id} className="gf-campaign-card">
          <div className="gf-campaign-card-art">{c.imageUrl?<img src={c.imageUrl} loading="lazy" alt=""/>:<Gift size={42}/>}</div>
          <div className="gf-campaign-card-body"><span>{c.offerLabel||'GastroFlow Food'} · {c.status}</span><strong>{c.title}</strong><small>{c.subtitle}</small>
            <div className="gf-campaign-actions"><button type="button" onClick={()=>edit(c)} disabled={busy}><Eye size={15}/> Edit</button>
              <button type="button" disabled={busy} onClick={()=>setStatus(c,c.status==='active'?'paused':'active')}>{c.status==='active'?<PauseCircle size={15}/>:<PlayCircle size={15}/>} {c.status==='active'?'Pause':'Activate'}</button>
            </div>
          </div>
        </article>)}
      </div>
    </div>
  </section>;
}

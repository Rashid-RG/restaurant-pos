import React,{useCallback,useEffect,useState} from 'react';
import { Megaphone,Plus,RefreshCw,Image as ImageIcon,Eye,PauseCircle,PlayCircle,CalendarDays,Gift } from 'lucide-react';
import './PromotionManager.css';

const blank=()=>({title:'',subtitle:'',offerLabel:'',imageUrl:'',cta:'Explore menu',status:'draft',startsAt:null,endsAt:null,showPopup:false,autoCreative:true,coupon:null});
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
  const [creativeBusy,setCreativeBusy]=useState(false);
  const [creativeIdea,setCreativeIdea]=useState(null);
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
      showPopup:!!c.showPopup,autoCreative:c.autoCreative!==false,coupon:c.coupon||null});
    setError('');setNotice('');
  };
  const reset=()=>{setForm(blank());setEditing(null);setTenant('');setCreativeIdea(null);};
  const suggestCreative=async()=>{
    if(!form.title.trim()){setError('Enter the real promotion headline first.');return;}
    setCreativeBusy(true);setError('');setCreativeIdea(null);
    try {
      const url=platform?'/api/platform/food-promotions/creative-draft':'/api/food-promotions/creative-draft';
      const result=await request(url,{method:'POST',body:JSON.stringify({
        title:form.title,subtitle:form.subtitle,offerLabel:form.offerLabel
      })});
      setCreativeIdea(result);
    }catch(err){setError(err.message)}finally{setCreativeBusy(false)}
  };
  const save=async(e)=>{
    e.preventDefault();if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      if(form.endsAt&&form.startsAt&&form.endsAt<=form.startsAt)throw new Error('End date must be after start date.');
      const coupon=form.coupon ? {
        code:String(form.coupon.code||'').trim().toUpperCase(),
        type:form.coupon.type,value:Number(form.coupon.value),
        minSpend:Number(form.coupon.minSpend),maxUses:Number(form.coupon.maxUses),
        perCustomerLimit:Number(form.coupon.perCustomerLimit),orderType:form.coupon.orderType
      } : undefined;
      const body={...form,coupon,...(platform&&!editing?{tenantId:tenant||null}:{})};
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
  const editCoupon=(key,value)=>setForm(prev=>({...prev,coupon:{...prev.coupon,[key]:value}}));
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
        <section className="gf-campaign-creative" aria-label="Automatic advertisement creative">
          <div><strong>Auto Creative Studio</strong><p>Generates a GastroFlow-branded visual using your actual campaign information and published food imagery. Optional AI helps suggest a short tagline, without inventing prices or discounts.</p></div>
          <button type="button" disabled={creativeBusy} onClick={suggestCreative}>{creativeBusy?'Generating…':'✨ Suggest creative copy'}</button>
          {creativeIdea&&<div className="gf-campaign-creative-draft" role="status"><strong>{creativeIdea.headline}</strong><p>{creativeIdea.tagline}</p><small>{creativeIdea.engine==='ai-assisted-copy'?'AI-assisted tagline':'Branded template suggestion (AI not configured)'}. Review every claim before publishing.</small></div>}
        </section>
        <div className="gf-campaign-two">
          <label className="gf-campaign-field"><span>Starts (optional)</span><input type="datetime-local" value={datetime(form.startsAt)} onChange={e=>update('startsAt',parseDate(e.target.value))}/></label>
          <label className="gf-campaign-field"><span>Ends (optional)</span><input type="datetime-local" value={datetime(form.endsAt)} onChange={e=>update('endsAt',parseDate(e.target.value))}/></label>
        </div>
        <section className="gf-campaign-coupon-setup" aria-label="Verified checkout discount rules">
          <label className="gf-campaign-check"><input type="checkbox" checked={!!form.coupon} disabled={(platform&&!editing&&!tenant)||(!!editing&&!!form.coupon)}
            onChange={e=>setForm(prev=>({...prev,coupon:e.target.checked?{code:'',type:'percent',value:10,minSpend:0,maxUses:0,perCustomerLimit:0,orderType:'any'}:null}))}/>
            Enable a real checkout discount code
          </label>
          {form.coupon&&<div className="gf-campaign-coupon-fields">
            <label className="gf-campaign-field"><span>Coupon code</span><input required minLength={3} maxLength={40} pattern="[A-Za-z0-9_-]{3,40}" placeholder="BBQFRIDAY" value={form.coupon.code} onChange={e=>editCoupon('code',e.target.value.toUpperCase())}/></label>
            <div className="gf-campaign-two">
              <label className="gf-campaign-field"><span>Discount type</span><select value={form.coupon.type} onChange={e=>editCoupon('type',e.target.value)}><option value="percent">Percentage %</option><option value="flat">Fixed LKR</option></select></label>
              <label className="gf-campaign-field"><span>{form.coupon.type==='percent'?'Percent (up to 100)':'LKR amount'}</span><input required type="number" min="0.01" step="0.01" max={form.coupon.type==='percent'?100:1000000} value={form.coupon.value} onChange={e=>editCoupon('value',e.target.value)}/></label>
            </div>
            <div className="gf-campaign-two">
              <label className="gf-campaign-field"><span>Minimum cart spend (LKR)</span><input type="number" min="0" step=".01" value={form.coupon.minSpend} onChange={e=>editCoupon('minSpend',e.target.value)}/></label>
              <label className="gf-campaign-field"><span>Maximum total uses (0 = unlimited)</span><input type="number" min="0" step="1" value={form.coupon.maxUses} onChange={e=>editCoupon('maxUses',e.target.value)}/></label>
            </div>
            <div className="gf-campaign-two">
              <label className="gf-campaign-field"><span>Per-account uses (0 = unlimited)</span><input type="number" min="0" step="1" value={form.coupon.perCustomerLimit} onChange={e=>editCoupon('perCustomerLimit',e.target.value)}/></label>
              <label className="gf-campaign-field"><span>Eligible order types</span><select value={form.coupon.orderType} onChange={e=>editCoupon('orderType',e.target.value)}><option value="any">All orders</option><option value="delivery">Delivery only</option><option value="takeaway">Takeaway only</option><option value="dine-in">Dine-in only</option></select></label>
            </div>
            {editing&&form.coupon.usedCount>0&&<p className="gf-campaign-caution">Redeemed: {form.coupon.usedCount} uses. Changing a coupon does not erase past redemptions.</p>}
          </div>}
        </section>
        <label className="gf-campaign-field"><span>Publishing</span><select value={form.status} onChange={e=>update('status',e.target.value)}><option value="draft">Draft — not public</option><option value="active">Active — publish on dates</option><option value="paused">Paused</option></select></label>
        <label className="gf-campaign-check"><input type="checkbox" checked={form.autoCreative} onChange={e=>update('autoCreative',e.target.checked)}/> Automatically generate branded advertisement design</label>
        <label className="gf-campaign-check"><input type="checkbox" checked={form.showPopup} onChange={e=>update('showPopup',e.target.checked)}/> Display dismissible customer offer popup once per session</label>
        <p className="gf-campaign-caution">Advertisement content must represent a genuine offer. Campaign coupons, when enabled, are validated against the server's real menu prices, order type, schedule and redemption limits at checkout.</p>
        <div className="gf-campaign-actions"><button type="submit" disabled={busy}><Plus size={17}/>{busy?'Saving…':editing?'Save changes':'Create campaign'}</button>{editing&&<button type="button" onClick={reset}>Cancel</button>}</div>
      </form>
      <div className="gf-campaign-list">
        <h3>Campaigns <small>{campaigns.length}</small></h3>
        {campaigns.length===0&&<p>No campaigns yet. Create your first advertisement using the form.</p>}
        {campaigns.map(c=><article key={c.id} className="gf-campaign-card">
          <div className="gf-campaign-card-art">{c.imageUrl?<img src={c.imageUrl} loading="lazy" alt=""/>:<Gift size={42}/>}</div>
          <div className="gf-campaign-card-body"><span>{c.offerLabel||'GastroFlow Food'} · {c.status}</span><strong>{c.title}</strong><small>{c.subtitle}</small>
            {c.coupon&&<div className="gf-campaign-metrics"><span>Code <b>{c.coupon.code}</b></span><span>Redeemed <b>{c.coupon.usedCount||0}</b>{c.coupon.maxUses>0?` / ${c.coupon.maxUses}`:''}</span></div>}
            <div className="gf-campaign-metrics" aria-label="Campaign engagement"><span>Views <b>{Number(c.impressions||0).toLocaleString()}</b></span><span>Opens <b>{Number(c.clicks||0).toLocaleString()}</b></span></div>
            <div className="gf-campaign-actions"><button type="button" onClick={()=>edit(c)} disabled={busy}><Eye size={15}/> Edit</button>
              <button type="button" disabled={busy} onClick={()=>setStatus(c,c.status==='active'?'paused':'active')}>{c.status==='active'?<PauseCircle size={15}/>:<PlayCircle size={15}/>} {c.status==='active'?'Pause':'Activate'}</button>
            </div>
          </div>
        </article>)}
      </div>
    </div>
  </section>;
}

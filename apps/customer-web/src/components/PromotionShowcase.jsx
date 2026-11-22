import React,{useCallback,useEffect,useRef,useState} from 'react';
import { ChevronLeft,ChevronRight,Gift,X,Store,ArrowRight,Sparkles } from 'lucide-react';
import { apiFetch } from '../utils/api.js';
import { resolveCustomerImageUrl } from '../utils/native-image-url.js';
import './PromotionShowcase.css';

const imageUrl = raw => {
  if (!raw) return '';
  try {
    return resolveCustomerImageUrl(raw,{
      nativeBuild:import.meta.env.MODE==='native',
      configuredOrigin:import.meta.env.VITE_NATIVE_API_ORIGIN
    });
  } catch { return ''; }
};
const isValid = item => item && typeof item.id==='string' &&
  typeof item.title==='string' && (item.status==='active' || !item.status);

export default function PromotionShowcase({stores=[],itemImages={},onChooseStore,onCampaignCount}) {
  const [campaigns,setCampaigns]=useState([]);
  const [active,setActive]=useState(0);
  const [offersOpen,setOffersOpen]=useState(false);
  const [popup,setPopup]=useState(null);
  const [error,setError]=useState(false);
  const [paused,setPaused]=useState(false);
  const touch=useRef(null);
  const reducedMotion=useRef(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const reload=useCallback(async()=>{
    try {
      const data=await apiFetch('/public/food-promotions',{cache:'no-store'});
      const list=Array.isArray(data?.campaigns)?data.campaigns.filter(isValid):[];
      setCampaigns(list);
      onCampaignCount?.(list.length);
      setActive(i=>list.length?Math.min(i,list.length-1):0);
      setError(false);
    } catch { setError(true); }
  },[onCampaignCount]);
  useEffect(()=>{
    void reload();
    const onFocus=()=>void reload();
    window.addEventListener('focus',onFocus);
    return ()=>window.removeEventListener('focus',onFocus);
  },[reload]);
  useEffect(()=>{
    if(!campaigns.length)return;
    const candidate=campaigns.find(c=>c.showPopup&&!sessionStorage.getItem('gastrofood_promo_seen_'+c.id));
    if(!candidate)return;
    const timeout=window.setTimeout(()=>{
      if(document.visibilityState==='visible'){
        sessionStorage.setItem('gastrofood_promo_seen_'+candidate.id,'1');
        setPopup(candidate);
      }
    },3500);
    return ()=>window.clearTimeout(timeout);
  },[campaigns]);
  useEffect(()=>{
    if(campaigns.length<2||paused||offersOpen||popup||reducedMotion.current)return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')setActive(i=>(i+1)%campaigns.length);
    },5800);
    return ()=>window.clearInterval(timer);
  },[campaigns.length,paused,offersOpen,popup]);
  const eventFor = (campaign,event) => {
    // Aggregate, anonymous analytics; never block ordering/navigation on errors.
    void apiFetch('/public/food-promotions/'+encodeURIComponent(campaign.id)+'/events',{
      method:'POST',body:JSON.stringify({event})
    }).catch(()=>{});
  };
  useEffect(()=>{
    const campaign=campaigns[active];
    if(!campaign||document.visibilityState!=='visible')return;
    const key='gastrofood_promo_view_'+campaign.id;
    try {
      if(sessionStorage.getItem(key))return;
      sessionStorage.setItem(key,'1');
    }catch{return;}
    eventFor(campaign,'impression');
  },[campaigns,active]);
  const select=delta=>setActive(i=>(i+delta+campaigns.length)%campaigns.length);
  const go=c=>{
    eventFor(c,'click');
    setOffersOpen(false);setPopup(null);
    const store=c.tenantId&&stores.find(s=>s.id===c.tenantId);
    if(store)onChooseStore(store);
    else if(c.tenantId) {
      // A temporarily unavailable tenant must not be selected through stale promo data.
      setOffersOpen(true);
    }else window.scrollTo({top:document.body.scrollHeight,behavior:reducedMotion.current?'instant':'smooth'});
  };
  const offer=c=><div className="gf-offer-preview" key={c.id}>
    <span className="gf-offer-creative"><Sparkles size={14}/> {c.offerLabel||'FROM GASTROFLOW FOOD'}</span>
    <strong>{c.title}</strong>
    <p>{c.subtitle||'Explore this promotion from your local food marketplace.'}</p>
    {c.coupon?.code&&<div className="gf-promo-coupon" aria-label="Restaurant checkout coupon"><span>Use code</span><strong>{c.coupon.code}</strong><small>{c.coupon.type==='percent'?c.coupon.value+'% off':'Rs. '+c.coupon.value+' off'}{c.coupon.minSpend>0?' · Min Rs. '+c.coupon.minSpend:''}</small></div>}
    {c.tenantId&&<span className="gf-offer-store"><Store size={14}/> {stores.find(s=>s.id===c.tenantId)?.name||'Participating restaurant'}</span>}
    <button type="button" onClick={()=>go(c)}>{c.cta||'Browse menu'} <ArrowRight size={17}/></button>
  </div>;
  return <section className="gf-promo-region" aria-label="GastroFlow promotions" onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false)}}>
    {campaigns.length>0?<>
      <div className="gf-promo-header"><span><Gift size={16}/> FEATURED OFFERS</span><button type="button" onClick={()=>setOffersOpen(true)}>All offers <ArrowRight size={15}/></button></div>
      <div className="gf-promo-slider" onTouchStart={e=>{touch.current=e.touches[0]?.clientX??null}} onTouchEnd={e=>{if(touch.current==null)return;const dx=e.changedTouches[0].clientX-touch.current;touch.current=null;if(Math.abs(dx)>45&&campaigns.length>1)select(dx>0?-1:1)}}>
        {campaigns.map((c,index)=><article key={c.id} className={'gf-promo-slide '+(index===active?'is-selected':'')} aria-hidden={index!==active} inert={index!==active?true:undefined}>
          <div className="gf-promo-copy">
            <span className="gf-promo-kicker"><Sparkles size={15}/> {c.offerLabel||'MADE FOR YOUR APPETITE'}</span>
            <h2>{c.title}</h2>
            <p>{c.subtitle||'Fresh offers from GastroFlow Food.'}</p>
            {c.coupon?.code&&<span className="gf-promo-code-badge">CODE: {c.coupon.code}</span>}
            <button type="button" onClick={()=>go(c)}>{c.cta||'View offer'} <ArrowRight size={18}/></button>
          </div>
          <div className="gf-promo-photo">
            {imageUrl(c.imageUrl||itemImages[c.tenantId])?<img src={imageUrl(c.imageUrl||itemImages[c.tenantId])} alt="" loading={index===0?'eager':'lazy'}/>:<span role="img" aria-label="">🍽️</span>}
          </div>
        </article>)}
        {campaigns.length>1&&<>
          <button type="button" className="gf-promo-arrow gf-promo-prev" onClick={()=>select(-1)} aria-label="Previous advertisement"><ChevronLeft size={20}/></button>
          <button type="button" className="gf-promo-arrow gf-promo-next" onClick={()=>select(1)} aria-label="Next advertisement"><ChevronRight size={20}/></button>
        </>}
      </div>
      {campaigns.length>1&&<div className="gf-promo-dots" role="group" aria-label="Choose advertisement">{campaigns.map((c,index)=><button type="button" key={c.id} aria-label={'Advertisement '+(index+1)} aria-current={index===active?'true':undefined} className={index===active?'is-active':''} onClick={()=>setActive(index)}/>)}</div>}
    </>:null}
    {offersOpen&&<div className="gf-promo-overlay" role="presentation" onClick={()=>setOffersOpen(false)}><section role="dialog" aria-modal="true" aria-label="Available offers" className="gf-promo-modal" onClick={e=>e.stopPropagation()}>
      <div className="gf-promo-modal-heading"><h2>Offers for you</h2><button type="button" onClick={()=>setOffersOpen(false)} aria-label="Close offers"><X/></button></div>
      <p>Offers are advertised by participating restaurants. Final prices and eligibility are confirmed at checkout.</p>
      <div className="gf-promo-offers">{campaigns.map(offer)}</div>
    </section></div>}
    {popup&&<div className="gf-promo-overlay" role="presentation" onClick={()=>setPopup(null)}><section role="dialog" aria-modal="true" aria-label="Special GastroFlow offer" className="gf-promo-modal gf-promo-pop" onClick={e=>e.stopPropagation()}>
      <div className="gf-promo-modal-heading"><h2>Something special</h2><button type="button" onClick={()=>setPopup(null)} aria-label="Dismiss offer"><X/></button></div>
      {offer(popup)}
      <button type="button" className="gf-promo-later" onClick={()=>setPopup(null)}>Maybe later</button>
    </section></div>}
  </section>;
}

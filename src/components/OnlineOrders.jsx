import React,{useEffect,useMemo,useState} from 'react';
import {usePOS} from '../context/POSContext';
import {formatRestaurantTime,restaurantTimeZone} from '../utils/restaurant-time';
import {ShoppingBag,Clock3,CheckCircle2,XCircle,Truck,CalendarDays,RefreshCw,Search,Filter,ChefHat,Receipt,ArrowUpRight} from 'lucide-react';
import './online-orders.css';

const FILTERS=[['all','All online'],['pending','New'],['preparing','Preparing'],['ready','Ready'],['completed','Completed'],['cancelled','Cancelled']];
const terminal=new Set(['completed','delivered','cancelled','rejected','refunded','partially_refunded']);
const money=value=>'Rs. '+Number(value||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const itemList=items=>{try{return Array.isArray(items)?items:JSON.parse(items||'[]')}catch{return []}};
const state=order=>String(order.status||'pending').toLowerCase();
const isScheduled=order=>Number(order.scheduledTime)>0;

export default function OnlineOrders(){
  const {orders,settings,currentUser,refreshOrders,acceptOnlineOrder,rejectOnlineOrder,updateOrderEta,showToast,setActiveTab}=usePOS();
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[busy,setBusy]=useState(null),[minutes,setMinutes]=useState({}),[time,setTime]=useState(Date.now());
  const timezone=restaurantTimeZone(settings);
  const online=useMemo(()=>orders.filter(o=>o.source==='online').sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0)),[orders]);
  const visible=useMemo(()=>online.filter(o=>{
    const s=state(o);
    const match=filter==='all'||(filter==='cancelled'?['cancelled','rejected','refunded','partially_refunded'].includes(s):filter==='completed'?['completed','delivered'].includes(s):s===filter);
    const text=[o.id,o.customerName,o.customerPhone,o.orderType,o.diningType].filter(Boolean).join(' ').toLowerCase();
    return match&&text.includes(search.toLowerCase().trim());
  }),[online,filter,search]);
  const stats=useMemo(()=>({
    all:online.length,
    pending:online.filter(o=>state(o)==='pending').length,
    preparing:online.filter(o=>state(o)==='preparing').length,
    ready:online.filter(o=>state(o)==='ready'||state(o)==='out_for_delivery').length,
    completed:online.filter(o=>['completed','delivered'].includes(state(o))).length,
    cancelled:online.filter(o=>['cancelled','rejected','refunded','partially_refunded'].includes(state(o))).length
  }),[online]);
  useEffect(()=>{const timer=setInterval(()=>setTime(Date.now()),15000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{const timer=setInterval(()=>refreshOrders().catch(()=>{}),20000);return()=>clearInterval(timer)},[refreshOrders]);
  const perform=async(id,action)=>{
    const order=online.find(o=>o.id===id);
    if(!order)return;
    let reason='';
    if(action==='reject'){
      reason=window.prompt('Reason for rejecting this order (shown to the customer):','Kitchen cannot prepare this order at this time.');
      if(reason===null)return;
      if(reason.trim().length<8)return showToast('Enter a specific rejection reason.','error');
      if(!window.confirm('Reject this customer order?'))return;
    }
    const eta=Number(minutes[id]||order.etaMinutes||25);
    if(!Number.isFinite(eta)||eta<5||eta>240)return showToast('Preparation estimate must be 5–240 minutes.','error');
    setBusy(id);
    try{
      if(action==='accept')await acceptOnlineOrder(id,eta);
      if(action==='reject')await rejectOnlineOrder(id,reason.trim());
      if(action==='eta')await updateOrderEta(id,eta);
      showToast(action==='reject'?'Online order rejected.':action==='accept'?'Order accepted and kitchen notified.':'Preparation estimate updated.','success');
      await refreshOrders();
    }catch(err){showToast(err.message||'Could not update order. Please retry.','error')}
    finally{setBusy(null)}
  };
  return <main className="view-body online-orders-page">
    <header className="online-orders-heading"><div><p className="online-orders-eyebrow"><ShoppingBag size={15}/> CUSTOMER ORDERING</p><h1>Online Orders</h1><p>Manage customer orders separately from walk-in POS sales. Kitchen and dispatch remain connected.</p></div>
      <div className="online-orders-header-actions"><button type="button" className="online-orders-outline" onClick={()=>refreshOrders()}><RefreshCw size={16}/> Refresh</button>
        {['owner','manager'].includes(currentUser?.role)&&<button type="button" className="online-orders-primary" onClick={()=>setActiveTab('settings')}><ArrowUpRight size={17}/> Online store settings</button>}</div>
    </header>
    <div className="online-orders-stats"><article><ShoppingBag size={19}/><small>Online orders</small><strong>{stats.all}</strong></article><article><Clock3 size={19}/><small>Awaiting action</small><strong>{stats.pending}</strong></article><article><ChefHat size={19}/><small>Preparing</small><strong>{stats.preparing}</strong></article><article><CheckCircle2 size={19}/><small>Ready</small><strong>{stats.ready}</strong></article></div>
    <div className="online-orders-tools"><div className="online-orders-filter">{FILTERS.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)} className={filter===key?'selected':''}>{label} <span>{stats[key]}</span></button>)}</div>
      <label className="online-orders-search"><Search size={17}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer, phone or order ID" aria-label="Search online orders"/></label>
    </div>
    <div className="online-orders-grid">
      {visible.map(o=>{
        const s=state(o),pending=s==='pending',active=!terminal.has(s);
        const minutesUntil=isScheduled(o)?Math.round((Number(o.scheduledTime)-time)/60000):null;
        return <article className="online-order-card" key={o.id}>
          <div className="online-order-top"><div><small>#{String(o.id).slice(-9).toUpperCase()}</small><h2>{o.customerName||'Online customer'}</h2><p>{o.customerPhone||'No phone provided'}</p></div><span className={'online-order-status online-order-'+s}>{s.replaceAll('_',' ')}</span></div>
          <div className="online-order-tags"><span><ShoppingBag size={14}/>{o.orderType||o.diningType||'takeaway'}</span><span><Clock3 size={14}/>{formatRestaurantTime(o.timestamp,timezone)}</span>
          {isScheduled(o)&&<span className="online-order-scheduled"><CalendarDays size={14}/>{formatRestaurantTime(Number(o.scheduledTime),timezone)} {minutesUntil!=null&&minutesUntil>0?' · in '+minutesUntil+'m':''}</span>}</div>
          {o.deliveryAddress&&<p className="online-order-address"><Truck size={15}/> {o.deliveryAddress}</p>}
          <div className="online-order-items">{itemList(o.items).slice(0,8).map((item,i)=><div key={item.id||i}><span>{Number(item.quantity||item.qty||1)} × {item.name||item.itemName||'Menu item'}</span><strong>{money(Number(item.unitPrice??item.price??0)*Number(item.quantity||item.qty||1))}</strong></div>)}</div>
          <div className="online-order-total"><span>{o.paymentMethod==='bank_transfer'&&o.paymentStatus!=='paid'?'Bank transfer · unverified':o.paymentMethod==='cash'?'Cash · pay on collection':o.paymentStatus==='paid'?'Payment confirmed':String(o.paymentMethod||'Payment pending').replaceAll('_',' ')}</span><strong>{money(o.total)}</strong></div>
          {active&&<div className="online-order-actions">
            <label>Kitchen estimate <select aria-label={'Estimated preparation minutes for '+o.id} value={minutes[o.id]||o.etaMinutes||25} onChange={e=>setMinutes(prev=>({...prev,[o.id]:e.target.value}))}><option value="15">15 min</option><option value="20">20 min</option><option value="25">25 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option></select></label>
            {pending&&<button className="online-orders-primary" disabled={busy===o.id} onClick={()=>perform(o.id,'accept')}><CheckCircle2 size={16}/> Accept order</button>}
            {pending&&<button className="online-orders-outline danger" disabled={busy===o.id} onClick={()=>perform(o.id,'reject')}><XCircle size={16}/> Reject</button>}
            {!pending&&<button className="online-orders-outline" disabled={busy===o.id} onClick={()=>perform(o.id,'eta')}><Clock3 size={16}/> Update ETA</button>}
            <button className="online-orders-outline" onClick={()=>setActiveTab('kds')}><ChefHat size={16}/> Kitchen</button>
            {o.orderType==='delivery'&&<button className="online-orders-outline" onClick={()=>setActiveTab('delivery')}><Truck size={16}/> Dispatch</button>}
          </div>}
        </article>;
      })}
      {!visible.length&&<div className="online-orders-empty"><Receipt size={34}/><h2>No matching online orders</h2><p>New customer orders will appear here automatically after they are submitted.</p><button className="online-orders-outline" onClick={()=>{setFilter('all');setSearch('')}}>Show all online orders</button></div>}
    </div>
  </main>;
}

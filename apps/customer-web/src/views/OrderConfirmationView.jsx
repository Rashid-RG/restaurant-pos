import React,{useEffect,useState} from 'react';
import {CheckCircle2,ReceiptText,MapPin,Package,ArrowRight,Store,Wallet} from 'lucide-react';
import {apiFetch} from '../utils/api.js';
import './OrderConfirmationView.css';

// Remain here after the server acknowledges an order. No auto-redirect or
// payment assumptions: the details shown below come from the tracked order.
export default function OrderConfirmationView({orderId,onTrack,onBrowse}){
  const [order,setOrder]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!orderId){setOrder(null);setLoading(false);setError('No confirmed order reference was provided.');return;}
    let live=true;
    setOrder(null);setLoading(true);setError('');
    apiFetch(`/public/orders/${encodeURIComponent(orderId)}`,{cache:'no-store'})
      .then(data=>{if(live){setOrder(data);setError('');}})
      .catch(err=>{if(live)setError(err?.message||'Order details are temporarily unavailable.');})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[orderId]);
  const status=String(order?.status||'').toLowerCase();
  const closed=['cancelled','rejected','refunded','partially_refunded'].includes(status);
  const payment=String(order?.paymentStatus||'').toLowerCase();
  const paymentLabel=payment==='paid'?'Payment confirmed':
    order?.paymentMethod==='bank_transfer'?'Bank transfer awaiting verification':
    order?.paymentMethod==='cash'?'Pay at handover / collection':
    payment==='pending'?'Payment pending':'Payment status: '+(payment||'not confirmed');
  return <main className="gf-order-confirmation" aria-label="Order confirmation">
    <section className="gf-order-confirmation-hero">
      <span className="gf-order-confirmation-mark" aria-hidden="true"><CheckCircle2 size={35}/></span>
      <span className="gf-order-confirmation-eyebrow">{closed?'ORDER UPDATE':'ORDER RECEIVED'}</span>
      <h1>{closed?'Check your order status':'Your order is in!'}</h1>
      <p>{closed?'The restaurant has updated this order. Open tracking for details.':'The restaurant has received your request. Keep this screen open or track its progress whenever you like.'}</p>
      <div className="gf-order-confirmation-reference"><span>ORDER REFERENCE</span><strong>{orderId||'Unavailable'}</strong></div>
    </section>
    {loading?<section className="gf-order-confirmation-panel" role="status">Loading your confirmed receipt…</section>:
      error?<section className="gf-order-confirmation-panel" role="status">
        <strong>Order details could not be loaded.</strong><p>{error}</p><p>Your order reference is saved in the page address. Check order tracking before trying to place another order.</p>
      </section>:
      <section className="gf-order-confirmation-panel" aria-label="Order summary">
        <header><ReceiptText size={20}/><h2>Order summary</h2></header>
        {order?.storeName||order?.restaurantName?<div className="gf-order-confirmation-line"><Store size={17}/><span>{order.storeName||order.restaurantName}</span></div>:null}
        <div className="gf-order-confirmation-line"><Package size={17}/><span>{String(order?.orderType||order?.diningType||'Order').replaceAll('_',' ')} · {String(order?.status||'Received').replaceAll('_',' ')}</span></div>
        {order?.deliveryAddress&&<div className="gf-order-confirmation-line"><MapPin size={17}/><span>{order.deliveryAddress}</span></div>}
        {Array.isArray(order?.items)&&order.items.length>0&&<div className="gf-order-confirmation-items">
          {order.items.map((item,i)=><div key={i}><span>{item.name||'Menu item'} × {Number(item.quantity||1)}</span>
            {Number.isFinite(Number(item.price))&&<strong>Rs. {(Number(item.price)*Number(item.quantity||1)).toFixed(2)}</strong>}</div>)}
        </div>}
        {Number.isFinite(Number(order?.total))&&order?.total!=null&&<div className="gf-order-confirmation-total"><span>Total payable</span><strong>Rs. {Number(order.total).toFixed(2)}</strong></div>}
        <div className="gf-order-confirmation-line gf-order-confirmation-payment"><Wallet size={17}/><span>{paymentLabel}</span></div>
      </section>}
    <div className="gf-order-confirmation-actions">
      <button type="button" onClick={onTrack} disabled={!orderId} className="gf-order-confirmation-track">Track my order <ArrowRight size={18}/></button>
      <button type="button" className="gf-order-confirmation-browse" onClick={onBrowse}>Back to restaurants</button>
    </div>
    <p className="gf-order-confirmation-footnote">This confirmation stays available until you choose where to go. Payment is only confirmed when the server reports it as paid.</p>
  </main>;
}

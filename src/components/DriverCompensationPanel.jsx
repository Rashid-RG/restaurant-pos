import React,{useCallback,useEffect,useMemo,useState} from 'react';
import './DriverCompensationPanel.css';

const money=cents=>`Rs. ${(cents/100).toFixed(2)}`;
/** Manager-only explicit earnings approval: never infer compensation from COD or fees. */
export default function DriverCompensationPanel({orders=[]}){
  const [approved,setApproved]=useState([]);
  const [selectedOrder,setSelectedOrder]=useState('');
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [info,setInfo]=useState('');
  const completed=useMemo(()=>orders.filter(o=>o.status==='delivered'&&o.driverId&&
    (o.diningType==='delivery'||o.orderType==='delivery')).slice(0,100),[orders]);
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    try{
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch('/api/delivery/driver-compensation',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Compensation records unavailable');
      setApproved(Array.isArray(result.entries)?result.entries:[]);
    }catch(e){setError(e.message||'Could not load compensation records.');}
    finally{setBusy(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const approve=async(event)=>{
    event.preventDefault();
    const normalized=amount.trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(normalized)){
      setError('Enter a valid rupee amount with up to two decimal places.');return;
    }
    const cents=Math.round(Number(normalized)*100);
    if(!Number.isSafeInteger(cents)||cents<0||cents>10000000){
      setError('Compensation must be from Rs. 0 to Rs. 100,000.');return;
    }
    setBusy(true);setError('');setInfo('');
    try{
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch('/api/delivery/driver-compensation',{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({orderId:selectedOrder,amountCents:cents})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not approve earnings.');
      setSelectedOrder('');setAmount('');setInfo('Earnings approved and added to this rider’s ledger. No payment has been sent.');
      await load();
    }catch(e){setError(e.message||'Could not save compensation.');}
    finally{setBusy(false);}
  };
  const recorded=new Set(approved.map(e=>e.orderId));
  return <section className="driver-compensation-panel" aria-label="Rider approved earnings">
    <div className="driver-compensation-panel-heading">
      <div><h3>Rider earnings approval</h3><p>Record compensation separately from delivery fees and customer cash. These entries are not payouts.</p></div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={load}>{busy?'Loading…':'Refresh earnings'}</button>
    </div>
    <form onSubmit={approve}>
      <label htmlFor="driver-earnings-order">Delivered order</label>
      <select id="driver-earnings-order" required value={selectedOrder} onChange={e=>setSelectedOrder(e.target.value)}>
        <option value="">Select a completed rider delivery</option>
        {completed.filter(o=>!recorded.has(o.id)).map(o=><option value={o.id} key={o.id}>#{String(o.id).slice(-8)} · Rider {String(o.driverId).slice(-6)}</option>)}
      </select>
      <label htmlFor="driver-earnings-amount">Approved rider compensation (LKR)</label>
      <input id="driver-earnings-amount" required inputMode="decimal" value={amount}
        onChange={e=>setAmount(e.target.value)} placeholder="e.g. 250.00" maxLength={12}/>
      <button type="submit" className="btn btn-primary" disabled={busy||!selectedOrder}>{busy?'Saving…':'Approve delivery earnings'}</button>
    </form>
    {error&&<p className="driver-compensation-error" role="alert">{error}</p>}
    {info&&<p className="driver-compensation-success" role="status">{info}</p>}
    <div className="driver-compensation-records">
      <strong>Approved records ({approved.length} most recent)</strong>
      {approved.length?<ul>{approved.slice(0,20).map(entry=><li key={entry.orderId}>
        <span>Order #{String(entry.orderId).slice(-8)} · Rider {entry.driverName||String(entry.driverId).slice(-6)}</span>
        <strong>{money(Number(entry.amountCents))}</strong>
      </li>)}</ul>:<p>No approved compensation recorded for this restaurant.</p>}
    </div>
    <p className="driver-compensation-footnote">The manager records an actual agreed amount per completed order. Payroll transfers, tips allocation and payout confirmation need a separate verified accounting workflow.</p>
  </section>;
}

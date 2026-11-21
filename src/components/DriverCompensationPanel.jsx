import React,{useCallback,useEffect,useMemo,useState} from 'react';
import './DriverCompensationPanel.css';

const money=cents=>`Rs. ${(cents/100).toFixed(2)}`;
/** Manager-only explicit earnings approval: never infer compensation from COD or fees. */
export default function DriverCompensationPanel({orders=[]}){
  const [approved,setApproved]=useState([]);
  const [payouts,setPayouts]=useState([]);
  const [payoutDriver,setPayoutDriver]=useState('');
  const [payoutOrderIds,setPayoutOrderIds]=useState([]);
  const [payoutMethod,setPayoutMethod]=useState('bank_transfer');
  const [payoutReference,setPayoutReference]=useState('');
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
      const payResponse=await fetch('/api/delivery/driver-compensation/payouts',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const payData=await payResponse.json();
      if(!payResponse.ok)throw new Error(payData.error||'Could not load payout records.');
      setPayouts(Array.isArray(payData.payouts)?payData.payouts:[]);
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
  const recordPayout=async(event)=>{
    event.preventDefault();
    const count=payoutOrderIds.length;
    if(!payoutDriver||!count||count>100||payoutReference.trim().length<6){
      setError('Select a rider and approved unpaid deliveries, then enter the external payment reference.');return;
    }
    if(!window.confirm('Confirm that you have ALREADY paid this rider outside GastroFlow. This records a payment; it does not transfer money.'))return;
    setBusy(true);setError('');setInfo('');
    try{
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch('/api/delivery/driver-compensation/payouts',{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({driverId:payoutDriver,orderIds:payoutOrderIds,method:payoutMethod,paymentReference:payoutReference.trim()})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not record this external payment.');
      setPayoutOrderIds([]);setPayoutReference('');
      setInfo('External payment record saved. GastroFlow did not move money or verify a bank transfer.');
      await load();
    }catch(e){setError(e.message||'Could not record payout. Refresh before retrying.');}
    finally{setBusy(false);}
  };
  const recorded=new Set(approved.map(e=>e.orderId));
  const unpaid=approved.filter(e=>!e.payoutId&&Number(e.amountCents)>0);
  const payoutDrivers=[...new Set(unpaid.map(e=>e.driverId))];
  const eligiblePayouts=unpaid.filter(e=>e.driverId===payoutDriver);
  const selectedPayoutAmount=eligiblePayouts.filter(e=>payoutOrderIds.includes(e.orderId))
    .reduce((sum,e)=>sum+Number(e.amountCents),0);
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
        <strong>{money(Number(entry.amountCents))} · {entry.payoutId?'Recorded paid':'Unpaid'}</strong>
      </li>)}</ul>:<p>No approved compensation recorded for this restaurant.</p>}
    </div>
    <section className="driver-compensation-payout" aria-label="Record external rider payout">
      <h4>Record external rider payment</h4>
      <p>Use this form only after paying a rider by cash, bank transfer or another external method. GastroFlow records your declaration; it does not initiate payment or verify the receipt.</p>
      <form onSubmit={recordPayout}>
        <label htmlFor="driver-payout-rider">Rider with outstanding earnings</label>
        <select id="driver-payout-rider" value={payoutDriver} onChange={e=>{setPayoutDriver(e.target.value);setPayoutOrderIds([]);}}>
          <option value="">Select a rider</option>
          {payoutDrivers.map(id=><option key={id} value={id}>{unpaid.find(e=>e.driverId===id)?.driverName||id}</option>)}
        </select>
        {payoutDriver && <fieldset className="driver-payout-orders"><legend>Choose approved, unpaid deliveries</legend>
          {eligiblePayouts.map(entry=><label key={entry.orderId}>
            <input type="checkbox" checked={payoutOrderIds.includes(entry.orderId)}
              onChange={e=>setPayoutOrderIds(previous=>e.target.checked
                ? [...previous,entry.orderId].slice(0,100)
                : previous.filter(id=>id!==entry.orderId))}/>
            <span>#{String(entry.orderId).slice(-8)} · {money(Number(entry.amountCents))}</span>
          </label>)}
        </fieldset>}
        <p className="driver-payout-total">Selected external payment: <strong>{money(selectedPayoutAmount)}</strong></p>
        <label htmlFor="driver-payout-method">External payment method</label>
        <select id="driver-payout-method" value={payoutMethod} onChange={e=>setPayoutMethod(e.target.value)}>
          <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="other">Other verified method</option>
        </select>
        <label htmlFor="driver-payout-reference">Receipt or transaction reference</label>
        <input id="driver-payout-reference" value={payoutReference} maxLength={140} required minLength={6}
          onChange={e=>setPayoutReference(e.target.value)} placeholder="External receipt/reference number"/>
        <button className="btn btn-primary" type="submit" disabled={busy||!payoutOrderIds.length||payoutReference.trim().length<6}>Record payment already made</button>
      </form>
      <h4>Recent payment records</h4>
      {payouts.length?<ul>{payouts.slice(0,12).map(p=><li key={p.id}>{money(Number(p.amountCents))} · {p.method.replace('_',' ')} · {p.paymentReference}</li>)}</ul>:<p>No external payouts recorded for this restaurant.</p>}
    </section>
    <p className="driver-compensation-footnote">Approved earnings are separate from COD cash and restaurant delivery fees. Payouts are management-attested records of external payments, not independently bank-verified transfers. Do not record a payment until it is completed.</p>
  </section>;
}

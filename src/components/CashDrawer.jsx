import React, {useCallback,useEffect,useState} from 'react';
import {Banknote,CalendarDays,CheckCircle2,Clock3,Coins,LockKeyhole,Plus,RefreshCw,Receipt,ShieldCheck,Wallet,ArrowDownLeft,ArrowUpRight} from 'lucide-react';
import {usePOS} from '../context/POSContext';
import {dateAtRestaurant,formatRestaurantTime,restaurantTimeZone} from '../utils/restaurant-time';
import './cash-drawer.css';

async function requestJson(path, options={}) {
  const result=await fetch(path,{...options,headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`,'Content-Type':'application/json',...options.headers}});
  const data=await result.json().catch(()=>({}));
  if(!result.ok)throw new Error(data.error || 'Unable to update cash drawer.');
  return data;
}
export default function CashDrawer(){
  const {currentUser,settings,showToast}=usePOS();
  const zone=restaurantTimeZone(settings),currency=settings?.currencySymbol || 'Rs.';
  const [date,setDate]=useState(()=>dateAtRestaurant(Date.now(),zone));
  const [report,setReport]=useState({shifts:[],totals:{}});
  const [active,setActive]=useState(null);
  const [opening,setOpening]=useState('');
  const [counted,setCounted]=useState('');
  const [notes,setNotes]=useState('');
  const [moveType,setMoveType]=useState('cash_out');
  const [moveAmount,setMoveAmount]=useState('');
  const [reason,setReason]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [showClose,setShowClose]=useState(false);
  const [showMovement,setShowMovement]=useState(false);
  const money=v=>currency+' '+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const [day,shift]=await Promise.all([requestJson('/api/workday/drawer?date='+encodeURIComponent(date)),requestJson('/api/shifts/active')]);
      setReport(day);setActive(shift);setError('');
    }catch(e){setError(e.message)}finally{setLoading(false)}
  },[date]);
  useEffect(()=>{refresh()},[refresh]);

  const post=async(path,body,onSuccess)=>{
    setBusy(true);setError('');
    try{await requestJson(path,{method:'POST',body:JSON.stringify(body)});onSuccess?.();await refresh();}
    catch(e){setError(e.message);showToast(e.message,'error')}
    finally{setBusy(false)}
  };
  const open=async e=>{
    e.preventDefault();
    if(!Number.isFinite(Number(opening))||Number(opening)<0||opening==='')return setError('Enter the counted opening cash amount.');
    await post('/api/shifts/open',{startFloat:Number(opening),notes:notes.trim()},()=>{setOpening('');setNotes('');showToast('Drawer opened and opening float saved.','success')});
  };
  const close=async e=>{
    e.preventDefault();
    if(counted===''||!Number.isFinite(Number(counted))||Number(counted)<0)return setError('Enter the cash counted in the physical drawer.');
    if(!window.confirm('Confirm this cash count and close your shift? The recorded close cannot be reopened from this screen.'))return;
    await post('/api/shifts/close',{actualCash:Number(counted),notes:notes.trim()},()=>{setShowClose(false);setCounted('');setNotes('');showToast('Shift closed and reconciliation saved.','success')});
  };
  const movement=async e=>{
    e.preventDefault();
    if(!active)return setError('Open a drawer before recording a movement.');
    if(!(Number(moveAmount)>0)||!reason.trim())return setError('Enter a positive amount and reason.');
    await post('/api/cash-movements',{type:moveType,amount:Number(moveAmount),reason:reason.trim()},()=>{setShowMovement(false);setMoveAmount('');setReason('');showToast('Cash movement saved.','success')});
  };
  const today=dateAtRestaurant(Date.now(),zone);
  const activeRow=report.shifts.find(s=>s.id===active?.id);
  const metrics=report.totals||{};
  return <main className="view-body cashdesk-view">
    <header className="cashdesk-heading">
      <div><p className="cashdesk-eyebrow"><Banknote size={17}/> DAILY CASH CONTROL</p><h1>Cash Drawer</h1><p>Opening float, cash sales, withdrawals and end-of-shift balancing — all in one place.</p></div>
      <div className="cashdesk-date"><label><CalendarDays size={16}/> Reporting day<input aria-label="Drawer reporting date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="cashdesk-outline" onClick={refresh} disabled={loading||busy}><RefreshCw size={16}/> Refresh</button></div>
    </header>
    {error&&<p role="alert" className="cashdesk-error">{error}</p>}
    <div className="cashdesk-kpis">
      <article><span><Receipt size={19}/> Daily paid sales</span><strong>{money(report.paidSales)}</strong><small className="cashdesk-kpi-caption">{report.paidOrders || 0} paid orders on selected day</small></article>
      <article><span><Wallet size={19}/> Opening cash</span><strong>{money(metrics.opening)}</strong></article>
      <article><span><Banknote size={19}/> Cash receipts</span><strong>{money(metrics.cashSales)}</strong></article>
      <article><span><Receipt size={19}/> Non-cash receipts</span><strong>{money(metrics.nonCashReceipts)}</strong></article>
      <article className="cashdesk-important"><span><Coins size={19}/> Expected drawer balance</span><strong>{money(metrics.expectedCash)}</strong></article>
    </div>
    <div className="cashdesk-columns">
      <section className="cashdesk-card">
        <div className="cashdesk-sectionheading"><div className="cashdesk-sectionicon"><LockKeyhole size={22}/></div><div><h2>{active?'Your drawer is open':'Start your workday'}</h2><p>{active?'Opening cash is recorded. Keep track of money going in and out.':'Count the cash already in your drawer before your first sale.'}</p></div></div>
        {active ? <>
          <div className="cashdesk-state"><span className="cashdesk-pulse"/> OPEN SHIFT <small>{formatRestaurantTime(active.startTime,zone)}</small></div>
          <div className="cashdesk-bigamount"><small>Your opening float</small><strong>{money(active.startFloat)}</strong></div>
          <div className="cashdesk-buttons"><button className="cashdesk-primary" onClick={()=>{setShowMovement(s=>!s);setShowClose(false)}}><Plus size={17}/> Record cash movement</button><button className="cashdesk-outline" onClick={()=>{setShowClose(s=>!s);setShowMovement(false)}}><CheckCircle2 size={17}/> Close & reconcile</button></div>
          {showMovement&&<form onSubmit={movement} className="cashdesk-form cashdesk-subform"><h3>Cash in / cash out</h3><label>Movement type<select value={moveType} onChange={e=>setMoveType(e.target.value)}><option value="cash_out">Cash taken out</option><option value="cash_in">Cash added</option></select></label><label>Amount ({currency})<input type="number" min="0.01" step="0.01" value={moveAmount} onChange={e=>setMoveAmount(e.target.value)} required/></label><label>Reason<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Supplier payment or added change" maxLength={300} required/></label><button className="cashdesk-primary" disabled={busy}>Save cash movement</button></form>}
          {showClose&&<form onSubmit={close} className="cashdesk-form cashdesk-subform"><h3>End-of-shift count</h3><p>Count the physical money and enter the amount. The difference is calculated from recorded shift transactions.</p><label>Actual drawer cash ({currency})<input type="number" min="0" step="0.01" value={counted} onChange={e=>setCounted(e.target.value)} required autoFocus/></label><label>Closing note (optional)<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes about shortages or cash handover"/></label><button className="cashdesk-primary cashdesk-close" disabled={busy}><CheckCircle2 size={17}/> Confirm & close drawer</button></form>}
        </> : <form className="cashdesk-form" onSubmit={open}>
          <label>Opening cash amount ({currency})<input type="number" min="0" step="0.01" placeholder="e.g. 5000.00" value={opening} onChange={e=>setOpening(e.target.value)} required/></label>
          <label>Opening note (optional)<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Initial change float for today's shift"/></label>
          <button className="cashdesk-primary" disabled={loading||busy}><LockKeyhole size={18}/> Open cash drawer shift</button>
        </form>}
        <p className="cashdesk-help"><ShieldCheck size={16}/> Each opening and closing amount is stored against your staff account. The drawer is separate from employee attendance.</p>
      </section>
      <section className="cashdesk-card">
        <div className="cashdesk-sectionheading"><div className="cashdesk-sectionicon"><Receipt size={22}/></div><div><h2>Daily reconciliation</h2><p>Shift-based drawer totals for {date} ({zone}).</p></div></div>
        <div className="cashdesk-breakdown">
          <div><span>Opening cash</span><strong>{money(metrics.opening)}</strong></div>
          <div><span>Cash receipts</span><strong>{money(metrics.cashSales)}</strong></div>
          <div><span>Cash refunds</span><strong>− {money(metrics.cashRefunds)}</strong></div>
          <div><span>Cash in / out (net)</span><strong>{money(metrics.cashMovements)}</strong></div>
          <div className="cashdesk-breakdown-total"><span>Expected cash</span><strong>{money(metrics.expectedCash)}</strong></div>
          <div><span>Counted cash ({metrics.countedShifts||0} closed shifts)</span><strong>{money(metrics.countedCash)}</strong></div>
        </div>
        <p className="cashdesk-help"><Clock3 size={16}/> The expected amount for an open shift is a live estimate. A closed shift uses the reconciled amount saved when it was closed.</p>
      </section>
    </div>
    <section className="cashdesk-card">
      <div className="cashdesk-sectionheading"><div className="cashdesk-sectionicon"><Receipt size={22}/></div><div><h2>Shift history</h2><p>{report.shifts.length} drawer shifts started on this reporting day</p></div></div>
      <div className="cashdesk-tablewrap"><table><thead><tr><th>Cashier</th><th>Started</th><th>Opening</th><th>Cash sales</th><th>Expected</th><th>Counted</th><th>Difference</th><th>Status</th></tr></thead><tbody>{report.shifts.map(row=><tr key={row.id}>
        <td><strong>{row.cashier}</strong></td><td>{formatRestaurantTime(row.startTime,zone)}</td><td>{money(row.opening)}</td><td>{money(row.cashSales)}</td><td>{money(row.expectedCash)}</td><td>{row.actualCash===null?'—':money(row.actualCash)}</td><td className={row.difference<0?'cashdesk-negative':row.difference>0?'cashdesk-positive':''}>{row.difference===null?'—':money(row.difference)}</td><td><span className={`cashdesk-status ${row.status==='open'?'open':'closed'}`}>{row.status}</span></td>
      </tr>)}</tbody></table>{!report.shifts.length&&<p className="cashdesk-empty">{loading?'Loading drawer shifts…':'No drawer shifts started on this day.'}</p>}</div>
      <p className="cashdesk-help">{report.note || 'These figures cover drawer-linked cashier transactions, not every restaurant payment.'}</p>
    </section>
  </main>;
}

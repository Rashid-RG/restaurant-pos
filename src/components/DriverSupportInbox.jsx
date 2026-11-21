import React,{useCallback,useEffect,useState} from 'react';
import './DriverSupportInbox.css';

/**
 * Restaurant-owned rider support inbox. The API uses the signed-in staff JWT
 * to determine the tenant. The UI never supplies a restaurant identifier.
 */
export default function DriverSupportInbox(){
  const [requests,setRequests]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState(null);
  const [status,setStatus]=useState('in_progress');
  const [reply,setReply]=useState('');
  const [saving,setSaving]=useState(false);
  const [filter,setFilter]=useState('open');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch('/api/delivery/driver-support',{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not retrieve rider support.');
      setRequests(Array.isArray(data.requests)?data.requests:[]);
    }catch(e){setError(e.message||'Support inbox is unavailable.');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  const selectRequest=(request)=>{
    setSelected(request.id);setStatus(request.status||'open');
    setReply(request.managerReply||'');
  };

  const save=async(event)=>{
    event.preventDefault();
    if(!selected||saving)return;
    setSaving(true);setError('');
    try{
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch(`/api/delivery/driver-support/${encodeURIComponent(selected)}`,{
        method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({status,reply:reply.trim()})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not save review.');
      setSelected(null);setReply('');
      await load();
    }catch(e){setError(e.message||'Could not update the request.');}
    finally{setSaving(false);}
  };

  const visible=filter==='all'?requests:requests.filter(r=>r.status===filter);
  return <section className="driver-support-inbox" aria-label="Rider support inbox">
    <div className="driver-support-inbox-heading">
      <div><h3>Rider Support Center</h3><p>Review requests submitted by drivers registered to this restaurant.</p></div>
      <button type="button" className="btn btn-outline" onClick={load} disabled={loading||saving}>{loading?'Loading…':'Refresh requests'}</button>
    </div>
    <div className="driver-support-filters" role="group" aria-label="Filter rider support requests">
      {['open','in_progress','resolved','all'].map(value=>
        <button type="button" key={value} className={filter===value?'btn btn-primary':'btn btn-outline'}
          onClick={()=>setFilter(value)} aria-pressed={filter===value}>
          {value==='all'?'All':value.replace('_',' ')}
          <span>{value==='all'?requests.length:requests.filter(r=>r.status===value).length}</span>
        </button>)}
    </div>
    {error&&<p role="alert" className="driver-support-inbox-error">{error}</p>}
    {!loading&&!visible.length&&<p className="driver-support-inbox-empty">No requests in this view.</p>}
    <div className="driver-support-inbox-list">
      {visible.map(request=><article key={request.id} className="driver-support-ticket">
        <div className="driver-support-ticket-top">
          <strong>{request.driverName||'Registered rider'} · {String(request.category||'other').replace('_',' ')}</strong>
          <span>{String(request.status||'open').replace('_',' ')}</span>
        </div>
        <small>{new Date(request.createdAt).toLocaleString()}{request.orderId?` · Order ${request.orderId}`:''}</small>
        <p>{request.message}</p>
        {request.managerReply&&<blockquote><b>Manager reply:</b> {request.managerReply}</blockquote>}
        <button type="button" className="btn btn-outline" onClick={()=>selectRequest(request)}>
          {selected===request.id?'Editing this request':'Review request'}
        </button>
        {selected===request.id&&<form className="driver-support-review" onSubmit={save}>
          <label htmlFor="driver-support-review-status">Review status</label>
          <select id="driver-support-review-status" value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option>
          </select>
          <label htmlFor="driver-support-review-reply">Response to rider</label>
          <textarea id="driver-support-review-reply" value={reply} maxLength={1000} rows={3}
            onChange={e=>setReply(e.target.value)} placeholder="Explain the action taken or what the rider should do next."/>
          <div className="driver-support-review-actions">
            <button type="submit" className="btn btn-primary" disabled={saving||(status==='resolved'&&reply.trim().length<5)}>{saving?'Saving…':'Save response'}</button>
            <button type="button" className="btn btn-outline" disabled={saving} onClick={()=>setSelected(null)}>Cancel</button>
          </div>
        </form>}
      </article>)}
    </div>
    <p className="driver-support-inbox-footnote">This inbox is not an emergency dispatch service. For urgent danger, use emergency channels.</p>
  </section>;
}

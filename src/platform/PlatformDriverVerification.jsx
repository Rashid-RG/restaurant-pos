import React,{useEffect,useMemo,useState} from 'react';
import {ShieldCheck,Building2,RefreshCw,Search,Clock3,ClipboardCheck,AlertCircle,LockKeyhole} from 'lucide-react';

const summaryMetric=(rows,key)=>rows.reduce((n,row)=>n+Number(row[key]||0),0);

export default function PlatformDriverVerification(){
 const [data,setData]=useState(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState('all');
 const refresh=async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/platform/driver-verification-oversight',{
    headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},cache:'no-store'
   });
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'Verification oversight unavailable.');
   if(body.scope!=='platform_aggregate_only'||body.documentsAccessible!==false||body.restaurantApprovalAuthority!==false)
    throw new Error('Platform oversight authorization policy mismatch.');
   setData(body);
  }catch(err){setError(err.message);}
  finally{setLoading(false);}
 };
 useEffect(()=>{void refresh();},[]);
 const all=data?.restaurants||[];
 const rows=useMemo(()=>all.filter(item=>
  item.restaurant.toLowerCase().includes(search.toLowerCase()) &&
  (filter==='all'||(filter==='resubmit'?item.manualResubmit>0:item.pending>0))
 ),[data,search,filter]);
 const metrics=[
  {label:'Pending rider applications',value:summaryMetric(all,'pending'),icon:Clock3},
  {label:'Manual reviews passed',value:summaryMetric(all,'manualApproved'),icon:ClipboardCheck},
  {label:'Resubmission requested',value:summaryMetric(all,'manualResubmit'),icon:AlertCircle},
  {label:'Restaurants with pending cases',value:all.length,icon:Building2}
 ];
 return <section aria-label="Platform driver verification oversight" className="platform-operations" style={{display:'grid',gap:20}}>
   <header style={{display:'flex',gap:14,alignItems:'start',justifyContent:'space-between',flexWrap:'wrap'}}>
    <div><span style={{fontWeight:700,fontSize:12,letterSpacing:1.4,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:7}}><ShieldCheck size={17}/> RS TECHNOLOGIES · OVERSIGHT</span>
     <h2 style={{fontSize:'clamp(1.5rem,3vw,2.1rem)',margin:'10px 0 6px'}}>Driver verification overview</h2>
     <p style={{color:'var(--text-muted)',margin:0,maxWidth:700}}>Monitor verification progress across restaurants without exposing private identity evidence. All document review and final approval remain restaurant-owned.</p>
    </div>
    <button className="btn btn-outline" type="button" disabled={loading} onClick={refresh} style={{display:'flex',alignItems:'center',gap:8}}><RefreshCw size={16}/> Refresh</button>
   </header>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:12}}>
    {metrics.map(({label,value,icon:Icon})=><article key={label} style={{border:'1px solid var(--border-color)',background:'var(--bg-card)',borderRadius:16,padding:18}}>
      <Icon size={20} color="#059669"/><div style={{fontSize:30,fontWeight:850,margin:'8px 0 3px',fontVariantNumeric:'tabular-nums'}}>{value}</div><small style={{color:'var(--text-muted)'}}>{label}</small>
    </article>)}
   </div>
   <section style={{border:'1px solid var(--border-color)',background:'var(--bg-card)',borderRadius:17,padding:20,display:'grid',gap:14}}>
     <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',justifyContent:'space-between'}}>
      <div><h3 style={{margin:0}}>Restaurant review queues</h3><p style={{color:'var(--text-muted)',fontSize:12,margin:'5px 0 0'}}>Only opted-in restaurant names and aggregate counts, never applicant details</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
       <label style={{display:'flex',alignItems:'center',gap:7,border:'1px solid var(--border-color)',borderRadius:11,padding:'6px 10px'}}><Search size={15}/><input aria-label="Search restaurants" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search restaurants" style={{border:0,background:'transparent',color:'inherit',maxWidth:180}}/></label>
       <select aria-label="Filter restaurant queues" value={filter} onChange={e=>setFilter(e.target.value)} style={{borderRadius:11,padding:9,background:'var(--bg-card)',color:'inherit',border:'1px solid var(--border-color)'}}>
        <option value="all">All queues</option><option value="pending">Awaiting reviews</option><option value="resubmit">Resubmission required</option>
       </select>
      </div>
     </div>
     {loading&&<p role="status">Loading protected platform metrics…</p>}
     {error&&<p role="alert" style={{color:'#dc2626'}}>{error}</p>}
     {!loading&&!error&&rows.length===0&&<p style={{padding:25,textAlign:'center',color:'var(--text-muted)'}}>No restaurants match these filters.</p>}
     {!loading&&!error&&rows.length>0&&<div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:680,borderCollapse:'collapse',fontSize:13}}>
      <thead><tr><th style={{textAlign:'left',padding:12}}>Restaurant</th><th>Pending</th><th>Manual passed</th><th>Resubmit</th><th>Rejected review</th><th>Provider ID</th><th>Provider licence</th></tr></thead>
      <tbody>{rows.map(item=><tr key={item.tenantId} style={{borderTop:'1px solid var(--border-color)'}}>
       <td style={{padding:12,fontWeight:650}}>{item.restaurant}</td>
       <td style={{textAlign:'center'}}>{item.pending}</td><td style={{textAlign:'center'}}>{item.manualApproved}</td>
       <td style={{textAlign:'center'}}>{item.manualResubmit}</td><td style={{textAlign:'center'}}>{item.manualRejected}</td>
       <td style={{textAlign:'center'}}>{item.automatedIdentityVerified}</td><td style={{textAlign:'center'}}>{item.automatedLicenceVerified}</td>
      </tr>)}</tbody>
     </table></div>}
   </section>
   <div style={{display:'flex',gap:12,alignItems:'start',padding:17,borderRadius:14,background:'var(--bg-card)',border:'1px solid var(--border-color)'}}>
    <LockKeyhole size={20}/><p style={{fontSize:12,lineHeight:1.6,margin:0}}><strong>Privacy and authority boundary:</strong> The platform owner cannot access rider NICs, selfies, driving-licence images, personal contacts or restaurant approval controls through this workspace. DMT suspension/revocation checks are not connected to an official government API.</p>
   </div>
  </section>;
}

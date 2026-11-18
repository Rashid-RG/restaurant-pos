import React,{useEffect,useState} from 'react';

export default function PlatformDriverVerification(){
 const [data,setData]=useState(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const refresh=async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/platform/driver-verification-oversight',{
    headers:{Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}`},
    cache:'no-store'
   });
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'Verification oversight unavailable.');
   if(body.scope!=='platform_aggregate_only'||body.documentsAccessible!==false)throw new Error('Invalid platform oversight policy.');
   setData(body);
  }catch(err){setError(err.message);}
  finally{setLoading(false);}
 };
 useEffect(()=>{refresh()},[]);
 return <section aria-label="Platform verification oversight" className="platform-operations">
  <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
   <div><h2>Driver verification oversight</h2>
    <p>This RS Technologies platform-owner view shows aggregate review queues by restaurant. Only each restaurant owner or manager may open private documents or approve riders.</p>
   </div>
   <button className="btn btn-outline" disabled={loading} onClick={refresh}>Refresh status</button>
  </header>
  <p style={{fontSize:13}}>Protected boundary: no NIC, passport, selfie, driving-licence images, applicant contacts or raw document details are available here. DMT suspension/revocation is not automatically verified.</p>
  {loading&&<p role="status">Loading restaurant verification status…</p>}
  {error&&<p role="alert">{error}</p>}
  {!loading&&!error&&data?.restaurants?.length===0&&<p>No restaurants have pending rider applications.</p>}
  {!loading&&!error&&data?.restaurants?.length>0&&<div style={{overflowX:'auto'}}>
   <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
    <thead><tr><th>Restaurant</th><th>Pending riders</th><th>Manual passes</th><th>Resubmit</th><th>Rejected evidence</th><th>Provider identity</th><th>Provider licence</th></tr></thead>
    <tbody>{data.restaurants.map(item=><tr key={item.tenantId}>
     <td>{item.restaurant}</td><td>{item.pending}</td><td>{item.manualApproved}</td>
     <td>{item.manualResubmit}</td><td>{item.manualRejected}</td>
     <td>{item.automatedIdentityVerified}</td><td>{item.automatedLicenceVerified}</td>
    </tr>)}</tbody>
   </table>
  </div>}
 </section>;
}

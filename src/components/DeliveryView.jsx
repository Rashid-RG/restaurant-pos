import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';
import { restaurantTimeZone } from '../utils/restaurant-time';
import RiderRecruitmentPanel from './RiderRecruitmentPanel';
import './RiderVerificationCenter.css';
import ProtectedRiderEvidenceViewer from './ProtectedRiderEvidenceViewer';

export default function DeliveryView({verificationOnly=false}) {
  const { orders, showToast, settings,currentUser } = usePOS();
  const [verificationTab,setVerificationTab]=useState('Pending');
  const [verificationSearch,setVerificationSearch]=useState('');
  const [selectedVerificationRider,setSelectedVerificationRider]=useState(null);
  const [reviewStep,setReviewStep]=useState('identity');
  const [auditRows,setAuditRows]=useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState({});
  const [nearbyRiders,setNearbyRiders]=useState({});
  const [nearbyLoading,setNearbyLoading]=useState({});

  const [verifiedApplications, setVerifiedApplications] = useState({});
  const [licenceReviews, setLicenceReviews] = useState({});
  const [manualReviews,setManualReviews]=useState({});
  const [manualPreview,setManualPreview]=useState(null);

  // Driver registration form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('Motorbike');
  const [plateNumber, setPlateNumber] = useState('');

  const deliveryOrders = orders.filter(o => o.diningType === 'delivery' || o.diningType === 'takeaway' || o.source === 'online');

  // ── Rush-hour detection in this restaurant's local time ──
  const checkRushHour = () => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: restaurantTimeZone(settings), hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
  };
  const rushHour = checkRushHour();

  const getDispatchBadge = (mode) => {
    if (mode === 'auto')   return { label: '⚡ Auto-Dispatch', bg: '#059669', text: '#fff' };
    if (mode === 'hybrid') return { label: '🔀 Hybrid',       bg: '#7c3aed', text: '#fff' };
    return                        { label: '🖐️ Manual',       bg: '#374151', text: '#9ca3af' };
  };

  const fetchDrivers = async () => {
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/drivers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDrivers(data);
      }
    } catch (err) {
      console.error('Failed to fetch drivers:', err);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

  const handleRegisterDriver = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      showToast('Please enter driver name and phone number.', 'warning');
      return;
    }
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, phone, vehicleType, plateNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Driver ${name} registered successfully!`, 'success');
      setName('');
      setPhone('');
      setPlateNumber('');
      fetchDrivers();
    } catch (err) {
      showToast('Registration error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDriver = async (id, driverName) => {
    if (!window.confirm(`Delete driver ${driverName} from delivery fleet?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/delivery/drivers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete driver');
      showToast(`Driver ${driverName} removed.`, 'info');
      fetchDrivers();
    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  };

  const findNearbyRiders = async (orderId) => {
    // Pickup coordinates must be explicitly configured per restaurant.
    const lat=Number(settings?.storeLat),lng=Number(settings?.storeLng);
    if(!settings?.storeLat||!settings?.storeLng||
       !Number.isFinite(lat)||!Number.isFinite(lng)||
       Math.abs(lat)>90||Math.abs(lng)>180){
      showToast('Configure your restaurant pickup GPS coordinates in Settings before searching for nearby riders.','warning');
      return;
    }
    setNearbyLoading(prev=>({...prev,[orderId]:true}));
    try{
      const params=new URLSearchParams({lat:String(lat),lng:String(lng)});
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch(`/api/delivery/nearby-riders?${params}`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Rider discovery unavailable');
      setNearbyRiders(prev=>({...prev,[orderId]:data}));
      if(!data.candidates?.length)
        showToast('No verified riders with fresh on-duty location are currently nearby.','info');
    }catch(error){
      setNearbyRiders(prev=>({...prev,[orderId]:null}));
      showToast(error.message||'Could not find nearby riders.','warning');
    }finally{
      setNearbyLoading(prev=>({...prev,[orderId]:false}));
    }
  };

  const handleAssignDriver = async (orderId) => {
    const driverId = selectedDriver[orderId];
    if (!driverId) {
      showToast('Please select a driver from the dropdown.', 'warning');
      return;
    }
    const drv = drivers.find(d => d.id === driverId);
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId, driverId, driverName: drv?.name, driverPhone: drv?.phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Assigned ${drv?.name || driverId} to Order #${orderId.slice(-4).toUpperCase()}`, 'success');
      fetchDrivers();
    } catch (err) {
      showToast('Assignment error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const inspectManualDocument = async (driverId,kind) => {
    try {
      const token=localStorage.getItem('gastroflow_token');
      const res=await fetch(`/api/delivery/drivers/${encodeURIComponent(driverId)}/manual-document/${kind}`,{
        headers:{Authorization:`Bearer ${token}`}
      });
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||'Document unavailable.');
      setManualPreview({driverId,kind,src:`data:${data.contentType};base64,${data.data}`});
    }catch(error){showToast(error.message||'Unable to open protected document.','error');}
  };
  const decideManualReview = async (driver,decision) => {
    try {
      setLoading(true);
      const review=manualReviews[driver.id]||{};
      const licence=licenceReviews[driver.id]||{};
      const token=localStorage.getItem('gastroflow_token');
      const response=await fetch(`/api/delivery/drivers/${driver.id}/manual-review`,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({
          identityKind:review.identityKind||driver.applicationIdentityKind||'nic',
          decision,selfieMatched:review.selfieMatched===true,documentAuthenticityConfirmed:review.documentAuthenticityConfirmed===true,dmtStandingStatus:review.dmtStandingStatus||'not_checked',
          licenceClass:licence.licenceClass,licenceExpiry:licence.expiry,resubmitReason:review.resubmitReason||'missing_evidence'
        })
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Manual review failed.');
      showToast('Manual document review saved. Final rider approval is separate.','success');
      setManualPreview(null);
      await fetchDrivers();
    }catch(error){showToast(error.message||'Manual review failed.','error');}
    finally{setLoading(false);}
  };

  const handleApproveDriver = async (id, driverName, action) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/delivery/drivers/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: action === 'approve' ? 'available' : 'rejected', verificationConfirmed: action === 'approve' && verifiedApplications[id] === true, licenceConfirmed: action === 'approve' && licenceReviews[id]?.checked === true, licenceExpiry: action === 'approve' ? licenceReviews[id]?.expiry : undefined, licenceClass: action === 'approve' ? licenceReviews[id]?.licenceClass : undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Driver ${driverName} ${action === 'approve' ? 'approved & activated!' : 'rejected.'}`, action === 'approve' ? 'success' : 'info');
      setVerifiedApplications(previous => ({ ...previous, [id]: false }));
      setLicenceReviews(previous => ({ ...previous, [id]: { checked: false, expiry: '' } }));
      fetchDrivers();
    } catch (err) {
      showToast('Approval error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const pendingDrivers = drivers.filter(d => d.status === 'pending_approval');
  const activeDrivers = drivers.filter(d => d.status !== 'pending_approval' && d.status !== 'rejected');
  const verificationStatus=d=>d.status==='rejected'?'Rejected':
    d.status==='pending_approval'?
      d.manualReviewStatus==='resubmit'?'Resubmit':
      d.manualReviewStatus==='rejected'?'Rejected':
      d.manualReviewStatus==='approved'?'Under Review':'Pending':'Approved';
  const statusCounts=['Pending','Under Review','Resubmit','Approved','Rejected'].map(name=>({
    name,count:drivers.filter(d=>verificationStatus(d)===name).length
  }));
  const visibleVerificationDrivers=drivers.filter(d=>verificationStatus(d)===verificationTab && [d.name,d.phone,d.email,d.vehicleType,d.plateNumber].some(value=>String(value||'').toLowerCase().includes(verificationSearch.trim().toLowerCase())));
  const evidenceKinds=d=>[
    'identity_front',...(d.applicationIdentityKind==='passport'?[]:['identity_back']),'selfie',
    ...(d.vehicleType==='Bicycle'?[]:['licence_front','licence_back'])
  ];
  const evidenceCount=d=>evidenceKinds(d).filter(k=>String(d.submittedDocumentKinds||'').split(',').includes(k)).length;
  useEffect(()=>{
    if(selectedVerificationRider&&!visibleVerificationDrivers.some(d=>d.id===selectedVerificationRider))setSelectedVerificationRider(null);
  },[selectedVerificationRider,visibleVerificationDrivers]);
  const canReview=['owner','manager'].includes(currentUser?.role);
  const fetchVerificationAudit=async()=>{
    if(!canReview)return;
    try{
      const res=await fetch('/api/delivery/driver-verification/audit',{headers:{Authorization:'Bearer '+localStorage.getItem('gastroflow_token')},cache:'no-store'});
      if(res.ok)setAuditRows((await res.json()).reviews||[]);
    }catch(_){}
  };
  useEffect(()=>{if(verificationOnly)void fetchVerificationAudit();},[verificationOnly,drivers.length]);


  // Uber Eats-grade Multi-Order Stacking Batch state
  const [selectedBatchOrders, setSelectedBatchOrders] = useState([]);
  const [batchDriverId, setBatchDriverId] = useState('');

  const handleBatchAssign = async () => {
    if (!batchDriverId || selectedBatchOrders.length === 0) {
      showToast('Please select a driver and at least 1 order for batch dispatch.', 'warning');
      return;
    }
    const drv = drivers.find(d => d.id === batchDriverId);
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/public/driver/assign-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ driverId: batchDriverId, orderIds: selectedBatchOrders })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Batch of ${selectedBatchOrders.length} orders stacked to rider ${drv?.name || batchDriverId}! 🛵`, 'success');
      setSelectedBatchOrders([]);
      setBatchDriverId('');
      fetchDrivers();
    } catch (err) {
      showToast('Batch error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>{verificationOnly?'🛡️ Rider Verification Center':'🛵 Delivery Dispatch & Fleet Management'}</h1>
          <p>{verificationOnly?'Private restaurant-owned identity review, hiring and audit history.':'Assign active orders and manage delivery operations.'}</p>
        </div>
      </div>

      <div className="view-body" style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {verificationOnly && canReview && <>
          <RiderRecruitmentPanel/>
          <section aria-label="Driver application workspace" style={{padding:'clamp(16px,2vw,24px)',borderRadius:18,border:'1px solid var(--border-color)',background:'var(--bg-card)',display:'grid',gap:18}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
              <div>
                <h3 style={{margin:0,fontSize:'clamp(18px,2vw,21px)'}}>Driver applications</h3>
                <p style={{fontSize:13,color:'var(--text-muted)',margin:'6px 0 0'}}>Review applications and identity evidence for your restaurant only.</p>
              </div>
              <span style={{borderRadius:99,padding:'7px 12px',background:'rgba(16,185,129,.1)',fontSize:12,fontWeight:700}}>{drivers.length} total driver{drivers.length===1?'':'s'}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <label style={{display:'grid',gap:5,flex:'1 1 220px',fontSize:12,fontWeight:700}}>Find a rider
                <input className="form-input" type="search" value={verificationSearch} onChange={e=>setVerificationSearch(e.target.value)} placeholder="Search name, phone, vehicle or plate" aria-label="Search rider applications"/>
              </label>
              <button type="button" className="btn btn-outline" onClick={()=>{void fetchDrivers();void fetchVerificationAudit();}}>Refresh applications</button>
            </div>
            <div role="tablist" aria-label="Rider verification states" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,155px),1fr))',gap:10}}>
              {statusCounts.map(({name,count})=><button key={name} type="button" role="tab" aria-selected={verificationTab===name} onClick={()=>setVerificationTab(name)}
                className={verificationTab===name?'btn btn-primary':'btn btn-outline'}
                style={{display:'grid',gap:7,justifyItems:'start',textAlign:'left',minHeight:82,padding:'13px 15px',borderRadius:13}}>
                <span style={{fontSize:12,fontWeight:650}}>{name}</span><strong style={{fontSize:22,lineHeight:1.15}}>{count}</strong>
              </button>)}
            </div>
            <div className="rvc-cards" aria-label="Rider application cards">
              {visibleVerificationDrivers.map(d=>{
                const kinds=evidenceKinds(d),count=evidenceCount(d),received=String(d.submittedDocumentKinds||'').split(',');
                return <article className={'rvc-application-card'+(selectedVerificationRider===d.id?' selected':'')} key={d.id}>
                  <div className="rvc-card-identity"><div className="rvc-initial" aria-hidden="true">{String(d.name||'R').charAt(0).toUpperCase()}</div>
                    <div><h4>{d.name}</h4><p>{d.vehicleType||'Rider'} · {d.plateNumber||'Unassigned'}</p></div>
                    <span className="rvc-card-state">{verificationStatus(d)}</span>
                  </div>
                  <p className="rvc-card-contact">{d.phone} · {d.email||'Email not recorded'}</p>
                  <div className="rvc-card-progress"><strong>Verification documents</strong><span>{count}/{kinds.length} received</span></div>
                  <progress value={count} max={kinds.length} aria-label={'Document progress for '+d.name}/>
                  <div className="rvc-card-docs">{kinds.map(kind=><span key={kind} className={received.includes(kind)?'received':''}>{received.includes(kind)?'✓ ':'○ '}{kind==='identity_front'?(d.applicationIdentityKind==='passport'?'Passport':'NIC front'):kind==='identity_back'?'NIC back':kind==='selfie'?'Selfie':kind==='licence_front'?'Licence front':'Licence back'}</span>)}</div>
                  <button type="button" className="btn btn-primary rvc-open-button" onClick={()=>{setSelectedVerificationRider(d.id);setReviewStep('identity');}}>{d.status==='pending_approval'?'Review application':'View rider details'}</button>
                </article>;
              })}
            </div>
            {visibleVerificationDrivers.length===0&&<div role="status" style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderRadius:12,background:'var(--bg-secondary,rgba(148,163,184,.07))'}}>
              <span aria-hidden="true" style={{fontSize:20}}>📋</span>
              <div><strong style={{fontSize:13}}>No {verificationTab.toLowerCase()} applications</strong><p style={{fontSize:12,color:'var(--text-muted)',margin:'4px 0 0'}}>{verificationSearch?'No riders match this search. Clear the search or choose another status.':'Applications appear here after riders register or their review status changes.'}</p></div>
            </div>}
          </section>
        </>}
        {verificationOnly && !canReview && <p role="alert">Only restaurant owners and managers may review rider verification evidence.</p>}
        {verificationOnly && canReview && ['Approved','Rejected'].includes(verificationTab) && visibleVerificationDrivers.some(d=>d.status!=='pending_approval') && (
          <section aria-label="Completed rider application history" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(245px,1fr))',gap:12}}>
            {visibleVerificationDrivers.filter(d=>d.status!=='pending_approval').map(d=><article key={d.id} style={{padding:18,borderRadius:14,background:'var(--bg-card)',border:'1px solid var(--border-color)'}}>
              <strong style={{fontSize:16}}>👤 {d.name}</strong>
              <p style={{fontSize:12,color:'var(--text-muted)'}}> {d.vehicleType||'Rider'} · {d.plateNumber||'No plate'} </p>
              <span className={verificationTab==='Approved'?'badge badge-success':'badge badge-warning'}>{verificationTab==='Approved'?'Operational account':'Application rejected'}</span>
              <p style={{fontSize:12,color:'var(--text-muted)'}}>Completed applications are read-only here. Protected evidence is purged after the restaurant's final review.</p>
            </article>)}
          </section>
        )}
        {/* 0. Pending Driver Registrations Queue */}
        {verificationOnly && canReview && visibleVerificationDrivers.some(d=>d.id===selectedVerificationRider && d.status==='pending_approval') && (
          <div className="rvc-review-panel" aria-label="Selected rider review">
            <div className="rvc-review-head"><div><span>APPLICATION REVIEW</span><h3>{visibleVerificationDrivers.find(d=>d.id===selectedVerificationRider)?.name}</h3></div>
              <button type="button" className="btn btn-outline" onClick={()=>setSelectedVerificationRider(null)}>Close review ✕</button></div>
            <div className="rvc-review-tabs" role="tablist" aria-label="Manager review stages">
              {[['identity','1 · Identity & documents'],['eligibility','2 · Licence & decision'],['timeline','3 · Activity timeline']].map(([key,label])=>
                <button key={key} type="button" role="tab" aria-selected={reviewStep===key} className={reviewStep===key?'active':''} onClick={()=>setReviewStep(key)}>{label}</button>)}
            </div>
            <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⏳ {verificationTab} Rider Applications ({visibleVerificationDrivers.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,370px), 1fr))', gap: '12px' }}>
              {visibleVerificationDrivers.filter(d=>d.status==='pending_approval' && d.id===selectedVerificationRider).map(d => (
                <div key={d.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '14px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem' }}>👤 {d.name}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>📞 {d.phone} • {d.vehicleType || 'Motorbike'} ({d.plateNumber || 'N/A'})</div>
                    <span className="badge badge-warning" style={{ marginTop: '6px', textTransform: 'uppercase', fontSize: '10px' }}>
                      Awaiting Admin Approval
                    </span>
                    <div style={{fontSize:12,marginTop:8,color:'var(--text-muted)'}}>Automated ID verification: <strong>{d.identityStatus === 'verified' ? 'Provider verified' : d.identityStatus === 'rejected' ? 'Provider rejected — review required' : d.identityStatus === 'resubmit' ? 'Resubmission requested' : d.identityStatus === 'created' || d.identityStatus === 'review' ? 'Verification in progress' : 'Not verified'}</strong></div>
                    <div style={{fontSize:12,marginTop:8,color:'var(--text-muted)'}}>Driving-licence document: <strong>{d.licenceDocumentStatus === 'verified' ? 'Document authenticity verified; class and standing still need review' : d.licenceDocumentStatus === 'rejected' ? 'Provider rejected' : d.licenceDocumentStatus === 'resubmit' ? 'Resubmission needed' : d.licenceDocumentStatus === 'review' ? 'Manual review needed' : d.licenceDocumentStatus === 'created' ? 'Waiting for provider' : 'No provider check recorded'}</strong></div>
                    <div style={{fontSize:12,marginTop:8,color:'var(--text-muted)'}}>Manual review: <strong>{d.manualReviewStatus||'Not reviewed'}</strong> · DMT standing: {d.dmtReviewStatus==='manager_checked_external'?'Manager recorded external check':'Not officially checked'}</div>
                  </div>
                  {reviewStep==='identity'&&<section className="rvc-identity-review">
                    <strong style={{fontSize:13}}>Identity & licence review</strong>
                    {d.applicationIdentityKind&&<p style={{fontSize:12,margin:0,color:'var(--text-muted)'}}>Applicant selected: <strong>{d.applicationIdentityKind==='passport'?'Passport':'National Identity Card'}</strong></p>}
                    <select className="form-input" value={manualReviews[d.id]?.identityKind||d.applicationIdentityKind||'nic'} onChange={e=>setManualReviews(p=>({...p,[d.id]:{...p[d.id],identityKind:e.target.value}}))}>
                      <option value="nic" disabled={d.applicationIdentityKind==='passport'}>Sri Lankan NIC</option>
                      <option value="passport" disabled={d.applicationIdentityKind==='nic'}>Passport</option>
                    </select>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {[
                        ['identity_front',(manualReviews[d.id]?.identityKind||d.applicationIdentityKind)==='passport'?'Passport information page':'NIC front'],
                        ...((manualReviews[d.id]?.identityKind||d.applicationIdentityKind)==='passport'?[]:[['identity_back','NIC back']]),
                        ['selfie','Selfie photo'],
                        ...(d.vehicleType==='Bicycle'?[]:[['licence_front','Licence front'],['licence_back','Licence back']])
                      ].map(([kind,label])=><button type="button" key={kind} className="btn btn-outline" style={{fontSize:11,padding:5}} onClick={()=>inspectManualDocument(d.id,kind)}>{label}</button>)}
                    </div>
                    <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12}}>
                      <input type="checkbox" checked={manualReviews[d.id]?.selfieMatched===true} onChange={e=>setManualReviews(p=>({...p,[d.id]:{...p[d.id],selfieMatched:e.target.checked}}))}/>
                      I opened the selfie and identity document, visually compared the face, and am satisfied they appear to match.
                    </label>
                    <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12}}>
                      <input type="checkbox" checked={manualReviews[d.id]?.documentAuthenticityConfirmed===true} onChange={e=>setManualReviews(p=>({...p,[d.id]:{...p[d.id],documentAuthenticityConfirmed:e.target.checked}}))}/>
                      I examined the document images and original evidence or performed an attended identity check. An image upload alone is not proof of authenticity.
                    </label>
                    <label style={{fontSize:12}}>DMT standing review
                      <select className="form-input" value={manualReviews[d.id]?.dmtStandingStatus||'not_checked'} onChange={e=>setManualReviews(p=>({...p,[d.id]:{...p[d.id],dmtStandingStatus:e.target.value}}))}>
                        <option value="not_checked">Not officially checked</option>
                        <option value="manager_checked_external">Manager completed external standing review (not system-verified)</option>
                      </select>
                    </label>
                    <p style={{fontSize:11,color:'var(--text-muted)',margin:0}}>Confirm image quality, original identity, licence class, expiry and any external DMT standing independently. Files are deleted after final approval.</p>
                    <label style={{fontSize:12,fontWeight:700,display:'grid',gap:6}}>Reason if resubmission is needed
                      <select className="form-input" value={manualReviews[d.id]?.resubmitReason||'missing_evidence'} onChange={e=>setManualReviews(p=>({...p,[d.id]:{...p[d.id],resubmitReason:e.target.value}}))}>
                        <option value="missing_evidence">Required document missing</option>
                        <option value="unclear_identity">NIC / passport is not readable</option>
                        <option value="unclear_selfie">Selfie is not clear</option>
                        <option value="selfie_mismatch">Selfie does not match identity document</option>
                        {d.vehicleType!=='Bicycle'&&<><option value="unclear_licence">Driving licence image unreadable</option><option value="licence_expired">Driving licence appears expired / ineligible</option></>}
                      </select>
                    </label>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      <button type="button" className="btn btn-success" disabled={loading || manualReviews[d.id]?.selfieMatched!==true || manualReviews[d.id]?.documentAuthenticityConfirmed!==true} onClick={()=>decideManualReview(d,'approve')}>Record manual pass</button>
                      <button type="button" className="btn btn-outline" disabled={loading} onClick={()=>decideManualReview(d,'resubmit')}>Request resubmission</button>
                      <button type="button" className="btn btn-danger" disabled={loading} onClick={()=>decideManualReview(d,'reject')}>Reject evidence</button>
                    </div>
                    <button className="btn btn-primary" type="button" onClick={()=>setReviewStep('eligibility')}>Continue to licence & decision →</button>
                  </section>}
                  {reviewStep==='eligibility'&&<section className="rvc-eligibility-review">
                  <label style={{ fontSize: 12, lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={verifiedApplications[d.id] === true} onChange={e => setVerifiedApplications(previous => ({ ...previous, [d.id]: e.target.checked }))} style={{ marginTop: 3 }} />I independently checked this rider's identity and vehicle eligibility; application details alone are not verification.</label>
                  {d.vehicleType !== 'Bicycle' && <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:12,fontWeight:650}}>Verified driving licence class
                    <select className="form-input" value={licenceReviews[d.id]?.licenceClass || ''} onChange={e=>setLicenceReviews(previous=>({...previous,[d.id]:{...previous[d.id],licenceClass:e.target.value}}))}>
                      <option value="">Select class from original licence</option>
                      <option value="A">A — motorbike</option>
                      <option value="A1">A1 — restricted small motorbike (not approved without engine check)</option>
                      <option value="B1">B1 — tuk-tuk</option>
                      <option value="B">B — car / light vehicle</option>
                    </select>
                  </label>}
                  {d.vehicleType !== 'Bicycle' && <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:12,fontWeight:650}}>Driving licence expiry (verified from the original licence)<input type="date" className="form-input" value={licenceReviews[d.id]?.expiry || ''} min={new Date().toISOString().slice(0,10)} onChange={e=>setLicenceReviews(previous=>({...previous,[d.id]:{...previous[d.id],expiry:e.target.value}}))}/></label>}
                  {d.vehicleType !== 'Bicycle' && <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12,lineHeight:1.5}}><input type="checkbox" checked={licenceReviews[d.id]?.checked===true} onChange={e=>setLicenceReviews(previous=>({...previous,[d.id]:{...previous[d.id],checked:e.target.checked}}))} style={{marginTop:3}}/>I checked the original licence, the permitted vehicle class, and its validity.</label>}
                  <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                    <button
                      className="btn btn-success"
                      onClick={() => handleApproveDriver(d.id, d.name, 'approve')}
                      disabled={loading || verifiedApplications[d.id] !== true || (d.vehicleType !== 'Bicycle' && (licenceReviews[d.id]?.checked!==true || !licenceReviews[d.id]?.expiry || licenceReviews[d.id]?.licenceClass !== (d.vehicleType === 'Motorbike' ? 'A' : d.vehicleType === 'TukTuk' ? 'B1' : d.vehicleType === 'Car' ? 'B' : '')))}
                      style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700, background: '#10b981', color: '#fff', border: 'none' }}
                    >
                      ✓ Approve Driver
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleApproveDriver(d.id, d.name, 'reject')}
                      disabled={loading}
                      style={{ padding: '8px 12px', fontSize: '0.82rem', fontWeight: 700 }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                  </section>}
                  {reviewStep==='timeline'&&<section className="rvc-timeline">
                    <h4>Recorded application activity</h4>
                    <p>Only events recorded by the restaurant verification audit are shown. Missing historical events are not inferred.</p>
                    {auditRows.filter(row=>row.driverId===d.id).length===0?
                      <div className="rvc-empty-state">No manager review recorded for this rider yet.</div>:
                      auditRows.filter(row=>row.driverId===d.id).map((row,index)=><div className="rvc-event" key={row.driverId+'-'+index}>
                        <div className="rvc-event-marker" aria-hidden="true"/><div><strong>{String(row.state||'Review').replace(/_/g,' ')}</strong>
                          <p>{row.identityType==='passport'?'Passport':'NIC'} · {row.standingCheck==='manager_checked_external'?'Manager-attested external check':'No official DMT check'}</p>
                          {row.resubmitReason&&<p>Resubmission: {String(row.resubmitReason).replace(/_/g,' ')}</p>}
                          <small>{row.reviewedAt?new Date(row.reviewedAt).toLocaleString():'Time unavailable'}</small></div>
                      </div>)}
                  </section>}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {verificationOnly && canReview && visibleVerificationDrivers.length===0 && (
          <div style={{borderRadius:15,padding:26,textAlign:'center',border:'1px dashed var(--border-color)',color:'var(--text-muted)'}}>
            No applications in {verificationTab.toLowerCase()}. Select another status or invite new riders.
          </div>
        )}
        {verificationOnly && canReview && <section style={{padding:20,border:'1px solid var(--border-color)',borderRadius:16,background:'var(--bg-card)'}}>
          <h3 style={{margin:'0 0 12px'}}>Verification audit history</h3>
          <p style={{color:'var(--text-muted)',fontSize:12}}>Tenant-specific manager decisions and standing-check attestations. No identity images are included.</p>
          <button type="button" className="btn btn-outline" onClick={fetchVerificationAudit}>Refresh audit</button>
          <div style={{overflowX:'auto',marginTop:12}}><table style={{width:'100%',fontSize:12}}>
            <thead><tr><th>Rider</th><th>Review status</th><th>Identity</th><th>DMT standing</th><th>Resubmission reason</th><th>Reviewed at</th></tr></thead>
            <tbody>{auditRows.map((row,i)=><tr key={row.driverId+'-'+i}><td>{row.driverName}</td><td>{row.state}</td><td>{row.identityType}</td><td>{row.standingCheck==='manager_checked_external'?'Manager-attested':'Not checked'}</td><td>{row.resubmitReason?row.resubmitReason.replace(/_/g,' '):'—'}</td><td>{row.reviewedAt?new Date(row.reviewedAt).toLocaleString():'Not reviewed'}</td></tr>)}</tbody>
          </table>{!auditRows.length&&<p style={{fontSize:13,color:'var(--text-muted)'}}>No manual reviews recorded.</p>}</div>
        </section>}
        {!verificationOnly && <>
        {/* 1. Register New Delivery Driver Form */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 800 }}>➕ Register New Fleet Driver</h3>
          <form onSubmit={handleRegisterDriver} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Driver Full Name</label>
              <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kamal Perera" required />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Phone Number</label>
              <input className="form-input" type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0771234567" required />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Vehicle Type</label>
              <select className="form-input" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                <option value="Motorbike">🛵 Motorbike / Scooter</option>
                <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                <option value="Car">🚗 Car / Van</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Plate Number</label>
              <input className="form-input" type="text" value={plateNumber} onChange={e => setPlateNumber(e.target.value)} placeholder="e.g. WP BZ-9876" />
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', padding: '10px' }}>
                Register Driver
              </button>
            </div>
          </form>
        </div>

        {/* 2. Registered Drivers Fleet Roster */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 800 }}>🛵 Active Delivery Fleet ({drivers.length})</h3>
          {drivers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No registered drivers in fleet yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
              {drivers.map(d => (
                <div key={d.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', padding: '12px 16px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>🛵 {d.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>📞 {d.phone} • {d.vehicleType || 'Motorbike'} ({d.plateNumber || 'N/A'})</div>
                    <span className={`badge ${d.status === 'busy' ? 'badge-warning' : 'badge-success'}`} style={{ marginTop: '4px', textTransform: 'uppercase', fontSize: '10px' }}>
                      {d.status}
                    </span>
                  </div>
                  <button className="btn btn-danger" onClick={() => handleDeleteDriver(d.id, d.name)} style={{ padding: '4px 8px', fontSize: '12px' }}>
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Multi-Order Stacking Batch Dispatch Control */}
        {deliveryOrders.length > 1 && (
          <div style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08))', border: '1px solid var(--brand)', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 800, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡</span> Uber Eats Multi-Order Batch Stacking ({selectedBatchOrders.length} orders selected)
            </h3>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={batchDriverId}
                onChange={e => setBatchDriverId(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: '8px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontWeight: 700 }}
              >
                <option value="">-- Select Rider for Batch Delivery --</option>
                {activeDrivers.map(d => (
                  <option key={d.id} value={d.id}>
                    🛵 {d.name} ({d.phone})
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                onClick={handleBatchAssign}
                disabled={loading || !batchDriverId || selectedBatchOrders.length === 0}
                style={{ padding: '10px 20px', fontWeight: 800, whiteSpace: 'nowrap' }}
              >
                🛵 Dispatch Batch ({selectedBatchOrders.length} Orders)
              </button>
            </div>
          </div>
        )}

        {/* 4. Live Delivery Orders & Dispatch Cards */}
        <div>
          <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800 }}>📦 Active Delivery & Takeaway Orders</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {deliveryOrders.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '12px', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                🛵 No active delivery or online takeaway orders.
              </div>
            ) : (
              deliveryOrders.map((ord) => {
                const assignedDrv = drivers.find(d => d.id === ord.driverId);
                const waLink = assignedDrv ? `https://wa.me/${assignedDrv.phone.replace(/[\s+-]/g, '')}?text=Delivery%20Order%20%23${ord.id.slice(-4).toUpperCase()}%20Address:%20${encodeURIComponent(ord.deliveryAddress || 'Store Pickup')}` : '#';

                return (
                  <div key={ord.id} style={{ background: 'var(--bg-card)', border: selectedBatchOrders.includes(ord.id) ? '2px solid var(--brand)' : '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={selectedBatchOrders.includes(ord.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedBatchOrders([...selectedBatchOrders, ord.id]);
                            } else {
                              setSelectedBatchOrders(selectedBatchOrders.filter(id => id !== ord.id));
                            }
                          }}
                          style={{ width: 18, height: 18, accentColor: 'var(--brand)', cursor: 'pointer' }}
                        />
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Order #{ord.id.slice(-4).toUpperCase()}</h3>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Dispatch Mode Badge */}
                        {(() => { const b = getDispatchBadge(ord.dispatchMode); return (
                          <span style={{ background: b.bg, color: b.text, padding: '2px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700 }}>{b.label}</span>
                        ); })()}
                        {/* Rush-Hour Fee Warning */}
                        {rushHour && (ord.diningType === 'delivery' || ord.source === 'online') && (
                          <span style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', padding: '2px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700 }}>⏰ Peak Fee</span>
                        )}
                        <span className={`badge ${ord.status === 'delivered' ? 'badge-success' : ord.status === 'ready' ? 'badge-warning' : 'badge-primary'}`} style={{ textTransform: 'uppercase' }}>
                          {ord.status}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div>👤 <strong>{ord.customerName || (ord.customerId ? ord.customerId.split('|')[0] : 'Guest Customer')}</strong></div>
                      {ord.customerPhone && <div>📞 {ord.customerPhone}</div>}
                      {ord.deliveryAddress && <div>📍 {ord.deliveryAddress}</div>}
                      <div>💰 Total: <strong>Rs. {ord.total?.toFixed(2)}</strong> ({ord.paymentMethod || 'COD'})</div>
                    </div>

                    {/* Driver Assignment Controls */}
                    <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>Assign Delivery Rider:</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          value={selectedDriver[ord.id] || ord.driverId || ''}
                          onChange={(e) => setSelectedDriver({ ...selectedDriver, [ord.id]: e.target.value })}
                          style={{ flex: 1, padding: '8px', borderRadius: '8px', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        >
                          <option value="">-- Select Driver --</option>
                          {activeDrivers.map(d => (
                            <option key={d.id} value={d.id}>
                              🛵 {d.name} ({d.phone}) — {d.status.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleAssignDriver(ord.id)}
                          disabled={loading}
                          style={{ padding: '8px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                        >
                          Assign Rider
                        </button>
                      </div>
                      {['owner','manager'].includes(String(currentUser?.role||'').toLowerCase()) &&
                        (ord.diningType==='delivery'||ord.orderType==='delivery') &&
                        !ord.driverId && (
                        <div style={{display:'flex',flexDirection:'column',gap:8,padding:10,borderRadius:10,background:'var(--bg-surface)',border:'1px solid var(--border-color)'}}>
                          <button type="button" className="btn btn-secondary"
                            onClick={()=>findNearbyRiders(ord.id)} disabled={nearbyLoading[ord.id]}
                            style={{fontSize:12,alignSelf:'flex-start',padding:'7px 10px'}}>
                            {nearbyLoading[ord.id]?'Finding verified riders…':'📍 Find nearby riders'}
                          </button>
                          {nearbyRiders[ord.id] && (
                            <div style={{display:'flex',flexDirection:'column',gap:6}}>
                              <div style={{fontSize:11,color:'var(--text-muted)'}}>
                                {nearbyRiders[ord.id].estimatedRoadTimesAvailable
                                  ? 'Estimated road travel to restaurant (not live traffic)'
                                  : 'Straight-line proximity only — route ETA unavailable'}
                              </div>
                              {(nearbyRiders[ord.id].candidates||[]).length===0
                                ? <span style={{fontSize:12,color:'var(--text-muted)'}}>No fresh, consented and available riders in range.</span>
                                : nearbyRiders[ord.id].candidates.map(candidate=>(
                                  <button key={candidate.driverId} type="button"
                                    onClick={()=>setSelectedDriver(prev=>({...prev,[ord.id]:candidate.driverId}))}
                                    aria-pressed={selectedDriver[ord.id]===candidate.driverId}
                                    style={{
                                      textAlign:'left',padding:9,borderRadius:8,
                                      border:selectedDriver[ord.id]===candidate.driverId
                                        ? '2px solid var(--brand)':'1px solid var(--border-color)',
                                      background:'var(--bg-card)',color:'var(--text-main)',cursor:'pointer',fontSize:12
                                    }}>
                                    🛵 {drivers.find(d=>d.id===candidate.driverId)?.name||'Verified rider'}
                                    {' · '}{candidate.roadTravelMinutes!=null
                                      ? `${candidate.roadTravelMinutes} min by road`
                                      : `${(candidate.distanceMeters/1000).toFixed(1)} km nearby`}
                                    {' · '}GPS {Math.ceil(candidate.locationAgeMs/1000)}s old
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                      {assignedDrv && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ background: '#25D366', color: '#fff', padding: '6px', fontSize: '0.78rem', textDecoration: 'none', textAlign: 'center', fontWeight: 700, borderRadius: '8px' }}
                        >
                          💬 Alert Rider {assignedDrv.name} via WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        </>}
        {manualPreview && <ProtectedRiderEvidenceViewer preview={manualPreview} onClose={()=>setManualPreview(null)}/>}
      </div>
    </div>
  );
}

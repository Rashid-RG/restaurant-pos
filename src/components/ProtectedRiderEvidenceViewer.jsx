import React,{useEffect,useState} from 'react';
import './ProtectedRiderEvidenceViewer.css';

const options=[
  ['selfie','Selfie'],
  ['identity_front','NIC front / passport'],
  ['identity_back','NIC back'],
  ['licence_front','Licence front'],
  ['licence_back','Licence back']
];

/** Images are held in component memory only and discarded when the dialog closes. */
export default function ProtectedRiderEvidenceViewer({preview,onClose}){
  const [zoom,setZoom]=useState(1);
  const [compareKind,setCompareKind]=useState('');
  const [comparison,setComparison]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{setZoom(1);setCompareKind('');setComparison(null);setError('');},[preview?.driverId,preview?.kind]);
  useEffect(()=>{
    if(!preview)return undefined;
    const onKey=(event)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[preview,onClose]);
  if(!preview)return null;
  const loadComparison=async(kind)=>{
    setCompareKind(kind);setComparison(null);setError('');
    if(!kind)return;
    setBusy(true);
    try{
      const token=localStorage.getItem('gastroflow_token');
      if(!token)throw new Error('Manager session expired. Sign in again.');
      const response=await fetch('/api/delivery/drivers/'+encodeURIComponent(preview.driverId)+'/manual-document/'+encodeURIComponent(kind),{
        headers:{Authorization:'Bearer '+token},cache:'no-store'
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Document unavailable.');
      if(!['image/jpeg','image/png','image/webp'].includes(data.contentType) || typeof data.data!=='string')
        throw new Error('Invalid protected image response.');
      setComparison({kind,src:'data:'+data.contentType+';base64,'+data.data});
    }catch(e){setError(e.message||'Unable to load protected image.');}
    finally{setBusy(false);}
  };
  return <div className="rvc-viewer-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="rvc-viewer" role="dialog" aria-modal="true" aria-label="Protected rider document inspection">
      <header className="rvc-viewer-header">
        <div><strong>Protected document review</strong><p>Rider {preview.driverId} · {preview.kind.replace(/_/g,' ')}</p></div>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close ✕</button>
      </header>
      <div className="rvc-viewer-toolbar">
        <label>Zoom
          <input type="range" min="1" max="3" step="0.25" value={zoom} onChange={event=>setZoom(Number(event.target.value))}/>
          <span>{Math.round(zoom*100)}%</span>
        </label>
        <button type="button" className="btn btn-outline" onClick={()=>setZoom(1)}>Reset zoom</button>
        <label>Compare with
          <select value={compareKind} onChange={event=>void loadComparison(event.target.value)} disabled={busy}>
            <option value="">No comparison</option>
            {options.filter(([kind])=>kind!==preview.kind).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}
          </select>
        </label>
      </div>
      {error&&<p className="rvc-viewer-error" role="alert">{error}</p>}
      {busy&&<p role="status">Loading secure comparison…</p>}
      <div className="rvc-viewer-images">
        <figure><div className="rvc-viewer-image-frame"><img alt={'Protected '+preview.kind.replace(/_/g,' ')+' evidence'} src={preview.src} draggable={false} style={{transform:'scale('+zoom+')'}}/></div><figcaption>{preview.kind.replace(/_/g,' ')}</figcaption></figure>
        {comparison&&<figure><div className="rvc-viewer-image-frame"><img alt={'Protected '+comparison.kind.replace(/_/g,' ')+' comparison'} src={comparison.src} draggable={false} style={{transform:'scale('+zoom+')'}}/></div><figcaption>{comparison.kind.replace(/_/g,' ')}</figcaption></figure>}
      </div>
      <p className="rvc-viewer-disclaimer">Confidential restaurant-only evidence. Every image access is audited. Do not copy, forward or share documents. Visual comparison is not automated identity verification.</p>
    </section>
  </div>;
}

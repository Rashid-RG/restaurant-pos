import React, { useEffect, useRef, useState } from 'react';

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG or WebP photo smaller than 12 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This photo could not be opened.')); img.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encoding removes camera metadata and keeps uploads within the server limit.
    const data = canvas.toDataURL('image/jpeg', 0.75);
    if (data.length > 690000) throw new Error('This photo is still too large. Choose a simpler or smaller image.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function ProofOfDeliveryModal({ order, onClose, onConfirm }) {
  const dialog = useRef(null), canvasRef = useRef(null), drawing = useRef(false), busyRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false), [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false), [preparingPhoto, setPreparingPhoto] = useState(false), [error, setError] = useState('');
  const [cashReceived, setCashReceived] = useState(false);
  const isCash = ['cash', 'cod'].includes(order.paymentMethod) && order.paymentStatus!=='paid';
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  const point = e => {
    const canvas = canvasRef.current, rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height];
  };
  const start = e => {
    if (busy) return;
    e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'; ctx.beginPath(); ctx.moveTo(...point(e));
  };
  const draw = e => {
    if (!drawing.current || busy) return;
    const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(...point(e)); ctx.stroke(); setHasSignature(true);
  };
  const submit = async () => {
    if (busyRef.current || preparingPhoto) return;
    if(order.paymentStatus==='partial'){setError('Ask the restaurant to reconcile this partial payment before completing delivery.');return;}
    if (!hasSignature && !photo) { setError('Add a customer signature or delivery photo.'); return; }
    if (isCash && !cashReceived) { setError('Confirm that you collected the delivery cash.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      await onConfirm(order.id, { signature: hasSignature ? canvasRef.current.toDataURL('image/png') : null, photo, cashReceived });
      onClose();
    } catch (e) { setError(e instanceof TypeError ? 'Delivery was not saved. Your evidence is still here; retry when connected.' : e.message || 'Delivery was not saved. Please retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <dialog ref={dialog} className="delivery-proof-dialog" aria-labelledby="proof-title" onCancel={e => { e.preventDefault(); if (!busyRef.current) onClose(); }}>
      <h2 id="proof-title">Confirm delivery</h2>
      <p>Order #{order.id.slice(-4).toUpperCase()} · {order.customerName || 'Customer'}</p>
      <p>Add a signature or photo. Evidence is visible to you and authorized restaurant managers.</p>
      <fieldset disabled={busy || preparingPhoto} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label htmlFor="delivery-signature">Customer signature</label>
          <button type="button" className="btn-outline" onClick={() => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setHasSignature(false); }}>Clear</button>
        </div>
        <canvas id="delivery-signature" ref={canvasRef} width={400} height={150} aria-label="Draw customer signature, or attach a photo below" onPointerDown={start} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} style={{ width: '100%', height: 150, border: '2px dashed #94a3b8', borderRadius: 12, background: '#f8fafc', touchAction: 'none', margin: '8px 0 16px' }} />
        <label htmlFor="delivery-photo">Delivery photo</label>
        <input id="delivery-photo" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          setPreparingPhoto(true); setError('');
          try { setPhoto(await preparePhoto(file)); } catch (err) { setError(err.message); }
          finally { setPreparingPhoto(false); }
        }} style={{ display: 'block', width: '100%', margin: '8px 0' }} />
        {photo && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src={photo} alt="Delivery photo preview" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8 }} /><button type="button" className="btn-outline" onClick={() => setPhoto(null)}>Remove photo</button></div>}
        {isCash && <label style={{ display: 'flex', gap: 10, marginTop: 16 }}><input type="checkbox" checked={cashReceived} onChange={e => setCashReceived(e.target.checked)} />I collected Rs. {Number(order.total).toFixed(2)} from the customer.</label>}
      </fieldset>
      {preparingPhoto && <p role="status">Preparing photo…</p>}
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" className="btn-outline" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn-emerald" disabled={busy || preparingPhoto} onClick={submit} style={{ flex: 1 }}>{busy ? 'Saving delivery…' : 'Save proof and complete delivery'}</button>
      </div>
    </dialog>
  );
}

export function DeliveryProofViewer({ proof, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={dialog} className="delivery-proof-dialog" aria-labelledby="saved-proof-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <h2 id="saved-proof-title">Saved delivery proof</h2>
    <p>Saved {new Date(proof.savedAt).toLocaleString()}</p>
    {proof.signature && <><h3>Signature</h3><img src={proof.signature} alt="Saved customer signature" style={{ width: '100%', background: '#f8fafc' }} /></>}
    {proof.deliveryPhoto && <><h3>Delivery photo</h3><img src={proof.deliveryPhoto} alt="Saved delivery evidence" style={{ maxWidth: '100%', maxHeight: '45vh' }} /></>}
    <button type="button" className="btn-outline" onClick={onClose}>Close</button>
  </dialog>;
}

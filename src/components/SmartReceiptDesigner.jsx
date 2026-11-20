import React, { useEffect, useState } from 'react';
import { DEFAULT_RECEIPT_CONFIG, RECEIPT_CONFIG_KEY, readReceiptConfig, receiptFooterMessage } from '../utils/receipt-settings';
import { resolvePrinterPaperSize, testPrintReceipt } from '../utils/printer';

// Preview uses sample content; it does NOT create a transaction or issue an invoice.
export default function SmartReceiptDesigner({ settings, updateSetting, showToast, nativeConfig, onFeedLinesChange }) {
  const [draft, setDraft] = useState(() => readReceiptConfig(settings));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(readReceiptConfig(settings));
  }, [settings?.[RECEIPT_CONFIG_KEY], dirty]);
  const patch = (key, value) => {
    setDraft(old => ({...old, [key]: value }));
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await updateSetting(RECEIPT_CONFIG_KEY, JSON.stringify(draft));
      setDirty(false);
      showToast('Receipt design saved for this restaurant.', 'success');
    } catch (e) {
      showToast(e.message || 'Could not save receipt design.', 'error');
    } finally { setSaving(false); }
  };
  const paper = resolvePrinterPaperSize(settings?.printerPaperWidth);
  const currency = settings?.currencySymbol || 'Rs.';
  const business = settings?.businessName || settings?.restaurantName || 'Your Restaurant';
  const showLogo = draft.logo && Boolean(settings?.logoUrl || settings?.logo || settings?.restaurantLogo);
  const compact = draft.layout === 'compact';
  const row = { display:'flex', justifyContent:'space-between', gap:7, alignItems:'baseline' };
  const check = (key, title, details) => <label key={key} style={{display:'flex',gap:9,alignItems:'flex-start',fontSize:13,cursor:'pointer'}}>
    <input type="checkbox" checked={draft[key]} onChange={e=>patch(key,e.target.checked)} />
    <span><strong>{title}</strong>{details && <small style={{display:'block',fontSize:11,color:'var(--text-muted)',marginTop:2}}>{details}</small>}</span>
  </label>;
  return <section aria-label="Smart Receipt Designer" style={{marginTop:20,background:'var(--bg-surface)',border:'1px solid var(--border-color)',borderRadius:14,padding:18,maxWidth:900}}>
    <h3 style={{fontSize:17,margin:'0 0 6px'}}>🧾 Smart Receipt Designer · Paper Saver</h3>
    <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>Customize the customer POS receipt for this restaurant. No changes to recorded sales, invoices or taxes. Preview updates instantly; Save applies it to the restaurant's cashiers.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,270px),1fr))',gap:22}}>
      <div style={{display:'grid',gap:13,alignContent:'start'}}>
        <label style={{fontWeight:700,fontSize:12,display:'grid',gap:5}}>Receipt style
          <select className="form-select" value={draft.layout} onChange={e=>patch('layout',e.target.value)}>
            <option value="compact">Paper Saver — compact</option>
            <option value="standard">Standard — comfortable</option>
            <option value="detailed">Detailed — item breakdown</option>
          </select>
        </label>
        <label style={{fontWeight:700,fontSize:12,display:'grid',gap:5}}>Restaurant logo size
          <select className="form-select" value={draft.logoSize} onChange={e=>patch('logoSize',Number(e.target.value))}>
            <option value="32">Extra small · 32px</option><option value="46">Small · 46px</option>
            <option value="64">Medium · 64px</option><option value="80">Large · 80px</option>
          </select>
        </label>
        {check('logo','Show logo','Hidden when the shop has no uploaded logo')}
        {check('showOrderId','Show customer Order ID','A non-sequential support reference')}
        {check('showInvoiceNumber','Show internal invoice number','Default OFF. Enable only when required for the document type and local tax rules.')}
        {check('showUnitPrice','Always show price per unit','For multi-quantity or price-override items the unit price remains visible')}
        {check('showSubtotal','Always show subtotal','When off, still show it if different from the total')}
        {check('hideZeroTax','Hide zero tax lines','Non-zero tax is always printed')}
        {check('platformCredit','Compact platform branding','One line: GastroFlow · RS Nextward')}
        <label style={{fontWeight:700,fontSize:12,display:'grid',gap:5}}>Thank-you footer
          <select className="form-select" value={draft.footer} onChange={e=>patch('footer',e.target.value)}>
            <option value="friendly">Thank you! Visit again! :)</option>
            <option value="simple">Thank you!</option>
            <option value="custom">Custom restaurant message</option>
            <option value="none">No optional footer</option>
          </select>
        </label>
        {draft.footer==='custom' && <label style={{fontSize:12,fontWeight:700,display:'grid',gap:4}}>Message (max 120 characters)
          <input className="form-input" maxLength={120} value={draft.customMessage} onChange={e=>patch('customMessage',e.target.value)} placeholder="See you soon!" />
        </label>}
        <div style={{display:'flex',gap:9,flexWrap:'wrap'}}>
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving?'Saving…':'Save Receipt Design'}</button>
          <button type="button" className="btn btn-outline" onClick={()=>{setDraft({...DEFAULT_RECEIPT_CONFIG});setDirty(true);}}>Reset to Paper Saver</button>
        </div>
        {dirty && <small role="status" style={{color:'var(--text-muted)'}}>Unsaved changes — preview only</small>}
      </div>
      <div>
        <h4 style={{fontSize:13,margin:'0 0 8px'}}>Live sample preview · {paper.toUpperCase()}</h4>
        <div style={{background:'#fff',color:'#111',width:paper==='58mm'?'58mm':paper==='a4'?'100%':'80mm',maxWidth:'100%',margin:'0 auto',padding:compact?'8px 10px':'13px 11px',fontFamily:'Arial, sans-serif',fontSize:paper==='58mm'?10:11,lineHeight:compact?1.2:1.4,boxShadow:'0 6px 24px #0002',overflowWrap:'anywhere'}}>
          <div style={{textAlign:'center'}}>
            {showLogo && <img src={settings?.logoUrl || settings?.logo || settings?.restaurantLogo} alt="" style={{display:'block',width:draft.logoSize,height:draft.logoSize,objectFit:'contain',margin:'0 auto 3px'}}/>}
            <strong style={{fontSize:14}}>{business}</strong>
            {settings?.address && <div>{settings.address}</div>}
            {settings?.phone && <div>Tel: {settings.phone}</div>}
          </div>
          <hr style={{margin:'5px 0',border:'0',borderTop:'1px dashed #777'}}/>
          <div style={{textAlign:'center',fontWeight:800}}>CUSTOMER BILL</div>
          <div style={{marginTop:3}}>20 Nov 2026 · 19:28</div>
          {draft.showOrderId && <div><strong>Order ID: #C0129E</strong></div>}
          {draft.showInvoiceNumber && <div>INV-000238</div>}
          <div>DINE-IN</div>
          <hr style={{margin:'5px 0',border:'0',borderTop:'1px dashed #777'}}/>
          <div style={row}><span>1 × Water Bottle</span><span>{currency}80.00</span></div>
          {(draft.showUnitPrice || draft.layout==='detailed') && <div style={{fontSize:9}}> {currency}80.00 each</div>}
          {(draft.showSubtotal || draft.layout==='detailed') && <div style={{...row,marginTop:4}}><span>Subtotal</span><span>{currency}80.00</span></div>}
          {!draft.hideZeroTax && <div style={row}><span>Tax (0%)</span><span>{currency}0.00</span></div>}
          <hr style={{margin:'5px 0',border:'0',borderTop:'1px solid #333'}}/>
          <div style={{...row,fontWeight:800,fontSize:14}}><span>TOTAL</span><span>{currency}80.00</span></div>
          <div style={{textAlign:'center',marginTop:4}}>Payment: CASH</div>
          {receiptFooterMessage(draft) && <div style={{textAlign:'center',marginTop:3,fontSize:10}}>{receiptFooterMessage(draft)}</div>}
          {draft.platformCredit && <div style={{textAlign:'center',fontSize:9}}>GastroFlow · RS Nextward</div>}
        </div>
        <p style={{fontSize:11,color:'var(--text-muted)',lineHeight:1.5}}>Sample only, not a real invoice. Browser or printer drivers may add feed space. Do not rely on the preview as a regulatory tax invoice.</p>
        <button type="button" className="btn btn-outline" onClick={()=>testPrintReceipt(settings,currency)}>🖨️ Print printer alignment test</button>
      </div>
    </div>
    <div style={{borderTop:'1px solid var(--border-color)',marginTop:18,paddingTop:14}}>
      <h4 style={{fontSize:13,margin:'0 0 6px'}}>Physical thermal feed calibration · this computer only</h4>
      <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>Only used by enabled QZ Tray direct thermal printing. Your printer may require extra feed before the cutter to avoid slicing printed text. Start at 2 lines, then test one slip before changing.</p>
      <label style={{fontSize:12,fontWeight:700,display:'grid',gap:6,maxWidth:270}}>
        Feed before cut: {nativeConfig?.feedLines ?? 2} lines
        <input type="range" min="0" max="6" step="1" value={nativeConfig?.feedLines ?? 2}
          onChange={e=>onFeedLinesChange(Number(e.target.value))}/>
      </label>
      <small style={{fontSize:11,color:'var(--text-muted)'}}>Calibrate with a physical test slip using the QZ Tray controls above. Browser printing uses page dimensions instead.</small>
    </div>
  </section>;
}

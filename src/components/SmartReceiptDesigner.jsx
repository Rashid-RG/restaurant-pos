import React, { useEffect, useState } from 'react';
import { platformPublisher } from '../../shared/platform-brand.js';
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
  const toggle = (key, title, details) => <label key={key} className="receipt-toggle">
    <input type="checkbox" checked={draft[key]} onChange={e=>patch(key,e.target.checked)}/>
    <span><strong>{title}</strong><small>{details}</small></span>
  </label>;
  return <section className="receipt-designer" aria-label="Smart Receipt Designer">
    <div className="receipt-designer-intro">
      <div><h3>Design your perfect receipt</h3><p>A faster, cleaner bill for your customers. Settings sync to this restaurant's cashiers.</p></div>
      <span className="receipt-pill">✓ Paper Saver ready</span>
    </div>
    <div className="receipt-designer-grid">
      <div className="receipt-design-controls">
        <div className="receipt-design-card">
          <div className="receipt-card-head"><h4>01 · Choose a layout</h4><small>Instant preview</small></div>
          <div className="receipt-design-options" role="group" aria-label="Receipt layout">
            {[
              {value:'compact',label:'⚡ Paper Saver',detail:'Shortest clean receipt'},
              {value:'standard',label:'▤ Standard',detail:'A little more breathing room'},
              {value:'detailed',label:'☷ Detailed',detail:'Full item breakdown'}
            ].map(option=><button key={option.value} type="button" aria-pressed={draft.layout===option.value}
              className={`receipt-choice ${draft.layout===option.value?'selected':''}`} onClick={()=>patch('layout',option.value)}>
              <span className="receipt-choice-name">{option.label}</span><span className="receipt-choice-desc">{option.detail}</span>
            </button>)}
          </div>
        </div>
        <div className="receipt-design-card">
          <div className="receipt-card-head"><h4>02 · Shop identity</h4><small>Recognizable and compact</small></div>
          <div className="receipt-form-row">
            <label className="receipt-field">Logo size
              <select className="form-select" value={draft.logoSize} onChange={e=>patch('logoSize',Number(e.target.value))}>
                <option value="32">Extra small · 32px</option><option value="46">Small · 46px</option>
                <option value="64">Medium · 64px</option><option value="80">Large · 80px</option>
              </select>
            </label>
            <div>{toggle('logo','Show restaurant logo','Uses your uploaded shop logo')}</div>
          </div>
          <div className="receipt-private-note">🔒 Sequential invoice numbers stay private. Customer bills can show the non-sequential Order ID without changing accounting records.</div>
        </div>
        <div className="receipt-design-card">
          <div className="receipt-card-head"><h4>03 · Printed details</h4><small>Choose what matters</small></div>
          <div className="receipt-option-list">
            {toggle('showOrderId','Show Order ID','Useful for collecting or checking orders')}
            {toggle('showUnitPrice','Unit price','Always show unit breakdown')}
            {toggle('showSubtotal','Subtotal','Also shown when total differs')}
            {toggle('hideZeroTax','Hide zero tax','Nonzero taxes are always printed')}
          </div>
        </div>
        <div className="receipt-design-card">
          <div className="receipt-card-head"><h4>04 · Customer message</h4><small>A friendly goodbye</small></div>
          <div className="receipt-form-row">
            <label className="receipt-field">Footer style
              <select className="form-select" value={draft.footer} onChange={e=>patch('footer',e.target.value)}>
                <option value="friendly">Thank you! Visit again! :)</option>
                <option value="simple">Thank you!</option>
                <option value="custom">Your own message</option>
                <option value="none">No optional footer</option>
              </select>
            </label>
            {toggle('platformCredit','Platform credit','One compact brand line')}
          </div>
          {draft.footer==='custom' && <label className="receipt-field" style={{marginTop:12}}>Your message
            <input className="form-input" maxLength={120} value={draft.customMessage} onChange={e=>patch('customMessage',e.target.value)} placeholder="See you again soon!"/>
          </label>}
        </div>
        <div className="receipt-design-actions">
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving?'Saving…':'✓ Save receipt design'}</button>
          <button type="button" className="btn btn-outline" onClick={()=>{setDraft({...DEFAULT_RECEIPT_CONFIG});setDirty(true);}}>↺ Reset to Paper Saver</button>
          <span role="status" style={{fontSize:11,color:'var(--text-muted)'}}>{dirty?'Unsaved preview changes':'Design matches saved settings'}</span>
        </div>
      </div>
      <aside className="receipt-preview-panel" aria-label="Live receipt preview">
        <div className="receipt-preview-head"><strong>👁 Live receipt preview</strong><span className="receipt-pill">{paper.toUpperCase()} · Sample</span></div>
        <div className="receipt-preview-stage">
          <div className="receipt-preview-paper" style={{width:paper==='58mm'?'58mm':paper==='a4'?'100%':'80mm',padding:compact?'10px 11px 16px':'15px 11px 21px',fontSize:paper==='58mm'?10:11,lineHeight:compact?1.25:1.48}}>
            <div style={{textAlign:'center'}}>
              {showLogo && <img src={settings?.logoUrl || settings?.logo || settings?.restaurantLogo} alt="" style={{display:'block',maxWidth:draft.logoSize,maxHeight:draft.logoSize,objectFit:'contain',margin:'0 auto 4px'}}/>}
              <strong style={{fontSize:14}}>{business}</strong>
              {settings?.address && <div>{settings.address}</div>}
              {settings?.phone && <div>Tel: {settings.phone}</div>}
            </div>
            <hr style={{margin:'7px 0',border:0,borderTop:'1px dashed #777'}}/>
            <div style={{textAlign:'center',fontWeight:800}}>CUSTOMER BILL</div>
            <div style={{marginTop:5}}>20 Nov 2026 · 19:28</div>
            {draft.showOrderId && <div><strong>Order ID: #C0129E</strong></div>}
            <div>DINE-IN</div>
            <hr style={{margin:'7px 0',border:0,borderTop:'1px dashed #777'}}/>
            <div style={row}><span>1 × Water Bottle</span><span>{currency}80.00</span></div>
            {(draft.showUnitPrice || draft.layout==='detailed') && <div style={{fontSize:9}}>{currency}80.00 each</div>}
            {(draft.showSubtotal || draft.layout==='detailed') && <div style={{...row,marginTop:4}}><span>Subtotal</span><span>{currency}80.00</span></div>}
            {!draft.hideZeroTax && <div style={row}><span>Tax (0%)</span><span>{currency}0.00</span></div>}
            <hr style={{margin:'7px 0',border:0,borderTop:'1px solid #333'}}/>
            <div style={{...row,fontWeight:800,fontSize:14}}><span>TOTAL</span><span>{currency}80.00</span></div>
            <div style={{textAlign:'center',marginTop:5}}>Payment: CASH</div>
            {receiptFooterMessage(draft) && <div style={{textAlign:'center',marginTop:4,fontSize:10}}>{receiptFooterMessage(draft)}</div>}
            {draft.platformCredit && <div style={{textAlign:'center',fontSize:9}}>GastroFlow · {platformPublisher}</div>}
          </div>
          <span style={{fontSize:11,color:'#375e4a',fontWeight:700}}>Preview only · No transaction created</span>
        </div>
        <div className="receipt-preview-foot">
          <button type="button" className="btn btn-outline" onClick={()=>testPrintReceipt(settings,currency)}>🖨️ Print alignment slip</button>
          <p>Physical paper feed varies by printer and Windows driver. Test a real customer bill after saving. Invoice numbers are kept internal.</p>
        </div>
      </aside>
    </div>
    <div className="receipt-feed-card">
      <h4>⚙️ Direct printer calibration</h4>
      <p>QZ Tray direct printing only, per workstation. Start with two feed lines, test a slip and keep enough clearance for the cutter. Browser printing uses its own content-sized page.</p>
      <label className="receipt-field" style={{maxWidth:380}}>
        Feed before cut · {nativeConfig?.feedLines ?? 2} lines
        <input type="range" min="0" max="6" step="1" value={nativeConfig?.feedLines ?? 2} onChange={e=>onFeedLinesChange(Number(e.target.value))}/>
      </label>
      <p>Changing calibration disables direct printing until it is tested and re-enabled in the Hardware tab.</p>
    </div>
  </section>;
}

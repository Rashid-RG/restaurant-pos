// GastroMate customer-tracking UI trust boundary.
// Never send account-owned order data to an LLM or store it as chat history.
const TERMINAL = new Set(['delivered','completed','cancelled','rejected','refunded','partially_refunded']);
export function isTrackingIntent(value) {
  const text=String(value || '').toLowerCase();
  return /\b(track(?:ing)?(?:\s+my)?(?:\s+order)?|where(?:'s| is) my order|order status|my orders?|delivery status|where(?:'s| is) (?:my |the )?driver)\b/i.test(text);
}
export function selectTrackableOrders(data) {
  if (!Array.isArray(data)) return [];
  const orders=data.filter(o=>o && typeof o.id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(o.id));
  const ranked=orders.map((order,index)=>({order,index,terminal:TERMINAL.has(String(order.status||'').toLowerCase())}))
    .sort((a,b)=>Number(a.terminal)-Number(b.terminal) || a.index-b.index);
  return ranked.slice(0,6).map(({order})=>{
    const status=String(order.status||'pending').replace(/[_-]/g,' ').trim().slice(0,45);
    const stamp=Number(order.timestamp);
    const date=Number.isFinite(stamp)&&stamp>0&&stamp<4102444800000
      ? new Date(stamp).toLocaleDateString('en-LK') : 'Recent order';
    return {
      id:order.id,
      label:order.id.slice(-8),
      statusLabel:status||'Pending',
      dateLabel:date
    };
  });
}
export function safeOrderChoice(order, trustedChoices) {
  if(!order || !Array.isArray(trustedChoices))return null;
  const chosen=trustedChoices.find(candidate=>candidate.id===order.id);
  return chosen||null;
}

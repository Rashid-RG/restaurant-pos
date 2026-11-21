// Order-confirmation labels are derived from the server's actual status,
// never from an OTP success or client-side payment callback.
export function confirmationIsClosed(status){
  return ['cancelled','rejected','refunded','partially_refunded'].includes(String(status||'').toLowerCase());
}
export function confirmationPaymentLabel(order={}){
  const state=String(order.paymentStatus||'').toLowerCase();
  const method=String(order.paymentMethod||'').toLowerCase();
  if(state==='paid')return 'Payment confirmed';
  if(method==='bank_transfer')return 'Bank transfer awaiting verification';
  if(method==='cash')return 'Pay at handover / collection';
  if(state==='pending')return 'Payment pending';
  return 'Payment status: '+(state||'not confirmed');
}
export function confirmationTotal(order={}){
  if(order.total===null||order.total===undefined||order.total==='')return null;
  const amount=Number(order.total);
  return Number.isFinite(amount)&&amount>=0?amount:null;
}

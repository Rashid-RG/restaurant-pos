// Pure, UI-only stage validation. The server remains authoritative for prices,
// restaurant availability, fulfilment, OTP and order creation.
export const CHECKOUT_STEPS=Object.freeze([
  {id:'cart',label:'Cart'},
  {id:'fulfilment',label:'Fulfilment'},
  {id:'details',label:'Details'},
  {id:'payment',label:'Payment'},
  {id:'confirm',label:'Confirm'}
]);
export function checkoutStepIssue(step,data={}){
  if(step===0) return data.hasItems?'':'Add an item to your cart before continuing.';
  if(step===1){
    if(data.modePaused)return 'This order method is currently unavailable.';
    if(data.kitchenClosed&&!data.isScheduled)return 'Choose a scheduled order time while the kitchen is closed.';
    if(data.isScheduled&&!data.scheduledTimeVal)return data.scheduleError||'Choose an available scheduled time.';
    if(data.scheduleLoading||data.scheduleError)return data.scheduleError||'Checking restaurant time slots.';
    return '';
  }
  if(step===2){
    if(!String(data.name||'').trim())return 'Enter your name to continue.';
    if(!/^(?:\+94|0)7\d{8}$/.test(String(data.phone||'').trim().replace(/[\s-]/g,'')))return 'Enter a valid Sri Lankan mobile number.';
    if(data.orderType==='delivery'){
      if(!data.entranceConfirmed)return 'Confirm your delivery entrance on the map.';
      if(!data.deliveryQuoteConfirmed)return 'Wait for a confirmed delivery fee and coverage quote.';
      if(data.minimumOrder>data.subtotal)return 'Add more items to meet the minimum delivery order.';
    }
    return '';
  }
  if(step===3){
    if(!['cash','bank_transfer','payhere'].includes(data.paymentMethod))return 'Choose an available payment option.';
    if(data.paymentMethod==='payhere'&&data.cardUnavailable)return 'Card payment is not available. Select cash or bank transfer.';
    return '';
  }
  return '';
}

/** Item review uses the exact modifier-inclusive unit price stored by the cart.
 * The final payable amount is still calculated and verified by the server. */
export function checkoutReviewLineAmount(item={}){
  const quantity=Number(item.qty||0);
  const unitPrice=Number(item.unitPrice??item.price??0);
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0)return 0;
  return Math.round((unitPrice*quantity+Number.EPSILON)*100)/100;
}

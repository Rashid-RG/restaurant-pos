// Order recovery may return an existing unpaid order. Never present that as paid.
export function recoveryDecision(order, paymentMethod = 'cash') {
  if (!order || !order.orderId) return {action:'retry',message:'No order confirmation was returned. Your cart is preserved.'};
  const status = String(order.status || '').toLowerCase();
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  if (['cancelled','rejected','refunded','partially_refunded'].includes(status))
    return {action:'track',clearCart:false,message:'This order already exists but is closed. See its current status.'};
  if (paymentStatus === 'paid') return {action:'track',clearCart:true,message:'Payment confirmed. Opening your existing order.'};
  if (paymentMethod === 'payhere' || paymentMethod === 'online_pending')
    return {action:'track',clearCart:false,message:'The order exists, but online payment is not confirmed. Check its payment status before trying again.'};
  return {action:'track',clearCart:true,message:'Your existing order has been found. Opening order tracking.'};
}

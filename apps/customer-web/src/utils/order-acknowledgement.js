// Order submission acknowledgements must reference the server's actual order.
// A transport success (HTTP 200) without an order ID is not order acceptance.
export function validOrderAcknowledgement(response) {
  return Boolean(response && typeof response.orderId === 'string' &&
    response.orderId.trim().length > 0 && response.orderId.length <= 256);
}

export function shouldClearCartAfterSubmit(response, method) {
  if (!validOrderAcknowledgement(response)) return false;
  const status=String(response.status||'').toLowerCase();
  if (['cancelled','rejected','refunded','partially_refunded'].includes(status)) return false;
  if (method==='payhere' || method==='online_pending') return response.paymentStatus==='paid';
  // A successfully created COD or bank-transfer order is not a paid order:
  // the cart can close after authoritative acknowledgement, but don't claim settlement.
  return method==='cash' || method==='bank_transfer';
}

// The status comes from the committed server order state, never a client's claim.
// An unrecognised status is deliberately not sent as a push notification.
const PUSH_MESSAGES=Object.freeze({
  pending:{title:'Order received',body:'Your order was received. Waiting for restaurant confirmation.'},
  confirmed:{title:'Order confirmed',body:'The restaurant has confirmed your order.'},
  accepted:{title:'Order accepted',body:'Your order was accepted by the restaurant.'},
  preparing:{title:'Your food is being prepared',body:'The kitchen is preparing your order.'},
  ready:{title:'Order ready',body:'Your order is ready for collection or rider pickup.'},
  driver_assigned:{title:'Rider assigned',body:'A delivery rider has been assigned to your order.'},
  picked_up:{title:'Rider collected your order',body:'Your rider has collected the food from the restaurant.'},
  out_for_delivery:{title:'Your order is on the way',body:'Your rider is travelling to your delivery address.'},
  arrived:{title:'Rider has arrived',body:'Your rider has reported arrival at the delivery destination.'},
  delivered:{title:'Delivery completed',body:'Your order has been marked delivered.'},
  completed:{title:'Order completed',body:'Your order has been marked completed.'},
  cancelled:{title:'Order cancelled',body:'This order has been cancelled. Check tracking for details.'},
  rejected:{title:'Order not accepted',body:'The restaurant could not accept this order. Check tracking for details.'}
});
export function orderPushMessage(status){
  return Object.hasOwn(PUSH_MESSAGES,status) ? PUSH_MESSAGES[status] : null;
}
// Persisted receipt key scopes deduplication to the subscription, tenant and order.
// Different tracked orders and different browsers must not suppress one another.
export function pushReceiptKey(tenantId,orderId,endpointHash,status){
  const message=orderPushMessage(status);
  if(!message||!tenantId||!orderId||!endpointHash)return null;
  return [tenantId,orderId,endpointHash,status].join(':');
}

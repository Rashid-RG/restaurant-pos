import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
const cookieName=id=>'gastro_track_'+crypto.createHash('sha256').update(id).digest('hex').slice(0,20);
export const makeTrackingAccess=(orderId,tenantId)=>jwt.sign({type:'order_tracking',orderId,tenantId},process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{expiresIn:'7d',algorithm:'HS256'});
export function createTrackingGuard({dbGet,resolvePublicTenant,authenticateToken,authenticateDriver}){
 return async(req,res,next)=>{try{
  const id=req.params.id,tenant=await resolvePublicTenant(req);
  req.trackingTenant=tenant;
  const order=await dbGet('SELECT id,tenant_id,customerAccountId,driverId FROM orders WHERE id=? AND tenant_id=?',[id,tenant]);
  if(!order)return res.status(404).json({error:'Order not found.'});
  const bearer=req.headers.authorization?.split(' ')[1];
  if(bearer){
   let customer;try{customer=jwt.verify(bearer,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']})}catch{}
   if(customer?.type==='customer'&&customer.id===order.customerAccountId&&await dbGet('SELECT id FROM customer_accounts WHERE id=?',[customer.id])){req.trackingActor={type:'customer',id:customer.id};req.trackingExpiresAt=customer.exp*1000;res.cookie(cookieName(id),makeTrackingAccess(id,tenant),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/stream/orders/'+encodeURIComponent(id),maxAge:7*86400000});return next();}
   let claims;try{claims=jwt.verify(bearer,process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']})}catch{}
   if(claims?.role==='driver')return authenticateDriver(req,res,error=>error?next(error):req.driver.driverId===order.driverId&&req.tenantId===tenant?next():res.status(404).json({error:'Order not found.'}));
   if(claims?.id&&claims.type!=='customer')return authenticateToken(req,res,error=>error?next(error):req.tenantId===tenant?next():res.status(404).json({error:'Order not found.'}));
  }
  const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(item=>{const index=item.indexOf('=');return [item.slice(0,index).trim(),item.slice(index+1)]}));
  const access=req.headers['x-order-tracking']||cookies[cookieName(id)];
  try{const claims=jwt.verify(access,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']});if(claims.type!=='order_tracking'||claims.orderId!==id||claims.tenantId!==tenant)throw Error();req.trackingActor={type:'capability'};req.trackingExpiresAt=claims.exp*1000;}catch{return res.status(401).json({error:'Use the private access from your order confirmation or sign in to the owning account.'})}
  res.cookie(cookieName(id),access,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/stream/orders/'+encodeURIComponent(id),maxAge:7*86400000});next();
 }catch(error){next(error)}};
}

// Public customer tracking SSE must never serialize an unrestricted database row.
// Only the same customer-facing order fields as GET /api/public/orders/:id
// and the two explicit rider event envelopes may enter a customer stream.
const CUSTOMER_ORDER_FIELDS = [
  'id','diningType','orderType','subtotal','tax','total','status','timestamp',
  'paymentMethod','deliveryAddress','deliveryLat','deliveryLng','etaMinutes',
  'acceptedAt','rejectedReason','customerName','customerPhone','invoiceNumber',
  'paymentStatus','items'
];
const LOCATION_FIELDS = ['lat','lng','driverName','updatedAt','accuracyMeters'];
export function publicTrackingEvent(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.type === 'driver_location') {
    const event = {type:'driver_location'};
    for (const field of LOCATION_FIELDS) if (Object.hasOwn(data,field)) event[field]=data[field];
    return event;
  }
  if (data.type === 'driver_assigned') {
    return typeof data.orderId==='string' ? {type:'driver_assigned',orderId:data.orderId} : null;
  }
  if (typeof data.id!=='string') return null;
  const event={};
  for(const field of CUSTOMER_ORDER_FIELDS) if(Object.hasOwn(data,field))event[field]=data[field];
  return event;
}

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
const cookieName=id=>'gastro_track_'+crypto.createHash('sha256').update(id).digest('hex').slice(0,20);
export const makeTrackingAccess=(orderId,tenantId)=>jwt.sign({type:'order_tracking',orderId,tenantId},process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{expiresIn:'7d',algorithm:'HS256'});
export function createTrackingGuard({dbGet,resolvePublicTenant,authenticateToken,authenticateDriver}){
 return async(req,res,next)=>{try{
  const id=req.params.id,tenant=await resolvePublicTenant(req);
  const order=await dbGet('SELECT id,tenant_id,customerAccountId,driverId FROM orders WHERE id=? AND tenant_id=?',[id,tenant]);
  if(!order)return res.status(404).json({error:'Order not found.'});
  const bearer=req.headers.authorization?.split(' ')[1];
  if(bearer){
   let customer;try{customer=jwt.verify(bearer,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']})}catch{}
   if(customer?.type==='customer'&&customer.id===order.customerAccountId&&await dbGet('SELECT id FROM customer_accounts WHERE id=?',[customer.id])){res.cookie(cookieName(id),makeTrackingAccess(id,tenant),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/stream/orders/'+encodeURIComponent(id),maxAge:7*86400000});return next();}
   let claims;try{claims=jwt.verify(bearer,process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']})}catch{}
   if(claims?.role==='driver')return authenticateDriver(req,res,error=>error?next(error):req.driver.driverId===order.driverId&&req.tenantId===tenant?next():res.status(404).json({error:'Order not found.'}));
   if(claims?.id&&claims.type!=='customer')return authenticateToken(req,res,error=>error?next(error):req.tenantId===tenant?next():res.status(404).json({error:'Order not found.'}));
  }
  const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(item=>{const index=item.indexOf('=');return [item.slice(0,index).trim(),item.slice(index+1)]}));
  const access=req.headers['x-order-tracking']||cookies[cookieName(id)];
  try{const claims=jwt.verify(access,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']});if(claims.type!=='order_tracking'||claims.orderId!==id||claims.tenantId!==tenant)throw Error();}catch{return res.status(401).json({error:'Use the private access from your order confirmation or sign in to the owning account.'})}
  res.cookie(cookieName(id),access,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/stream/orders/'+encodeURIComponent(id),maxAge:7*86400000});next();
 }catch(error){next(error)}};
}

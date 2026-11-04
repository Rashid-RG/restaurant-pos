// Revalidate long-lived streams before each event. A connection must not retain
// access after an account is removed, a driver is reassigned or a tenant stops.
export function createLiveAccessCheck({dbGet,actor,tenantId,orderId,expiresAt,now=Date.now}){
 return async()=>{
  if(expiresAt&&expiresAt<=now())return false;
  const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tenantId]);
  if(!tenant||tenant.status!=='active')return false;
  const contract=await dbGet('SELECT status,paidThrough FROM saas_contracts WHERE tenant_id=?',[tenantId]);
  if(contract?.paidThrough&&(contract.status==='review_required'||contract.paidThrough+7*86400000<now()))return false;
  if(!actor)return !orderId; // Only the public store stream has no identity.
  const order=orderId&&await dbGet('SELECT tenant_id,customerAccountId,driverId FROM orders WHERE id=?',[orderId]);
  if(orderId&&(!order||order.tenant_id!==tenantId))return false;
  if(actor.type==='capability')return Boolean(order);
  if(actor.type==='customer'){
   const account=await dbGet('SELECT tenant_id FROM customer_accounts WHERE id=?',[actor.id]);return account?.tenant_id===tenantId&&order?.customerAccountId===actor.id;
  }
  if(actor.type==='driver'){
   const driver=await dbGet('SELECT status FROM drivers WHERE id=? AND tenant_id=?',[actor.id,tenantId]);return !!driver&&['available','active','busy','offline'].includes(driver.status)&&order?.driverId===actor.id;
  }
  const staff=await dbGet('SELECT tenant_id,role FROM users WHERE id=?',[actor.id]);return staff?.tenant_id===tenantId&&['owner','manager','cashier','kitchen','staff'].includes(staff.role);
 };
}

import {describe,it,expect,vi,afterEach} from 'vitest';
import jwt from 'jsonwebtoken';
import {createTrackingGuard,makeTrackingAccess} from '../lib/order-tracking.js';
import {createLiveAccessCheck} from '../lib/live-access.js';

const secret='gastrofood-N1-test-key';
const tenant='restaurant-a';
const order={id:'order-a',tenant_id:tenant,customerAccountId:'customer-a',driverId:'driver-a'};
const secretEnv=process.env.CUSTOMER_JWT_SECRET;
afterEach(()=>{if(secretEnv===undefined)delete process.env.CUSTOMER_JWT_SECRET;else process.env.CUSTOMER_JWT_SECRET=secretEnv;});

function response(){
 const res={statusCode:200,cookies:[],body:null};
 res.status=vi.fn(code=>{res.statusCode=code;return res;});
 res.json=vi.fn(body=>{res.body=body;return res;});
 res.cookie=vi.fn((...args)=>{res.cookies.push(args);return res;});
 return res;
}
function harness({selectedTenant=tenant,selectedOrder=order,headers={}}={}){
 process.env.CUSTOMER_JWT_SECRET=secret;
 const req={params:{id:'order-a'},headers,query:{tenantId:selectedTenant}};
 const res=response();
 const dbGet=vi.fn(async(sql,args)=>{
   if(sql.includes('FROM orders'))return selectedOrder?.tenant_id===args[1]&&selectedOrder?.id===args[0]?selectedOrder:null;
   if(sql.includes('FROM customer_accounts'))return args[0]==='customer-a'?{id:'customer-a'}:null;
   return null;
 });
 const next=vi.fn();
 const guard=createTrackingGuard({dbGet,resolvePublicTenant:async r=>r.query.tenantId,
  authenticateToken:()=>{throw Error('unexpected staff authentication');},
  authenticateDriver:()=>{throw Error('unexpected driver authentication');}
 });
 return {req,res,dbGet,next,run:()=>guard(req,res,next)};
}
describe('N1 private order tracking capabilities',()=>{
 it('allows a scoped, unexpired guest capability and sets httpOnly SSE cookie',async()=>{
  const token=makeTrackingAccess(order.id,tenant);
  const h=harness({headers:{'x-order-tracking':token}});
  await h.run();expect(h.next).toHaveBeenCalledOnce();
  expect(h.res.statusCode).toBe(200);
  expect(h.res.cookies[0][2]).toMatchObject({httpOnly:true,sameSite:'strict',path:'/api/stream/orders/order-a'});
  expect(h.req.trackingActor).toEqual({type:'capability'});
 });
 it('denies an order ID without a private capability',async()=>{
  const h=harness();await h.run();
  expect(h.res.statusCode).toBe(401);expect(h.next).not.toHaveBeenCalled();
 });
 it('rejects expired, wrong-tenant and wrong-order signed capabilities',async()=>{
  const tokens=[
   jwt.sign({type:'order_tracking',orderId:order.id,tenantId:tenant},secret,{expiresIn:-2}),
   makeTrackingAccess(order.id,'restaurant-b'),
   makeTrackingAccess('order-b',tenant)
  ];
  for(const token of tokens){
   const h=harness({headers:{'x-order-tracking':token}});await h.run();
   expect(h.res.statusCode).toBe(401);expect(h.next).not.toHaveBeenCalled();
  }
 });
 it('denies probing an order from a different restaurant before capability authorization',async()=>{
  const h=harness({selectedTenant:'restaurant-b',headers:{'x-order-tracking':makeTrackingAccess(order.id,tenant)}});
  await h.run();expect(h.res.statusCode).toBe(404);expect(h.next).not.toHaveBeenCalled();
 });
 it('allows only the owning customer account and rejects a different account',async()=>{
  const owner=jwt.sign({type:'customer',id:'customer-a'},secret,{expiresIn:'1h'});
  const allowed=harness({headers:{authorization:'Bearer '+owner}});await allowed.run();
  expect(allowed.next).toHaveBeenCalledOnce();expect(allowed.req.trackingActor).toEqual({type:'customer',id:'customer-a'});
  const stranger=jwt.sign({type:'customer',id:'customer-b'},secret,{expiresIn:'1h'});
  const denied=harness({headers:{authorization:'Bearer '+stranger}});await denied.run();
  expect(denied.res.statusCode).toBe(401);expect(denied.next).not.toHaveBeenCalled();
 });
});
describe('N1 long-lived stream revalidation',()=>{
 function createCheck({driver='driver-a',tenantStatus='active',clock=1000,expiresAt=2000,account='customer-a',orderTenant=tenant}={}){
  const dbGet=vi.fn(async(sql,args)=>{
   if(sql.includes('FROM tenants'))return {status:tenantStatus};
   if(sql.includes('FROM saas_contracts'))return null;
   if(sql.includes('FROM orders'))return {tenant_id:orderTenant,customerAccountId:account,driverId:driver};
   if(sql.includes('FROM drivers'))return {status:'available'};
   if(sql.includes('FROM customer_accounts'))return {tenant_id:tenant};
   return null;
  });
  const make=(actor)=>createLiveAccessCheck({dbGet,actor,tenantId:tenant,orderId:order.id,expiresAt,now:()=>clock});
  return {dbGet,make};
 }
 it('closes a stream once its capability expires',async()=>{
  expect(await createCheck({clock:2000}).make({type:'capability'})()).toBe(false);
  expect(await createCheck({clock:1999}).make({type:'capability'})()).toBe(true);
 });
 it('closes the stream if its tenant is suspended or order moved',async()=>{
  expect(await createCheck({tenantStatus:'suspended'}).make({type:'capability'})()).toBe(false);
  expect(await createCheck({orderTenant:'restaurant-b'}).make({type:'capability'})()).toBe(false);
 });
 it('revokes the previous assigned driver after reassignment',async()=>{
  const check=createCheck({driver:'driver-b'});
  expect(await check.make({type:'driver',id:'driver-a'})()).toBe(false);
  expect(await check.make({type:'driver',id:'driver-b'})()).toBe(true);
 });
 it('rejects an unrelated customer on every event',async()=>{
  const check=createCheck();
  expect(await check.make({type:'customer',id:'customer-b'})()).toBe(false);
  expect(await check.make({type:'customer',id:'customer-a'})()).toBe(true);
 });
});

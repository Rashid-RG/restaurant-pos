import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

export function createOrderChatRouter({dbGet,dbAll,dbRun,authenticateToken,authenticateCustomer,authenticateDriver,broadcastEvent,rateLimiter}) {
 const router=express.Router();
 const identify=(req,res,next)=>{
  const bearer=req.headers.authorization?.split(' ')[1];if(!bearer)return res.status(401).json({error:'Authentication required.'});
  const hint=jwt.decode(bearer);
  if(hint?.type==='customer')return authenticateCustomer(req,res,next);
  if(hint?.role==='driver')return authenticateDriver(req,res,next);
  return authenticateToken(req,res,next);
 };
 const authorize=async(req,res,next)=>{try{
  const order=await dbGet('SELECT id,tenant_id,customerAccountId,driverId FROM orders WHERE id=?',[req.params.id]);
  if(!order)return res.status(404).json({error:'Order not found.'});
  const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[order.tenant_id]);
  if(!tenant||tenant.status==='suspended')return res.status(403).json({error:'Restaurant unavailable.'});
  if(req.customer){
   const account=await dbGet('SELECT id,name FROM customer_accounts WHERE id=?',[req.customer.id]);
   if(!account||order.customerAccountId!==account.id)return res.status(404).json({error:'Order not found.'});
   req.chatActor={type:'customer',name:account.name};
  }else if(req.driver){
   if(req.driver.tenant_id!==order.tenant_id||req.driver.driverId!==order.driverId)return res.status(404).json({error:'Order not found.'});
   const driver=await dbGet('SELECT name FROM drivers WHERE id=? AND tenant_id=?',[req.driver.driverId,order.tenant_id]);req.chatActor={type:'driver',name:driver.name};
  }else{
   if(req.tenantId!==order.tenant_id)return res.status(404).json({error:'Order not found.'});
   const permitted=req.method==='GET'?['owner','manager','cashier','kitchen']:['owner','manager'];
   if(!permitted.includes(req.user.role))return res.status(403).json({error:'This staff role cannot use order chat.'});
   req.chatActor={type:'staff',name:req.user.username};
  }
  req.chatTenant=order.tenant_id;next();
 }catch(error){next(error)}};
 router.use('/orders/:id/driver-chat',rateLimiter,identify,authorize);
 router.get('/orders/:id/driver-chat',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await dbAll('SELECT id,senderType,senderName,message,createdAt FROM driver_customer_chats WHERE orderId=? ORDER BY createdAt,id',[req.params.id]));}catch(error){next(error)}});
 router.post('/orders/:id/driver-chat',async(req,res,next)=>{try{
  const message=req.body?.message;if(typeof message!=='string'||!message.trim()||message.length>1000)return res.status(400).json({error:'Write a message of up to 1,000 characters.'});
  const id=crypto.randomUUID();await dbRun('INSERT INTO driver_customer_chats (id,orderId,senderType,senderName,message,createdAt) VALUES (?,?,?,?,?,?)',[id,req.params.id,req.chatActor.type,req.chatActor.name,message.trim(),Date.now()]);
  broadcastEvent('driver_chat_message',{orderId:req.params.id,messageId:id,senderType:req.chatActor.type,senderName:req.chatActor.name,message:message.trim()},req.chatTenant);
  res.status(201).json({success:true,messageId:id});
 }catch(error){next(error)}});
 return router;
}

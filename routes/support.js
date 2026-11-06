import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const columns = 'id,orderId,customerName,issueCategory,message,status,createdAt,resolvedAt';

export function createSupportRouter({dbGet,dbAll,dbRun,authenticateToken,requireRole,resolvePublicTenant,notifyPOS,rateLimiter}) {
 const router=express.Router();
 if(rateLimiter)router.use(['/public/support/tickets','/customer/support/tickets'],rateLimiter);
 const staff=['/tickets','/support/tickets'];
 router.use(staff,authenticateToken,requireRole(['owner','manager','cashier']));
 const identity=async req=>{
  const token=req.headers.authorization?.split(' ')[1];
  if(!token)return null;
  const claims=jwt.verify(token,process.env.CUSTOMER_JWT_SECRET||process.env.JWT_SECRET||'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION',{algorithms:['HS256']});
  if(claims.type!=='customer'||!claims.id)throw new Error('Customer authentication required.');
  const account=await dbGet('SELECT id,name,phone,email FROM customer_accounts WHERE id=?',[claims.id]);
  if(!account)throw new Error('Customer account unavailable.');
  return account;
 };
 const authorize=async(req,res)=>{
  const tenantId=req.user?.tenant_id||await resolvePublicTenant(req);
  const ticket=await dbGet('SELECT * FROM support_tickets WHERE id=? AND tenant_id=?',[req.params.id||req.query.id,tenantId]);
  if(!ticket){res.status(404).json({error:'Ticket not found.'});return null;}
  if(req.user)return {ticket,senderType:'staff',senderName:req.user.username};
  let customer;try{customer=await identity(req);}catch{res.status(401).json({error:'Customer authentication required.'});return null;}
  const access=req.headers['x-support-token'];
  const validGuest=typeof access==='string'&&access.length<=128&&ticket.guestAccessHash&&digest(access)===ticket.guestAccessHash;
  if(!(customer&&ticket.customerAccountId===customer.id)&&!validGuest){res.status(404).json({error:'Ticket not found.'});return null;}
  return {ticket,senderType:'customer',senderName:customer?.name||ticket.customerName||'Customer'};
 };
 router.get(staff,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await dbAll('SELECT id,tenant_id,orderId,customerName,customerPhone,customerEmail,issueCategory,message,status,createdAt,resolvedAt FROM support_tickets WHERE tenant_id=? ORDER BY createdAt DESC LIMIT 100',[req.tenantId]));}catch(e){next(e)}});
 const publicPaths=['/public/support/tickets','/customer/support/tickets'];
 router.get(publicPaths,async(req,res,next)=>{try{
  if(req.query.id){const context=await authorize(req,res);if(!context)return;const{guestAccessHash,customerAccountId,...ticket}=context.ticket;return res.set('Cache-Control','no-store').json([ticket]);}
  let customer;try{customer=await identity(req)}catch{return res.status(401).json({error:'Sign in to view tickets.'})}
  if(!customer)return res.status(401).json({error:'Sign in or use the private access for your ticket.'});
  const tid=await resolvePublicTenant(req);
  res.set('Cache-Control','no-store').json(await dbAll(`SELECT ${columns} FROM support_tickets WHERE tenant_id=? AND customerAccountId=? ORDER BY createdAt DESC LIMIT 100`,[tid,customer.id]));
 }catch(e){next(e)}});
 router.post(publicPaths,async(req,res,next)=>{
  const{message,orderId,issueCategory='general'}=req.body||{};
  if(typeof message!=='string'||!message.trim()||message.length>5000)return res.status(400).json({error:'Write a message of up to 5,000 characters.'});
  let tx=false;
  try{
   let customer;try{customer=await identity(req)}catch{return res.status(401).json({error:'Customer authentication required.'})}
   const tid=await resolvePublicTenant(req);const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
   if(!tenant||tenant.status==='suspended')return res.status(403).json({error:'Restaurant is unavailable.'});
   if(orderId){const order=customer&&await dbGet('SELECT id FROM orders WHERE id=? AND tenant_id=? AND customerAccountId=?',[orderId,tid,customer.id]);if(!order)return res.status(404).json({error:'Sign in with the account that owns this order to link it.'});}
   const id=`tkt_${crypto.randomUUID()}`,access=crypto.randomBytes(32).toString('hex'),name=customer?.name||String(req.body.name||'Guest').slice(0,120);
   await dbRun('BEGIN TRANSACTION');tx=true;
   await dbRun('INSERT INTO support_tickets (id,tenant_id,orderId,customerAccountId,guestAccessHash,customerName,customerPhone,customerEmail,issueCategory,message,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,tid,orderId||null,customer?.id||null,customer?null:digest(access),name,customer?.phone||null,customer?.email||null,String(issueCategory).slice(0,80),message.trim(),'open',Date.now()]);
   await dbRun('INSERT INTO support_ticket_messages (id,ticketId,senderType,senderName,message,createdAt) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),id,'customer',name,message.trim(),Date.now()]);
   await dbRun('COMMIT');tx=false;notifyPOS({type:'support_ticket_created',ticketId:id},tid);
   res.set('Cache-Control','no-store').status(201).json({success:true,ticketId:id,...(!customer?{accessToken:access}:{})});
  }catch(e){if(tx)await dbRun('ROLLBACK');next(e)}
 });
 const threads=['/tickets/:id/messages','/support/tickets/:id/messages','/public/support/tickets/:id/messages','/customer/support/tickets/:id/messages'];
 router.get(threads,async(req,res,next)=>{try{const context=await authorize(req,res);if(!context)return;res.set('Cache-Control','no-store').json(await dbAll('SELECT id,senderType,senderName,message,createdAt FROM support_ticket_messages WHERE ticketId=? ORDER BY createdAt,id',[context.ticket.id]));}catch(e){next(e)}});
 router.post(threads,async(req,res,next)=>{try{
  const context=await authorize(req,res);if(!context)return;
  const message=req.body?.message;if(typeof message!=='string'||!message.trim()||message.length>5000)return res.status(400).json({error:'Write a message of up to 5,000 characters.'});
  const id=crypto.randomUUID();await dbRun('INSERT INTO support_ticket_messages (id,ticketId,senderType,senderName,message,createdAt) VALUES (?,?,?,?,?,?)',[id,context.ticket.id,context.senderType,context.senderName,message.trim(),Date.now()]);
  notifyPOS({type:'support_ticket_updated',ticketId:context.ticket.id},context.ticket.tenant_id);
  res.status(201).json({success:true,messageId:id});
 }catch(e){next(e)}});
 router.post(['/tickets/:id/resolve','/support/tickets/:id/resolve'],async(req,res,next)=>{try{const context=await authorize(req,res);if(!context)return;await dbRun("UPDATE support_tickets SET status='resolved',resolvedAt=? WHERE id=? AND tenant_id=?",[Date.now(),context.ticket.id,req.tenantId]);res.json({success:true});}catch(e){next(e)}});
 return router;
}

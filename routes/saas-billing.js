import express from 'express';
import crypto from 'node:crypto';
import {z} from 'zod';
import {PLANS} from '../lib/plans.js';
import {billingEnabled,billingConfig,recurringCheckout,validSubscriptionNotification,nextBillingMonth,createPayhereSubscriptionProvider} from '../lib/saas-billing.js';
export async function initSaasBilling(dbRun){
 await dbRun('CREATE TABLE IF NOT EXISTS saas_contracts (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL UNIQUE,plan TEXT NOT NULL,amountCents INTEGER NOT NULL,status TEXT NOT NULL,providerSubscriptionId TEXT UNIQUE,paidThrough BIGINT,createdAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL)');
 await dbRun('CREATE TABLE IF NOT EXISTS saas_invoices (id TEXT PRIMARY KEY,contractId TEXT NOT NULL,tenant_id TEXT NOT NULL,providerPaymentId TEXT NOT NULL UNIQUE,amountCents INTEGER NOT NULL,status TEXT NOT NULL,verifiedAt BIGINT NOT NULL)');
}
const contactSchema=z.object({plan:z.enum(['basic','pro','enterprise']),first_name:z.string().trim().min(1).max(100),last_name:z.string().trim().min(1).max(100),email:z.string().email(),phone:z.string().min(7).max(30),address:z.string().trim().min(3).max(200),city:z.string().trim().min(2).max(100)}).strict();
export function createSaasBillingRouter({dbGet,dbAll,dbRun,authenticateToken,requireRole,provider=createPayhereSubscriptionProvider(),env=process.env}){
 const router=express.Router();
 // No webhook metadata controls entitlement without independent provider retrieval.
 router.post('/saas/billing/payhere/notify',async(req,res,next)=>{
  if(!billingEnabled(env))return res.status(503).json({error:'Subscription billing disabled.'});
  if(!validSubscriptionNotification(req.body,env))return res.status(400).json({error:'Invalid billing notification.'});
  let tx=false;
  try{
   const original=await dbGet('SELECT * FROM saas_contracts WHERE id=?',[req.body.order_id]);if(!original)return res.status(404).json({error:'Subscription not found.'});
   const subscriptionId=String(req.body.subscription_id||'');if(!/^\d{1,40}$/.test(subscriptionId))return res.status(400).json({error:'Invalid subscription reference.'});
   const subscription=await provider.subscription(subscriptionId);
   if(String(subscription.order_id)!==original.id||subscription.currency!=='LKR'||Math.round(Number(subscription.amount)*100)!==original.amountCents)return res.status(409).json({error:'Provider subscription does not match the saved contract.'});
   const payments=await provider.payments(original.id);if(!Array.isArray(payments))throw new Error('Provider payment list unavailable.');
   await dbRun('BEGIN TRANSACTION');tx=true;
   const contract=await dbGet('SELECT * FROM saas_contracts WHERE id=?',[original.id]);
   if(contract.providerSubscriptionId&&contract.providerSubscriptionId!==subscriptionId)throw new Error('Subscription reference changed.');
   let paidThrough=contract.paidThrough;
   for(const payment of payments){
    if(String(payment.order_id)!==contract.id||payment.currency!=='LKR'||Math.round(Number(payment.amount)*100)!==contract.amountCents||!/^\d{1,40}$/.test(String(payment.payment_id)))continue;
    const id=String(payment.payment_id),existing=await dbGet('SELECT * FROM saas_invoices WHERE providerPaymentId=?',[id]);
    if(existing&&existing.contractId!==contract.id)throw new Error('Provider payment belongs to another contract.');
    if(!existing&&payment.status==='RECEIVED'){
     await dbRun('INSERT INTO saas_invoices (id,contractId,tenant_id,providerPaymentId,amountCents,status,verifiedAt) VALUES (?,?,?,?,?,?,?)',[crypto.randomUUID(),contract.id,contract.tenant_id,id,contract.amountCents,'paid',Date.now()]);
     paidThrough=nextBillingMonth(Math.max(paidThrough||0,Date.now()));
    }else if(existing&&['REFUNDED','CHARGEBACKED'].includes(payment.status))await dbRun('UPDATE saas_invoices SET status=? WHERE providerPaymentId=?',[payment.status.toLowerCase(),id]);
   }
   const disputed=await dbGet("SELECT COUNT(*) AS count FROM saas_invoices WHERE contractId=? AND status IN ('refunded','chargebacked')",[contract.id]);
   const status=disputed.count?'review_required':subscription.status==='ACTIVE'?(paidThrough?'active':'pending'):'cancelled';
   await dbRun('UPDATE saas_contracts SET providerSubscriptionId=?,status=?,paidThrough=?,updatedAt=? WHERE id=?',[subscriptionId,status,paidThrough||null,Date.now(),contract.id]);
   if(status==='active')await dbRun('UPDATE tenants SET plan=? WHERE id=?',[contract.plan,contract.tenant_id]);
   await dbRun('COMMIT');tx=false;res.json({success:true});
  }catch(e){if(tx)await dbRun('ROLLBACK');next(e)}
 });
 router.use('/saas/billing',authenticateToken,requireRole(['owner']));
 router.get('/saas/billing',async(req,res,next)=>{try{
  const contract=await dbGet('SELECT id,plan,amountCents,status,paidThrough,createdAt,updatedAt FROM saas_contracts WHERE tenant_id=?',[req.tenantId]);
  const invoices=await dbAll('SELECT id,amountCents,status,verifiedAt FROM saas_invoices WHERE tenant_id=? ORDER BY verifiedAt DESC LIMIT 100',[req.tenantId]);
  res.set('Cache-Control','no-store').json({enabled:billingEnabled(env),contract,invoices,plans:Object.entries(PLANS).map(([id,plan])=>({id,label:plan.label,amountCents:plan.priceLkr*100})),graceDays:7});
 }catch(e){next(e)}});
 router.post('/saas/billing/checkout',async(req,res,next)=>{
  if(!billingEnabled(env))return res.status(503).json({error:'Subscription billing is disabled until the merchant setup is verified.'});
  const parsed=contactSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Complete billing contact details and choose a valid plan.'});
  try{
   billingConfig(env);const prior=await dbGet('SELECT * FROM saas_contracts WHERE tenant_id=?',[req.tenantId]);
   if(prior&&prior.status!=='pending')return res.status(409).json({error:'Manage or cancel the existing subscription before starting another.'});
   if(prior&&prior.plan!==parsed.data.plan)return res.status(409).json({error:'A different pending subscription requires platform support.'});
   const contract=prior||{id:'saas_'+crypto.randomUUID(),tenant_id:req.tenantId,plan:parsed.data.plan,amountCents:PLANS[parsed.data.plan].priceLkr*100};
   if(!prior)await dbRun('INSERT INTO saas_contracts (id,tenant_id,plan,amountCents,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',[contract.id,contract.tenant_id,contract.plan,contract.amountCents,'pending',Date.now(),Date.now()]);
   const {plan,...contact}=parsed.data;res.set('Cache-Control','no-store').json(recurringCheckout(contract,contact,env));
  }catch(e){next(e)}
 });
 router.post('/saas/billing/cancel',async(req,res,next)=>{try{
  if(!billingEnabled(env))return res.status(503).json({error:'Subscription billing disabled.'});
  const contract=await dbGet('SELECT * FROM saas_contracts WHERE tenant_id=?',[req.tenantId]);if(!contract?.providerSubscriptionId)return res.status(404).json({error:'No verified subscription found.'});
  await provider.cancel(contract.providerSubscriptionId);await dbRun("UPDATE saas_contracts SET status='cancelled',updatedAt=? WHERE id=?",[Date.now(),contract.id]);res.json({success:true,paidThrough:contract.paidThrough});
 }catch(e){next(e)}});
 return router;
}

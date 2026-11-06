import crypto from 'node:crypto';
import {verifyPayhereNotification} from './payhere.js';
const md5=value=>crypto.createHash('md5').update(value).digest('hex').toUpperCase();
export const billingEnabled=(env=process.env)=>env.SAAS_BILLING_ENABLED==='true';
export function billingConfig(env=process.env){
 if(!billingEnabled(env))throw new Error('Subscription payments are disabled.');
 for(const name of ['SAAS_PAYHERE_MERCHANT_ID','SAAS_PAYHERE_MERCHANT_SECRET','SAAS_PAYHERE_APP_ID','SAAS_PAYHERE_APP_SECRET'])if(!env[name])throw new Error(`Configure ${name} before enabling subscriptions.`);
 const origin=new URL(env.SAAS_BILLING_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.SAAS_BILLING_ORIGIN)throw new Error('Configure an explicit HTTPS SAAS_BILLING_ORIGIN.');
 return {merchant:env.SAAS_PAYHERE_MERCHANT_ID,secret:env.SAAS_PAYHERE_MERCHANT_SECRET,origin:origin.origin,api:env.SAAS_PAYHERE_SANDBOX==='false'?'https://www.payhere.lk':'https://sandbox.payhere.lk'};
}
export function recurringCheckout(contract,contact,env=process.env){
 const config=billingConfig(env),amount=(contract.amountCents/100).toFixed(2);
 return {action:config.api+'/pay/checkout',fields:{...contact,country:'Sri Lanka',merchant_id:config.merchant,return_url:config.origin+'/?tab=settings',cancel_url:config.origin+'/?tab=settings',notify_url:config.origin+'/api/saas/billing/payhere/notify',order_id:contract.id,items:`GastroFlow ${contract.plan} monthly subscription`,currency:'LKR',amount,recurrence:'1 Month',duration:'Forever',hash:md5(config.merchant+contract.id+amount+'LKR'+md5(config.secret))}};
}
export function validSubscriptionNotification(body,env=process.env){return verifyPayhereNotification(body,{PAYHERE_MERCHANT_ID:env.SAAS_PAYHERE_MERCHANT_ID,PAYHERE_MERCHANT_SECRET:env.SAAS_PAYHERE_MERCHANT_SECRET});}
export function nextBillingMonth(timestamp){const d=new Date(timestamp),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.getTime();}
export function createPayhereSubscriptionProvider(env=process.env,fetcher=fetch){
 let bearer=null,expires=0;
 const call=async(path,options={})=>{
  const config=billingConfig(env);
  if(!bearer||Date.now()>=expires){const result=await fetcher(config.api+'/merchant/v1/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.SAAS_PAYHERE_APP_ID+':'+env.SAAS_PAYHERE_APP_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(8000)});if(!result.ok)throw new Error('Subscription provider authentication failed.');const data=await result.json();if(!data.access_token)throw new Error('Provider token is unavailable.');bearer=data.access_token;expires=Date.now()+Math.max(0,Number(data.expires_in||0)-30)*1000;}
  const response=await fetcher(config.api+'/merchant/v1/'+path,{...options,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Subscription provider request failed.');const result=await response.json();if(result.status!==1)throw new Error('Subscription provider could not verify this request.');return result.data;
 };
 return {subscription:id=>call('subscription/'+encodeURIComponent(id)),payments:order=>call('payment/search?order_id='+encodeURIComponent(order)),cancel:id=>call('subscription/cancel',{method:'POST',body:JSON.stringify({subscription_id:id})})};
}

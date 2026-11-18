// Server-authoritative campaign coupon evaluation and redemption.
// All monetary values are LKR. The customer's submitted total is never used.
export const normalizeCampaignCode = code => String(code||'').trim().toUpperCase();
export function evaluateCampaignCoupon(row, {subtotal,orderType='takeaway',customerAccountId=null,previousRedemptions=0,now=Date.now()}={}) {
  if(!row) return null;
  const code=normalizeCampaignCode(row.code);
  if(!/^[A-Z0-9_-]{3,40}$/.test(code))throw Error('Invalid promotion code.');
  if(row.status!=='active' || (row.starts_at!=null&&Number(row.starts_at)>now) ||
    (row.ends_at!=null&&Number(row.ends_at)<=now))throw Error('This offer is not currently active.');
  if(row.tenant_status && row.tenant_status!=='active')throw Error('Restaurant is unavailable.');
  const maxUses=Number(row.max_uses||0),used=Number(row.used_count||0);
  if(maxUses>0&&used>=maxUses)throw Error('This offer has reached its redemption limit.');
  if(row.order_type && row.order_type!=='any'&&row.order_type!==orderType)
    throw Error('This offer is not available for this order type.');
  if(Number(row.per_customer_limit||0)>0){
    if(!customerAccountId)throw Error('Sign in to use this limited offer.');
    if(Number(previousRedemptions)>=Number(row.per_customer_limit))
      throw Error('You have reached the redemption limit for this offer.');
  }
  const spend=Number(subtotal),minimum=Number(row.min_spend);
  if(!Number.isFinite(spend)||spend<0||!Number.isFinite(minimum)||minimum<0)
    throw Error('Invalid offer amount.');
  if(spend<minimum)throw Error(`Spend at least Rs. ${minimum.toFixed(2)} to use this offer.`);
  const value=Number(row.value);
  if(!Number.isFinite(value)||value<=0||!['percent','flat'].includes(row.type)
      ||(row.type==='percent'&&value>100))throw Error('Invalid campaign coupon configuration.');
  const discount=Math.round(Math.max(0,Math.min(spend,row.type==='percent'?spend*value/100:value))*100)/100;
  return {code,discount,campaignId:row.campaign_id};
}
export async function loadCampaignCoupon(dbGet,tenantId,promoCode){
  const code=normalizeCampaignCode(promoCode);
  if(!/^[A-Z0-9_-]{3,40}$/.test(code))return null;
  return dbGet(`SELECT r.*,c.status,c.starts_at,c.ends_at,t.status AS tenant_status
    FROM food_promotion_coupon_rules r
    JOIN food_promotion_campaigns c ON c.id=r.campaign_id AND c.tenant_id=r.tenant_id
    JOIN tenants t ON t.id=r.tenant_id
    WHERE r.tenant_id=? AND r.code=?`,[tenantId,code]);
}

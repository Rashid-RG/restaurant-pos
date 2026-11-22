// Show only persisted, server-confirmed pricing. Never guess that a remainder is delivery.
const value=(v)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const money=v=>Math.round(v*100)/100;
export function orderPriceBreakdown(order={}){
  const total=value(order.total);
  const itemSum=Array.isArray(order.items) && order.items.length>0
    ?money(order.items.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.quantity)||1),0)):null;
  const subtotal=value(order.subtotal)??itemSum;
  const lines=[];
  if(subtotal!==null)lines.push({label:'Items subtotal',amount:subtotal});
  const fields=[
    ['Delivery fee','deliveryFee',1],['Service charge','serviceCharge',1],
    ['Tax','tax',1],['Tip','tip',1],['Discount','discount',-1],
    ['Promotional discount','promotionalDiscount',-1],['Rounding adjustment','roundingAdjustment',1]
  ];
  for(const [label,key,sign] of fields){
    const amount=value(order[key]);
    if(amount!==null && amount!==0)lines.push({label,amount:money(sign*amount)});
  }
  const accounted=money(lines.reduce((sum,line)=>sum+line.amount,0));
  const remainder=total!==null&&subtotal!==null?money(total-accounted):null;
  // Some legacy records expose only an aggregate total. Explain differences transparently.
  if(remainder!==null&&Math.abs(remainder)>=0.01)lines.push({label:'Other charges / adjustments (details unavailable)',amount:remainder});
  return {lines,total};
}

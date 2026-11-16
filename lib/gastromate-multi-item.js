// Deterministic, tenant-scoped multi-item draft parsing for GastroMate.
// This is NOT a checkout or cart mutation. Prices are base menu prices only.
const WORD_QTY = {one:1, a:1, an:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10};
const QUANTITY = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a|an)';
const BUDGET = /(?:under|below|within|up to|budget(?: of)?|less than|max(?:imum)?)\s*(?:rs\.?\s*|lkr\s*)?(\d{1,3}(?:,\d{3})+|\d{2,6})\b/i;
const NORM = v=>String(v||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const plural = str => str.endsWith('ies') ? str.slice(0,-3)+'y' : str.endsWith('es') ? str.slice(0,-2) : str.endsWith('s') ? str.slice(0,-1) : str;
function normalNames(str) {
  const words=NORM(str).split(' ').filter(Boolean);
  return words.join(' ').replace(/\b(?:burger|drink|frie|rice|juice)s\b/g, '$1');
}
function matchMenuItem(menu, phrase) {
  const wanted=NORM(phrase);
  const normalize = text=>plural(NORM(text));
  const available = (Array.isArray(menu) ? menu : []).filter(item =>
    item && item.isAvailable !== 0 && item.isAvailable !== false &&
    item.isAvailable !== 'false' && (item.stock == null || Number(item.stock) > 0) &&
    Number.isFinite(Number(item.price)) && Number(item.price) >= 0);
  const exact=available.filter(i=>normalize(i.name)===normalize(wanted));
  const matched=exact.length ? exact : available.filter(i=>{
    const name=normalize(i.name);
    return name.includes(normalize(wanted)) && wanted.length >= 3;
  });
  return matched.length===1 ? matched[0] : null;
}
function parseLine(segment) {
  const cleaned=String(segment).trim().replace(/^(?:add|order|give me|i(?:'d| would) like|i want|can i have|please|put)\s+/i,'')
    .replace(/\s+(?:to (?:my |the )?cart|please)$/i,'').trim();
  const m=cleaned.match(new RegExp('^'+QUANTITY+'\\s*(?:x|×)?\\s+(.+)$','i'));
  const word=m ? m[1].toLowerCase() : '';
  const qty=m ? WORD_QTY[word]||Number(word) : 1;
  const name=(m ? m[2] : cleaned).trim();
  if(!name || name.length>100 || !Number.isInteger(qty)||qty<1||qty>20)return null;
  return {quantity:qty, phrase:name};
}
export function gastroMultiItemPlan(menu, message) {
  const original=String(message||'').trim();
  if(original.length>600 || !/^(?:please\s+)?(?:add|order|give me|i(?:'d| would) like|i want|can i have|put)\b/i.test(original))return null;
  let working=original.replace(/^(?:please\s+)?(?:add|order|give me|i(?:'d| would) like|i want|can i have|put)\s+/i,'');
  const budgetMatch=working.match(BUDGET);
  const budget=budgetMatch ? Number(budgetMatch[1].replaceAll(',','')) : null;
  if(budgetMatch)working=working.replace(budgetMatch[0],'');
  working=working.replace(/\s+(?:for|with)\s*$/i,'').replace(/\s+to (?:my |the )?cart\s*$/i,'').trim();
  const parts=working.split(/\s*,\s*|\s+(?:and|plus|&)\s+/i).map(t=>t.trim()).filter(Boolean);
  if(parts.length<2 || parts.length>6)return null;
  const lines=parts.map(part=>{
    const line=parseLine(part);
    if(!line)return {phrase:part.slice(0,100),quantity:1,status:'clarify'};
    const item=matchMenuItem(menu,line.phrase);
    if(!item)return {...line,status:'clarify'};
    const stock=Number(item.stock);
    if(item.stock != null && (!Number.isFinite(stock)||stock<line.quantity))
      return {...line,status:'out_of_stock',name:String(item.name).slice(0,100)};
    return {...line,status:'available',itemId:String(item.id),name:String(item.name).slice(0,100),
      unitPrice:Number(item.price),lineTotal:Math.round(Number(item.price)*line.quantity*100)/100};
  });
  const subtotal=Math.round(lines.reduce((sum,line)=>sum+(line.lineTotal||0),0)*100)/100;
  const totalKnown=lines.every(line=>line.status==='available');
  return {type:'multi_item_preview',lines,
    subtotal,totalKnown,budget:budget && budget>=50 && budget<=100000?budget:null,
    withinBudget:budget != null && totalKnown ? subtotal<=budget : null,
    note:'Base item prices only. Required modifiers, fees and taxes are calculated during checkout.'};
}

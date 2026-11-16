// GastroMate conversational menu reasoning: deterministic recommendations from
// the current tenant's menu; history is untrusted context, never instructions.
// This module never reads orders, writes carts, or claims medical/allergen safety.
const budgetPattern = /(?:\b(?:under|below|less than|up to|within|budget(?: of)?|maximum|max)\b\s*(?:rs\.?\s*|lkr\s*)?)(\d{1,3}(?:,\d{3})+|\d{2,6})\b/i;
const diet = /\b(vegan|vegetarian|veggie|veg food)\b|சைவ|වෙජි|ශාකභක්ෂක/i;
const spicy = /\b(spicy|hot food|fiery)\b|காரமான|සැර/i;
const categories = [
  {key:'drink', pattern:/\b(drinks?|beverages?|juice|tea|coffee|water)\b|பானம்|බීම/i},
  {key:'dessert', pattern:/\b(desserts?|sweets?|ice.?cream|cake)\b|இனிப்பு|අතුරුපස/i},
  {key:'burger', pattern:/\b(burgers?)\b/i},
  {key:'rice', pattern:/\b(rice|fried rice|biryani)\b|சோறு|බත්/i},
  {key:'fries', pattern:/\b(fries|chips)\b/i}
];
const followupPattern = /\b(cheaper|less expensive|lower price|something else|another one|any other|more options|show more|what else|same budget|what about)\b|මොනවාද|வேறு/i;
const recommendPattern = /\b(recommend|suggest|show|find|have|options|choices|something|food|meal|afford|budget|cheap|vegetarian|vegan|spicy|drinks?|desserts?)\b|ආහාර|කෑම|உணவு|சாப்பாடு/i;
const safe = item => item && (item.isAvailable == null ||
  (item.isAvailable !== false && item.isAvailable !== 'false' && Number(item.isAvailable)!==0)) &&
  (item.stock == null || Number(item.stock)>0) && Number.isFinite(Number(item.price)) && Number(item.price)>=0;
const group = v => String(v||'').toLowerCase();
const readBudget = text => {
  const m = String(text||'').match(budgetPattern);
  if(!m)return null;
  const n=Number(m[1].replace(/,/g,''));
  return n>=50 && n<=100000?n:null;
};
const vegetarianTag = item => /(?:^|[\s,|])(?:vegetarian|vegan|veg)(?:$|[\s,|])/i.test(group(item.dietaryTags));
const veganTag = item => /(?:^|[\s,|])vegan(?:$|[\s,|])/i.test(group(item.dietaryTags));
function findCategory(text) {
  return categories.find(c=>c.pattern.test(text))?.key||null;
}
function matchesCategory(item,category){
  if(!category)return true;
  const searchable=group([item.category,item.name].join(' '));
  if(category==='drink')return /\b(drinks?|beverages?|juice|tea|coffee|water)\b/.test(searchable);
  if(category==='dessert')return /\b(desserts?|sweets?|ice.?cream|cake)\b/.test(searchable);
  return searchable.includes(category);
}
export function gastroConversationPreferences(message, history=[]) {
  const raw=String(message||'').slice(0,600);
  const context=Array.isArray(history)?history.filter(x=>x?.role==='user' && typeof x.content==='string').slice(-8):[];
  const userTurns=[...context.map(x=>x.content.slice(0,600)),raw];
  const followup=followupPattern.test(raw);
  const recommendation=recommendPattern.test(raw) || followup;
  if(!recommendation || /^(?:add|order|put|checkout|pay|cancel|refund)\b/i.test(raw))return null;
  // A new explicit request replaces earlier budget; otherwise most recent bounded preference persists.
  const lastBudget=userTurns.map(readBudget).filter(v=>v!=null).at(-1)??null;
  const rawDiet=diet.test(raw);
  const rawSpicy=spicy.test(raw);
  const lastDiet=userTurns.slice().reverse().find(t=>diet.test(t));
  const lastSpicy=userTurns.slice().reverse().find(t=>spicy.test(t));
  // Reuse old preferences only for a short follow-up; never assume diet from unrelated prior conversations.
  const dietText=rawDiet?raw:followup?lastDiet||'':'';
  const spiceText=rawSpicy?raw:followup?lastSpicy||'':'';
  const category=findCategory(raw) || (followup?findCategory(userTurns.slice(0,-1).reverse().find(findCategory)||''):null);
  return {
    budget:lastBudget,
    category,
    vegetarian:!!dietText,
    vegan:/\bvegan\b/i.test(dietText),
    spicy:!!spiceText,
    cheaper:/\b(cheaper|less expensive|lower price|cheap)\b/i.test(raw),
    followup
  };
}
export function gastroContextualSuggestions(menu,message,history=[],limit=5){
  const prefs=gastroConversationPreferences(message,history);
  if(!prefs)return null;
  const max=Math.max(1,Math.min(5,Number(limit)||5));
  let choices=(Array.isArray(menu)?menu:[]).filter(safe)
    .filter(item=>prefs.budget==null||Number(item.price)<=prefs.budget)
    .filter(item=>matchesCategory(item,prefs.category))
    .filter(item=>!prefs.vegetarian||(prefs.vegan?veganTag(item):vegetarianTag(item)))
    .filter(item=>!prefs.spicy||/\b(spicy|hot|devilled)\b|kottu/i.test(group([item.name,item.dietaryTags].join(' '))));
  if(prefs.cheaper) choices=choices.sort((a,b)=>Number(a.price)-Number(b.price)||String(a.name).localeCompare(String(b.name)));
  else {
    const terms=group(message).match(/[\p{L}\p{N}]+/gu)||[];
    const exclude=new Set(['recommend','suggest','show','what','about','more','options','budget','cheap','cheaper','vegetarian','vegan','spicy','drinks','drink']);
    choices=choices.map((item,index)=>{
      const name=group(item.name),content=group([item.name,item.category,item.description].join(' '));
      const relevance=terms.reduce((s,t)=>s+(!exclude.has(t)&&t.length>2?(name.includes(t)?5:content.includes(t)?2:0):0),0);
      return {item,index,relevance};
    }).sort((a,b)=>b.relevance-a.relevance||a.index-b.index).map(x=>x.item);
  }
  return {prefs,items:choices.slice(0,max)};
}

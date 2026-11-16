// Deterministic clarification for a customer's explicit single-item order request.
// The assistant must never guess between similarly named products or invent stock.
import { isGastroMenuItemAvailable } from './gastromate-ai.js';

const normalized = value => String(value || '').toLocaleLowerCase('en').normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const quantityWords={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
function singular(text) {
  return normalized(text).split(' ').map(word => {
    if(word==='fries')return 'fries';
    if(word.endsWith('ies')&&word.length>4)return word.slice(0,-3)+'y';
    if(word.endsWith('s')&&!word.endsWith('ss')&&word.length>3)return word.slice(0,-1);
    return word;
  }).join(' ');
}
export function gastroClarifyOrder(menu,message) {
  const text=String(message||'').trim();
  const match=text.match(/^(?:please\s+)?(?:add|order|put)\s+(?:(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|×)?\s+)?(.+?)(?:\s+to (?:my |the )?cart)?\s*$/i);
  if(!match)return null;
  const quantity=Number(quantityWords[match[1]?.toLowerCase()]||match[1]||1);
  if(!Number.isInteger(quantity)||quantity<1||quantity>20)return {
    reply:'Please choose a quantity between 1 and 20 from the restaurant menu.',
    recommendedItems:[],suggestions:['Browse Menu'],action:null
  };
  const phrase=singular(match[2]);
  if(phrase.length<2 || phrase.length>100)return null;
  const candidates=(Array.isArray(menu)?menu:[]).filter(isGastroMenuItemAvailable)
    .filter(item=>item.stock==null||Number(item.stock)>=quantity);
  const exact=candidates.filter(item=>singular(item.name)===phrase);
  const possible=exact.length?exact:candidates.filter(item=>{
    const name=singular(item.name);
    return name.includes(phrase) || phrase.split(' ').every(term=>name.split(' ').includes(term));
  });
  if(possible.length===1)return null; // Existing validated proposal handles unambiguous requests.
  const best=possible.slice(0,5);
  if(!best.length)return {
    reply:'I could not find an available item matching that request and quantity. Please select an exact item from the current restaurant menu.',
    recommendedItems:[],suggestions:['Browse Menu'],action:null
  };
  return {
    reply:'There are several matching menu items. Which exact item would you like? Choose from the verified options below. Nothing has been added to your cart.',
    recommendedItems:best,suggestions:['Browse Menu'],action:null,
    clarification:{kind:'choose_menu_item',quantity}
  };
}

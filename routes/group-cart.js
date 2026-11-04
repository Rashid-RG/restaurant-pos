import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export async function initGroupCarts(add){
 for(const [name,type] of Object.entries({tenant_id:'TEXT',status:"TEXT DEFAULT 'active'",createdAt:'BIGINT',hostHash:'TEXT',expiresAt:'BIGINT',orderId:'TEXT'}))await add('group_carts',name,type);
}
export function createGroupCartHandlers({dbGet,dbRun,resolvePublicTenant,getTenantMeta,notifyPOS}){
 const scoped=async(req)=>{const tenantId=await resolvePublicTenant(req),meta=await getTenantMeta(tenantId);if(meta.status!=='active')throw Error('Restaurant unavailable.');return tenantId;};
 const read=async(req)=>{const tenantId=await scoped(req);return dbGet('SELECT * FROM group_carts WHERE id=? AND tenant_id=? AND expiresAt>?',[req.params.id,tenantId,Date.now()]);};
 const publicCart=cart=>({id:cart.id,status:cart.status,expiresAt:cart.expiresAt,items:JSON.parse(cart.items).map(({participantId,...item})=>item)});
 return {
  create:async(req,res,next)=>{try{const tenantId=await scoped(req),id=crypto.randomUUID(),hostToken=crypto.randomBytes(32).toString('hex'),now=Date.now(),expiresAt=now+86400000;await dbRun("INSERT INTO group_carts (id,items,status,tenant_id,hostHash,createdAt,updatedAt,expiresAt) VALUES (?,'[]','active',?,?,?,?,?)",[id,tenantId,hash(hostToken),now,now,expiresAt]);res.status(201).set('Cache-Control','no-store').json({id,hostToken,expiresAt});}catch(error){next(error)}},
  get:async(req,res,next)=>{try{const cart=await read(req);if(!cart)return res.status(404).json({error:'Group cart not found or expired.'});res.set('Cache-Control','no-store').json(publicCart(cart));}catch(error){next(error)}},
  update:async(req,res,next)=>{let open=false;try{
   const {participantName,itemId,quantity,notes='',selectedModifiers=[]}=req.body||{},token=req.headers['x-group-participant'];
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof participantName!=='string'||!participantName.trim()||participantName.length>80||typeof itemId!=='string'||!Number.isSafeInteger(quantity)||quantity<0||quantity>1000||typeof notes!=='string'||notes.length>500||!Array.isArray(selectedModifiers)||selectedModifiers.length>50)return res.status(400).json({error:'A private participant token and valid item details are required.'});
   await dbRun('BEGIN TRANSACTION');open=true;const cart=await read(req);
   if(!cart||cart.status!=='active'){await dbRun('ROLLBACK');open=false;return res.status(409).json({error:'Group cart unavailable.'});}
   const menu=await dbGet('SELECT name,price,isAvailable FROM menu_items WHERE id=? AND tenant_id=?',[itemId,cart.tenant_id]);if(!menu||menu.isAvailable===0)throw Error('Menu item unavailable for this restaurant.');
   const participantId=hash(token),items=JSON.parse(cart.items),index=items.findIndex(i=>i.participantId===participantId&&i.itemId===itemId);
   if(index>=0)items.splice(index,1);if(quantity>0)items.push({participantId,participantName:participantName.trim(),itemId,name:menu.name,price:menu.price,quantity,notes,selectedModifiers});
   if(items.length>100)throw Error('Group cart has reached its 100-item limit.');
   await dbRun('UPDATE group_carts SET items=?,updatedAt=? WHERE id=? AND tenant_id=?',[JSON.stringify(items),Date.now(),cart.id,cart.tenant_id]);await dbRun('COMMIT');open=false;
   notifyPOS({type:'group_cart_updated',cartId:cart.id},cart.tenant_id);res.json({success:true,...publicCart({...cart,items:JSON.stringify(items)})});
  }catch(error){if(open)await dbRun('ROLLBACK');res.status(400).json({error:error.message});}},
  checkout:async(req,res,next)=>{try{
   const cart=await read(req),token=req.headers['x-group-host'];if(!cart||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||hash(token)!==cart.hostHash)return res.status(404).json({error:'Use the private host access to check out this group.'});
   if(cart.status==='checked_out')return res.status(409).json({error:'This group has already checked out. Use the original order confirmation.'});
   if(cart.status!=='active'||!JSON.parse(cart.items).length)return res.status(409).json({error:'Group cart is empty or unavailable.'});
   req.groupCart={id:cart.id,items:cart.items,hostHash:cart.hostHash};
   req.body={...req.body,items:JSON.parse(cart.items).map(i=>({menuItemId:i.itemId,quantity:i.quantity,notes:`${i.participantName}: ${i.notes}`,selectedModifiers:i.selectedModifiers}))};next();
  }catch(error){next(error)}}
 };
}

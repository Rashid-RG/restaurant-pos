import {initKitchen,syncKitchen} from './kitchen.js';
import crypto from 'node:crypto';
export async function initOrderInventory(dbRun){
 await initKitchen(dbRun);
 await dbRun('CREATE TABLE IF NOT EXISTS order_inventory_state (orderId TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,requirements TEXT NOT NULL,revision INTEGER NOT NULL,updatedAt BIGINT NOT NULL)');
 await dbRun('CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,orderId TEXT NOT NULL,revision INTEGER NOT NULL,resourceType TEXT NOT NULL,resourceId TEXT NOT NULL,delta REAL NOT NULL,reason TEXT NOT NULL,actorId TEXT,createdAt BIGINT NOT NULL)');
 await dbRun('CREATE INDEX IF NOT EXISTS inventory_movement_order ON inventory_movements(tenant_id,orderId)');
}
// Caller owns the transaction. The saved ingredient requirements are a recipe
// snapshot, so retries/reversals never reinterpret a subsequently changed recipe.
export async function setOrderInventory({dbGet,dbAll,dbRun,orderId,tenantId,items,reason,actorId=null,requireExisting=false}){
 await syncKitchen({dbGet,dbAll,dbRun,orderId,tenantId,items,reason,actorId});
 const old=await dbGet('SELECT * FROM order_inventory_state WHERE orderId=?',[orderId]);
 if(old&&old.tenant_id!==tenantId)throw new Error('Inventory belongs to another restaurant.');
 if(requireExisting&&!old)throw new Error('This legacy order needs inventory reconciliation before editing or reversal.');
 const requirements={};
 for(const item of items){
  const id=item.id||item.menuItemId,quantity=Number(item.quantity);
  if(!id||!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Inventory requires positive whole item quantities.');
  const key='menu:'+id;requirements[key]=(requirements[key]||0)+quantity;
  const recipes=await dbAll('SELECT r.ingredientId,r.quantityRequired,i.tenant_id AS ingredientTenant FROM recipes r LEFT JOIN ingredients i ON i.id=r.ingredientId WHERE r.menuItemId=? AND r.tenant_id=?',[id,tenantId]);
  for(const recipe of recipes){
   if(recipe.ingredientTenant!==tenantId||!Number.isFinite(Number(recipe.quantityRequired))||Number(recipe.quantityRequired)<=0)throw new Error('Recipe contains an invalid or foreign ingredient.');
   const key='ingredient:'+recipe.ingredientId;requirements[key]=(requirements[key]||0)+Number(recipe.quantityRequired)*quantity;
  }
 }
 const prior=old?JSON.parse(old.requirements):{},revision=Number(old?.revision||0)+1;
 const keys=[...new Set([...Object.keys(prior),...Object.keys(requirements)])].sort();
 let changed=false;
 for(const key of keys){
  const delta=Number(requirements[key]||0)-Number(prior[key]||0);if(Math.abs(delta)<1e-9)continue;
  const split=key.indexOf(':'),type=key.slice(0,split),id=key.slice(split+1),table=type==='menu'?'menu_items':'ingredients';
  const result=delta>0?await dbRun(`UPDATE ${table} SET stock=stock-? WHERE id=? AND tenant_id=? AND (stock IS NULL OR stock>=?)`,[delta,id,tenantId,delta]):await dbRun(`UPDATE ${table} SET stock=stock-? WHERE id=? AND tenant_id=?`,[delta,id,tenantId]);
  if(result.changes!==1)throw new Error('Insufficient or unavailable restaurant inventory.');
  await dbRun('INSERT INTO inventory_movements (id,tenant_id,orderId,revision,resourceType,resourceId,delta,reason,actorId,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',[crypto.randomUUID(),tenantId,orderId,revision,type,id,-delta,reason,actorId,Date.now()]);changed=true;
 }
 if(changed||!old)await dbRun('INSERT INTO order_inventory_state (orderId,tenant_id,requirements,revision,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(orderId) DO UPDATE SET requirements=excluded.requirements,revision=excluded.revision,updatedAt=excluded.updatedAt',[orderId,tenantId,JSON.stringify(requirements),revision,Date.now()]);
 return {revision:changed||!old?revision:old.revision,changed};
}

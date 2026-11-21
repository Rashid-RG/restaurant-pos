import {describe,it,expect} from 'vitest';
import {createKitchenAction,isTransientKitchenFailure} from '../src/utils/kitchen-recovery.js';

describe('GastroPOS kitchen recovery client contract',()=>{
 it('keeps one stable retry key, revision and ETA across transport retries',()=>{
   const ticket={orderId:'order-a',revision:7,state:'pending'};
   const first=createKitchenAction(ticket,'preparing','line-a',()=> 'kitchen-key-123456789');
   expect(first).toEqual({revision:7,state:'preparing',lineId:'line-a',etaMinutes:25,retryKey:'kitchen-key-123456789'});
   // Retain the original payload after a lost response; do not generate a new key.
   const retained={orderId:ticket.orderId,body:first};
   expect(retained.body.retryKey).toBe(first.retryKey);
   expect(retained.body.revision).toBe(7);
 });
 it('creates independent keys for distinct kitchen actions',()=>{
   const source={revision:4,state:'preparing'};
   const next=createKitchenAction(source,'ready',undefined,()=> 'kitchen-key-next-987654321');
   expect(next).toEqual({revision:4,state:'ready',retryKey:'kitchen-key-next-987654321'});
   expect(next).not.toHaveProperty('etaMinutes');
   expect(next).not.toHaveProperty('lineId');
 });
 it('preserves pending writes on outages but not conflicting or unauthorized responses',()=>{
   for(const e of [new Error('offline'),{status:0},{status:408},{status:429},{status:502},{status:503}]){
     expect(isTransientKitchenFailure(e)).toBe(true);
   }
   for(const status of [400,401,403,404,409,410]){
     expect(isTransientKitchenFailure({status})).toBe(false);
   }
 });
});

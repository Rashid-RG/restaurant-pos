import {describe,it,expect} from 'vitest';
import {sanitizePendingUpdates,queuePendingStatus,removePendingStatus,offlineUpdateKey} from './offline-status.js';
describe('driver non-final offline progress queue',()=>{
  const now=1700000000000;
  it('keeps only bounded, recent progress without sensitive payload',()=>{
    expect(sanitizePendingUpdates([{orderId:'a',status:'delivered',createdAt:now},{orderId:'b',status:'arrived',createdAt:now,signature:'secret'}],now))
      .toEqual([{orderId:'b',status:'arrived',createdAt:now}]);
    expect(sanitizePendingUpdates([{orderId:'a',status:'picked_up',createdAt:now-13*3600000}],now)).toEqual([]);
  });
  it('rejects financial/final status and overlapping attempts',()=>{
    expect(()=>queuePendingStatus([],'a','delivered',now)).toThrow();
    expect(()=>queuePendingStatus([{orderId:'a',status:'picked_up',createdAt:now}],'a','arrived',now)).toThrow();
  });
  it('removes successful intent without changing another order',()=>{
    const current=queuePendingStatus([],'a','picked_up',now);
    const more=queuePendingStatus(current,'b','arrived',now);
    expect(removePendingStatus(more,'a',now)).toEqual([{orderId:'b',status:'arrived',createdAt:now}]);
    expect(offlineUpdateKey('shop1','drv1')).not.toBe(offlineUpdateKey('shop2','drv1'));
  });
});

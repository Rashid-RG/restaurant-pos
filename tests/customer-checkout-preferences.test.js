import {describe,it,expect} from 'vitest';
import {checkoutPrefKey,readCheckoutPaymentPreference,saveCheckoutPaymentPreference,savedDeliveryCoordinates} from '../apps/customer-web/src/utils/checkout-preferences.js';

function memoryStorage(){
  const data=new Map();
  return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)};
}
describe('secure tenant-scoped express checkout preferences',()=>{
  it('separates one customer and restaurant from another',()=>{
    const storage=memoryStorage();
    expect(saveCheckoutPaymentPreference(storage,'store-a','customer-1','bank_transfer')).toBe(true);
    expect(readCheckoutPaymentPreference(storage,'store-a','customer-1')).toBe('bank_transfer');
    expect(readCheckoutPaymentPreference(storage,'store-b','customer-1')).toBe(null);
    expect(readCheckoutPaymentPreference(storage,'store-a','customer-2')).toBe(null);
    expect(checkoutPrefKey('','customer-1')).toBe('');
  });
  it('does not persist payment credentials or unavailable methods',()=>{
    const storage=memoryStorage();
    expect(saveCheckoutPaymentPreference(storage,'a','b','card-number')).toBe(false);
    expect(saveCheckoutPaymentPreference(storage,'a','b','payhere')).toBe(false);
    expect(saveCheckoutPaymentPreference(storage,'a','b','lankaqr')).toBe(false);
    expect(readCheckoutPaymentPreference(storage,'a','b')).toBe(null);
    expect(saveCheckoutPaymentPreference(storage,'a','b','cash')).toBe(true);
    expect(readCheckoutPaymentPreference(storage,'a','b')).toBe('cash');
  });
  it('never treats address text as a confirmed GPS entrance',()=>{
    expect(savedDeliveryCoordinates({id:'saved-one',addressLine:'Galgamuwa Main Street'})).toBe(null);
    expect(savedDeliveryCoordinates({lat:null,lng:80,addressLine:'a'})).toBe(null);
    expect(savedDeliveryCoordinates({lat:'',lng:80,addressLine:'a'})).toBe(null);
    expect(savedDeliveryCoordinates({lat:200,lng:80,addressLine:'a'})).toBe(null);
    expect(savedDeliveryCoordinates({lat:7.998,lng:80.265,addressLine:'Galgamuwa'})).toEqual({lat:7.998,lng:80.265,label:'Galgamuwa'});
  });
});

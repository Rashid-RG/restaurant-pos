import {describe,it,expect} from 'vitest';
import crypto from 'node:crypto';
import {
  manualDocumentKey,manualDocumentsConfigured,decodeManualDocument,
  encryptManualDocument,decryptManualDocument,documentKindsForVehicle
} from '../lib/driver-manual-documents.js';

const key=crypto.randomBytes(32);
const env={DRIVER_DOCUMENT_ENCRYPTION_KEY:key.toString('base64')};
const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
const context={tenantId:'restaurant-one',driverId:'drv_a',kind:'identity_front'};

describe('Encrypted manual rider document evidence',()=>{
  it('rejects missing, malformed or invalid encryption keys',()=>{
    expect(manualDocumentsConfigured({})).toBe(false);
    expect(manualDocumentKey({DRIVER_DOCUMENT_ENCRYPTION_KEY:'short'})).toBeNull();
    expect(manualDocumentsConfigured(env)).toBe(true);
    expect(manualDocumentKey(env)).toEqual(key);
  });
  it('only accepts strict bounded images matching file signatures',()=>{
    expect(decodeManualDocument({kind:'identity_front',contentType:'image/png',data:png.toString('base64')}).bytes).toEqual(png);
    for(const input of [
      {kind:'id_number',contentType:'image/png',data:png.toString('base64')},
      {kind:'identity_front',contentType:'text/html',data:png.toString('base64')},
      {kind:'identity_front',contentType:'image/png',data:Buffer.from('<svg/>').toString('base64')},
      {kind:'identity_front',contentType:'image/png',data:'bad@@@'},
      {kind:'identity_front',contentType:'image/png',data:Buffer.alloc(2*1024*1024+1).toString('base64')}
    ])expect(()=>decodeManualDocument(input)).toThrow();
  });
  it('encrypts using authenticated context and cannot cross restaurant or driver boundaries',()=>{
    const sealed=encryptManualDocument(png,context,key);
    expect(sealed.ciphertext).not.toBe(png.toString('base64'));
    expect(decryptManualDocument(sealed,context,key)).toEqual(png);
    for(const changed of [
      {...context,tenantId:'restaurant-two'},
      {...context,driverId:'drv_b'},
      {...context,kind:'licence_front'}
    ])expect(()=>decryptManualDocument(sealed,changed,key)).toThrow();
    expect(()=>decryptManualDocument({...sealed,ciphertext:'AAAA'},context,key)).toThrow();
    expect(()=>decryptManualDocument(sealed,context,crypto.randomBytes(32))).toThrow();
  });
  it('requires both identity and appropriate licence images for motorized couriers',()=>{
    expect(documentKindsForVehicle('Bicycle')).toEqual(['identity_front','identity_back']);
    expect(documentKindsForVehicle('Car')).toEqual(['identity_front','identity_back','licence_front','licence_back']);
    expect(documentKindsForVehicle('Unknown')).toEqual([]);
  });
});

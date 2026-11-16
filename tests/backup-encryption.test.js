import {describe,it,expect} from 'vitest';
import {encryptBackup,decryptBackup} from '../lib/backup-encryption.js';

const secret='fixture-private-backup-password-that-is-at-least-32-bytes';
const contents=Buffer.from('{"format":"test","orders":[{"id":"QA-1","total":300}]}');
describe('Authenticated portable backup archives',()=>{
 it('round trips bytes without storing the plaintext or passphrase',()=>{
   const envelope=encryptBackup(contents,secret);
   expect(envelope).toMatchObject({format:'gastroflow-encrypted-backup',version:1});
   expect(decryptBackup(envelope,secret)).toEqual(contents);
   const serialized=JSON.stringify(envelope);
   expect(serialized).not.toContain('QA-1');
   expect(serialized).not.toContain(secret);
 });
 it('uses unique salts and nonces even when content and secret match',()=>{
   const a=encryptBackup(contents,secret),b=encryptBackup(contents,secret);
   expect(a.kdf.salt).not.toBe(b.kdf.salt);
   expect(a.cipher.nonce).not.toBe(b.cipher.nonce);
   expect(a.ciphertext).not.toBe(b.ciphertext);
 });
 it('rejects wrong keys, tampering and incompatible encryption parameters',()=>{
   const valid=encryptBackup(contents,secret);
   expect(()=>decryptBackup(valid,'a-different-secret-at-least-32-characters')).toThrow(/authentication failed/);
   const changed={...valid,ciphertext:Buffer.from('changed bytes').toString('base64')};
   expect(()=>decryptBackup(changed,secret)).toThrow(/authentication failed/);
   expect(()=>decryptBackup({...valid,cipher:{...valid.cipher,tag:'AAAA'}},secret)).toThrow(/envelope/);
   expect(()=>decryptBackup({...valid,kdf:{...valid.kdf,N:1}},secret)).toThrow(/Unsupported/);
   expect(()=>decryptBackup({...valid,version:2},secret)).toThrow(/Unsupported/);
 });
 it('requires strong passphrase input and refuses empty backups',()=>{
   expect(()=>encryptBackup(contents,'weak')).toThrow(/32/);
   expect(()=>encryptBackup(Buffer.alloc(0),secret)).toThrow(/size/);
   expect(()=>decryptBackup({},secret)).toThrow(/Unsupported/);
 });
});

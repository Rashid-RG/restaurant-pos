import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encryptBackup} from '../lib/backup-encryption.js';
import {uploadEncryptedBackup,validateBackupUploadDestination,validateEncryptedArchive} from '../lib/backup-upload.js';

const secret='fixed-fixture-secret-of-more-than-32-bytes-for-tests';
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gastroflow-upload-test-'));
 const filename=path.join(directory,'qa.enc.json');
 fs.writeFileSync(filename,JSON.stringify(encryptBackup(Buffer.from('qa-only-not-customer-data'),secret)),{mode:0o600});
 return {directory,filename,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
describe('Encrypted off-host upload gate',()=>{
 it('does nothing when presigned destination is not configured',async()=>{
   const {filename,cleanup}=fixture();try{
     const fetchMock=vi.fn();
     expect(await uploadEncryptedBackup(filename,{url:'',fetchImpl:fetchMock})).toEqual({uploaded:false,reason:'not_configured'});
     expect(fetchMock).not.toHaveBeenCalled();
   }finally{cleanup();}
 });
 it('requires exact HTTPS host and refuses redirects, alternate hosts, credentials and custom ports',()=>{
   const allowed='storage.example.test';
   for(const url of ['http://storage.example.test/object','https://storage.example.test.evil.test/object',
     'https://alice:secret@storage.example.test/object','https://storage.example.test:444/object',
     'https://storage.example.test/object#fragment','file:///tmp/archive']){
       expect(()=>validateBackupUploadDestination(url,allowed)).toThrow();
   }
   expect(validateBackupUploadDestination('https://storage.example.test/object?X-Amz-Signature=redacted',allowed).hostname).toBe(allowed);
 });
 it('sends only validated encrypted bytes and reports a checksum',async()=>{
   const {filename,cleanup}=fixture();try{
     const mock=vi.fn().mockResolvedValue({status:200});
     const result=await uploadEncryptedBackup(filename,{
       url:'https://storage.example.test/backup?token=private',expectedHost:'storage.example.test',encryptionSecret:secret,fetchImpl:mock
     });
     expect(result.uploaded).toBe(true);
     expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
     const [target,request]=mock.mock.calls[0];
     expect(target).toContain('storage.example.test');
     expect(request).toMatchObject({method:'PUT',redirect:'error'});
     expect(request.body.toString()).not.toContain('qa-only-not-customer-data');
     expect(validateEncryptedArchive(request.body)).toBe(result.sha256);
   }finally{cleanup();}
 });
 it('refuses wrong-key or tampered encrypted archives before networking',async()=>{
   const {filename,cleanup}=fixture();try{
     const fetchMock=vi.fn();
     const args={url:'https://storage.example.test/object',expectedHost:'storage.example.test',fetchImpl:fetchMock};
     await expect(uploadEncryptedBackup(filename,{...args,encryptionSecret:'another-secure-test-secret-more-than-32-bytes'})).rejects.toThrow(/authentication failed/);
     const envelope=JSON.parse(fs.readFileSync(filename,'utf8'));
     envelope.ciphertext=Buffer.from('not-a-real-ciphertext').toString('base64');
     fs.writeFileSync(filename,JSON.stringify(envelope));
     await expect(uploadEncryptedBackup(filename,{...args,encryptionSecret:secret})).rejects.toThrow(/authentication failed/);
     expect(fetchMock).not.toHaveBeenCalled();
   }finally{cleanup();}
 });
 it('does not upload plaintext, symlinks or malformed envelopes',async()=>{
   const {filename,directory,cleanup}=fixture();try{
     const mock=vi.fn();
     const args={url:'https://storage.example.test/object',expectedHost:'storage.example.test',encryptionSecret:secret,fetchImpl:mock};
     fs.writeFileSync(filename,'{"customer":"not encrypted"}');
     await expect(uploadEncryptedBackup(filename,args)).rejects.toThrow(/archive|envelope/i);
     const linked=path.join(directory,'linked.enc.json');
     fs.symlinkSync(filename,linked);
     await expect(uploadEncryptedBackup(linked,args)).rejects.toThrow(/regular file/);
     expect(mock).not.toHaveBeenCalled();
   }finally{cleanup();}
 });
 it('rejects oversized sparse archives before reading or sending data',async()=>{
   const {filename,cleanup}=fixture();try{
     fs.truncateSync(filename,701*1024*1024);
     const fetchMock=vi.fn();
     await expect(uploadEncryptedBackup(filename,{
       url:'https://storage.example.test/object',expectedHost:'storage.example.test',
       encryptionSecret:secret,fetchImpl:fetchMock
     })).rejects.toThrow(/archive size/);
     expect(fetchMock).not.toHaveBeenCalled();
   }finally{cleanup();}
 });
 it('fails on rejected storage or unreachable service without logging presigned secrets',async()=>{
   const {filename,cleanup}=fixture();try{
     const args={url:'https://storage.example.test/object?token=secret',expectedHost:'storage.example.test',encryptionSecret:secret};
     await expect(uploadEncryptedBackup(filename,{...args,fetchImpl:vi.fn().mockResolvedValue({status:403})})).rejects.toThrow('Encrypted off-host backup upload failed.');
     await expect(uploadEncryptedBackup(filename,{...args,fetchImpl:vi.fn().mockRejectedValue(new Error('private token'))})).rejects.toThrow('Encrypted off-host backup upload failed.');
   }finally{cleanup();}
 });
});

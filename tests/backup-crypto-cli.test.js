import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/backup-crypto.js');
const secret='isolated-regression-fixture-secret-more-than-32-chars';
const execute=(mode,input,output)=>spawnSync(process.execPath,[cli,mode,input,output],{
 encoding:'utf8',timeout:20000,
 env:{...process.env,BACKUP_ENCRYPTION_SECRET:secret,TURSO_DATABASE_URL:''}
});
describe('Operator backup encryption CLI safety',()=>{
 it('creates private non-overwriting encrypted output and can restore only to a new file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-crypto-qa-'));
  try{
   const input=path.join(dir,'source.json'),encrypted=path.join(dir,'source.enc.json'),recovered=path.join(dir,'recovered.json');
   fs.writeFileSync(input,'{"qaRecord":"do-not-leak"}');
   const enc=execute('encrypt',input,encrypted);
   expect(enc.status,enc.stderr).toBe(0);
   expect(fs.readFileSync(encrypted,'utf8')).not.toContain('do-not-leak');
   expect(fs.statSync(encrypted).mode&0o077).toBe(0);
   expect(execute('encrypt',input,encrypted).status).not.toBe(0);
   expect(execute('decrypt',encrypted,input).status).not.toBe(0);
   const dec=execute('decrypt',encrypted,recovered);
   expect(dec.status,dec.stderr).toBe(0);
   expect(fs.readFileSync(recovered,'utf8')).toBe('{"qaRecord":"do-not-leak"}');
   expect(fs.readFileSync(input,'utf8')).toBe('{"qaRecord":"do-not-leak"}');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 },30000);
 it('rejects symlink inputs without writing a destination',()=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-crypto-qa-'));
   try{
    const actual=path.join(dir,'actual.json'),linked=path.join(dir,'linked.json'),dest=path.join(dir,'output.enc');
    fs.writeFileSync(actual,'{"fixture":true}');
    fs.symlinkSync(actual,linked);
    expect(execute('encrypt',linked,dest).status).not.toBe(0);
    expect(fs.existsSync(dest)).toBe(false);
   }finally{fs.rmSync(dir,{recursive:true,force:true});}
 },30000);
});

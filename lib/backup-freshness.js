// Read-only freshness and basic format checks for completed local backup files.
// Off-host storage, encryption, restoration and backup scheduling are separate gates.
import fs from 'node:fs';
import path from 'node:path';
import {snapshotHash} from './snapshots.js';

const BACKUP_NAME=/^gastroflow-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.(json|db)$/;
const SQLITE_MAGIC=Buffer.from('SQLite format 3\0');

export function checkBackupFreshness(directory,{
 now=Date.now(),
 maxAgeMs=26*60*60*1000,
 minSizeBytes=100
}={}){
 const maximum=Number(maxAgeMs),minimum=Number(minSizeBytes);
 if(!Number.isFinite(maximum)||maximum<=0||!Number.isFinite(minimum)||minimum<1)
   throw new Error('Invalid backup freshness policy.');
 let files;
 try{files=fs.readdirSync(directory,{withFileTypes:true});}
 catch{return {ok:false,reason:'backup_directory_unavailable'};}
 let validAt=-Infinity;
 let foundCandidate=false;
 for(const entry of files){
   if(!entry.isFile()||!BACKUP_NAME.test(entry.name))continue;
   const filename=path.join(directory,entry.name);
   let stat;
   try{stat=fs.lstatSync(filename);}catch{continue;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size<minimum)continue;
   foundCandidate=true;
   // Do not let future-dated files satisfy the freshness check.
   if(stat.mtimeMs>now+60_000)continue;
   try{
     const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
     try{
       const header=Buffer.alloc(16);fs.readSync(descriptor,header,0,16,0);
       if(entry.name.endsWith('.db')){
         if(!header.equals(SQLITE_MAGIC))continue;
       }else{
         // A logical snapshot must carry a correct integrity hash.
         const data=JSON.parse(fs.readFileSync(descriptor,'utf8'));
         if(data?.payload?.format!=='gastroflow-logical-backup'||
           data.payload.version!==1||
           data.sha256!==snapshotHash(data.payload))continue;
       }
     }finally{fs.closeSync(descriptor);}
   }catch{continue;}
   validAt=Math.max(validAt,stat.mtimeMs);
 }
 if(!Number.isFinite(validAt))return {ok:false,reason:foundCandidate?'backup_invalid':'backup_missing'};
 if(now-validAt>maximum)return {ok:false,reason:'backup_stale',ageMs:Math.round(now-validAt)};
 return {ok:true,ageMs:Math.max(0,Math.round(now-validAt))};
}

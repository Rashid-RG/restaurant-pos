#!/usr/bin/env node
// Offline comparison of TWO PREEXISTING schema-inventory JSON files.
// Does not connect to databases or open a network connection, and never writes.
import fs from 'node:fs';
import path from 'node:path';
import { assessDatabaseMigration } from '../lib/database-assessment.js';

const args=process.argv.slice(2);
if(args.length!==2 || args.some(arg=>!arg || arg.startsWith('-') || /^(?:file:|https?:|libsql:|wss?:)/i.test(arg))) {
  console.error('Usage: node scripts/assess-local-schema.js EXISTING-INVENTORY.json PROPOSED-INVENTORY.json');
  process.exitCode=2;
}else{
  try{
    const inventories=args.map(arg=>{
      const filename=path.resolve(arg);
      const file=fs.lstatSync(filename);
      if(!file.isFile() || file.isSymbolicLink() || file.size>5*1024*1024)
        throw new Error('Input must be a regular, non-symlink, local inventory JSON under 5 MiB');
      const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      try {
        return JSON.parse(fs.readFileSync(fd,'utf8'));
      } finally {fs.closeSync(fd);}
    });
    console.log(JSON.stringify(assessDatabaseMigration(inventories[0],inventories[1]),null,2));
  }catch(error){
    console.error('Offline schema assessment refused:',error.message);
    process.exitCode=1;
  }
}

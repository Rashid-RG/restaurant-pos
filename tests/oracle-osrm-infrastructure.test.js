import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir=path.resolve(process.cwd(),'infra/oracle-osrm');
const read=f=>fs.readFileSync(path.join(dir,f),'utf8');
describe('Oracle OSRM pilot deployment safety',()=>{
 it('does not publish OSRM native port 5000 or ship a database',()=>{
   const config=read('compose.yaml');
   expect(config).toContain('platform: linux/arm64');
   expect(config).toContain('./data:/data:ro');
   expect(config).toContain('expose:');
   expect(config).not.toMatch(/-\s*["']?5000:5000/);
   expect(config).not.toMatch(/postgres:|mysql:|sqlite:|database:/);
 });
 it('requires a key for a restricted routing endpoint behind HTTPS',()=>{
   const caddy=read('Caddyfile');
   expect(caddy).toContain('X-GastroFlow-Routing-Key {$GASTROFLOW_ROUTING_KEY}');
   expect(caddy).toContain('path /route/v1/driving/*');
   expect(caddy).toContain('respond "Forbidden" 403');
   expect(read('compose.yaml')).toContain('443:443');
 });
 it('preprocesses maps separately from read-only runtime OSRM storage',()=>{
   const script=read('prepare-sri-lanka.sh');
   for(const cmd of ['osrm-extract','osrm-partition','osrm-customize'])expect(script).toContain(cmd);
   expect(script).toContain('linux/arm64');
   expect(script).toContain('sri-lanka-latest.osm.pbf');
   expect(script).toContain('-v "$PWD/data:/data"');
   expect(read('compose.yaml')).toContain('./data:/data:ro');
 });
 it('keeps credentials out of git and documents rollback',()=>{
   expect(read('.gitignore')).toMatch(/\.env/);
   expect(read('.env.example')).toContain('REPLACE_WITH_');
   const guide=read('README.md');
   expect(guide).toContain('Rollback');
   expect(guide).toContain('TURSO');
   expect(guide).toContain('production');
 });
});

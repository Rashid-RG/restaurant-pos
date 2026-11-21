import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// A dedicated signing domain prevents refresh tokens from being accepted as
// bearer access JWTs. Browser stores this cookie as HttpOnly (not localStorage).
const ttlSeconds=7*24*60*60;
const cookieName='gastroflow_staff_refresh';

function signingKey(jwtSecret){
  if(typeof jwtSecret!=='string'||jwtSecret.length<16)
    throw new TypeError('Configured JWT secret required');
  return crypto.createHmac('sha256',jwtSecret).update('gastroflow-staff-refresh-v1').digest();
}
export function staffRefreshCredentialVersion({passwordHash,jwtSecret}){
  if(typeof passwordHash!=='string'||!passwordHash)throw new TypeError('Staff password hash required');
  return crypto.createHmac('sha256',signingKey(jwtSecret)).update(passwordHash).digest('hex').slice(0,32);
}
export function createStaffRefreshToken({user,jwtSecret}){
  if(!user?.id||!user?.tenant_id||!user?.passwordHash)throw new TypeError('Valid staff identity required');
  return jwt.sign({id:user.id,tenant_id:user.tenant_id,type:'staff-refresh',credentialVersion:staffRefreshCredentialVersion({passwordHash:user.passwordHash,jwtSecret})},
    signingKey(jwtSecret),{algorithm:'HS256',expiresIn:ttlSeconds});
}
export function verifyStaffRefreshToken({token,jwtSecret}){
  const claims=jwt.verify(token,signingKey(jwtSecret),{algorithms:['HS256']});
  if(claims.type!=='staff-refresh'||typeof claims.id!=='string'||
     typeof claims.tenant_id!=='string'||typeof claims.credentialVersion!=='string')throw new Error('Invalid staff refresh identity');
  return claims;
}
export function readStaffRefreshCookie(header=''){
  if(typeof header!=='string'||header.length>12000)return null;
  const item=header.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));
  if(!item)return null;
  const value=item.slice(cookieName.length+1);
  return /^[A-Za-z0-9_.-]{16,6000}$/.test(value)?value:null;
}
export function staffRefreshCookie(token,{secure=true,clear=false}={}){
  const parts=[cookieName+'='+(clear?'':token),'Path=/api/auth','HttpOnly','SameSite=Lax'];
  if(secure)parts.push('Secure');
  if(clear)parts.push('Max-Age=0');
  else parts.push('Max-Age='+ttlSeconds);
  return parts.join('; ');
}

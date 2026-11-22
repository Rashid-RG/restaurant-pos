import {describe,it,expect} from 'vitest';
import jwt from 'jsonwebtoken';
import {createStaffRefreshToken,verifyStaffRefreshToken,readStaffRefreshCookie,staffRefreshCookie} from './staff-session-refresh.js';
const secret='test-only-long-secret-for-staff-session-refresh';
const user={id:'staff-1',tenant_id:'default_tenant',passwordHash:'bcrypt-hash-fixture'};
describe('staff refresh cookie security',()=>{
  it('issues an HttpOnly scoped secure cookie, not a browser-readable token',()=>{
    const token=createStaffRefreshToken({user,jwtSecret:secret});
    const cookie=staffRefreshCookie(token);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth');
    expect(readStaffRefreshCookie('other=abc; '+cookie.split(';')[0])).toBe(token);
    const claims=verifyStaffRefreshToken({token,jwtSecret:secret});
    expect(claims.id).toBe('staff-1');
    expect(claims.tenant_id).toBe('default_tenant');
  });
  it('cannot be verified with the staff bearer signing key',()=>{
    const token=createStaffRefreshToken({user,jwtSecret:secret});
    expect(()=>jwt.verify(token,secret)).toThrow();
  });
  it('rejects modified refresh tokens and another secret',()=>{
    const token=createStaffRefreshToken({user,jwtSecret:secret});
    expect(()=>verifyStaffRefreshToken({token:token+'x',jwtSecret:secret})).toThrow();
    expect(()=>verifyStaffRefreshToken({token,jwtSecret:secret+'changed'})).toThrow();
  });
  it('removes refresh cookie without exposing token in JavaScript',()=>{
    const cleared=staffRefreshCookie('',{clear:true});
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(readStaffRefreshCookie('')).toBe(null);
  });
});

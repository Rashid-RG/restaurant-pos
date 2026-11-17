import { describe, expect, it, vi } from 'vitest';
import { createPasswordResetResolver } from '../lib/identity/index.js';

const row = {id:'reset-A',userId:'account-A',expiresAt:10000,consumedAt:null};
function harness(result=row) {
  const dbGet=vi.fn(async()=>result);
  const hashCode=vi.fn(value=>'hashed:'+value);
  const lookupByEmail=vi.fn(async()=>({id:'account-A'}));
  const resolve=createPasswordResetResolver({dbGet,hashCode,now:()=>9000});
  return {dbGet,hashCode,lookupByEmail,resolve};
}

describe('identity domain password reset resolution',()=>{
  it('requires explicit DB, hash, and clock providers',()=>{
    expect(()=>createPasswordResetResolver({})).toThrow(TypeError);
  });
  it('resolves a valid token without exposing plaintext in the lookup',async()=>{
    const h=harness();
    expect(await h.resolve('customer',{token:'private-secret',email:'ignored@example.test',code:'bad'})).toEqual(row);
    expect(h.dbGet).toHaveBeenCalledWith(
      'SELECT * FROM password_resets WHERE userType = ? AND tokenHash = ? AND consumedAt IS NULL',
      ['customer','hashed:private-secret']
    );
    expect(h.dbGet.mock.calls[0][1]).not.toContain('private-secret');
  });
  it('checks the identifier/code combination and binds staff type to the reset',async()=>{
    const h=harness();
    expect(await h.resolve('staff',{email:'staff-A',code:'123456',lookupByEmail:h.lookupByEmail})).toEqual(row);
    expect(h.lookupByEmail).toHaveBeenCalledWith('staff-A');
    expect(h.dbGet).toHaveBeenCalledWith(
      'SELECT * FROM password_resets WHERE userType = ? AND userId = ? AND codeHash = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
      ['staff','account-A','hashed:123456']
    );
  });
  it('rejects expired or nonexistent proof and unknown identifiers',async()=>{
    const expired=harness({...row,expiresAt:8999});
    expect(await expired.resolve('customer',{token:'secret'})).toBeNull();
    const unknown=harness(null);
    expect(await unknown.resolve('staff',{token:'secret'})).toBeNull();
    const h=harness();
    const lookupByEmail=vi.fn(async()=>null);
    expect(await h.resolve('customer',{email:'missing',code:'123456',lookupByEmail})).toBeNull();
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(await h.resolve('customer',{})).toBeNull();
  });
  it('treats expiration boundary as still valid, as before',async()=>{
    const h=harness({...row,expiresAt:9000});
    expect(await h.resolve('customer',{token:'secret'})).toMatchObject({id:'reset-A'});
  });
});

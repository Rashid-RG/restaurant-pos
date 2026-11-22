import {describe,it,expect} from 'vitest';
import {nativeApiOrigin,resolveApiUrl} from '../apps/customer-web/src/utils/native-api-origin.js';

describe('GastroFood native HTTPS API routing',()=>{
  it('preserves existing browser/PWA and localhost development API routes',()=>{
    expect(resolveApiUrl('/api/public/menu',{location:{port:'',origin:'https://gastroflow-staging.onrender.com'}}))
      .toBe('https://gastroflow-staging.onrender.com/api/public/menu');
    expect(resolveApiUrl('/api/public/menu',{location:{protocol:'http:',hostname:'localhost',port:'3001',origin:'http://localhost:3001'}}))
      .toBe('http://localhost:5000/api/public/menu');
  });
  it('routes packaged native web assets API calls to an explicit HTTPS backend',()=>{
    expect(resolveApiUrl('/api/public/menu?tenantId=a',{nativeBuild:true,configuredOrigin:'https://gastroflow-staging.onrender.com'}))
      .toBe('https://gastroflow-staging.onrender.com/api/public/menu?tenantId=a');
  });
  it('fails closed on insecure, relative, credentialed or malformed origins',()=>{
    for(const origin of ['',undefined,'http://api.test','https://admin:pw@example.org','https://example.org/path','https://example.org?x=1','ftp://example.org'])
      expect(()=>nativeApiOrigin(origin)).toThrow();
  });
  it('rejects absolute external API endpoints',()=>{
    expect(()=>resolveApiUrl('https://evil.example/api/public/menu',{nativeBuild:true,configuredOrigin:'https://example.org'})).toThrow();
    expect(()=>resolveApiUrl('//evil.example/api/public/menu',{nativeBuild:true,configuredOrigin:'https://example.org'})).toThrow();
  });
});

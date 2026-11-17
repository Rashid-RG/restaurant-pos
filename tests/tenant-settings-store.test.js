import {describe,expect,it} from 'vitest';
import {createTenantSettingsStore} from '../lib/tenancy/settings-store.js';

const createFixture=()=>{
  const data=new Map([['restaurant-A',new Map([['name','Alpha'],['timezone','Asia/Colombo'],['empty','']])],
    ['restaurant-B',new Map([['name','Beta']])],['default_tenant',new Map([['name','Default']])]]);
  const calls=[];
  const dbGet=async(sql,params)=>{
    calls.push({sql,params});
    const [tid,key]=params;
    const store=data.get(tid);
    if(sql.startsWith('SELECT key'))return store?.has(key)?{key}:undefined;
    return store?.has(key)?{value:store.get(key)}:undefined;
  };
  const dbAll=async(sql,params)=>{
    calls.push({sql,params});
    return params.slice(1).filter(key=>data.get(params[0])?.has(key)).map(key=>({key,value:data.get(params[0]).get(key)}));
  };
  const dbRun=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('UPDATE'))data.get(params[1]).set(params[2],params[0]);
    else {
      const [tid,key,value]=params;
      if(!data.has(tid))data.set(tid,new Map());
      data.get(tid).set(key,value);
    }
  };
  return {repository:createTenantSettingsStore({dbGet,dbAll,dbRun}),calls,data};
};

describe('multi-tenant settings repository boundaries',()=>{
  it('reads the requested tenant only, without falling back to another tenant',async()=>{
    const {repository,calls}=createFixture();
    expect(await repository.getSetting('restaurant-A','name')).toBe('Alpha');
    expect(await repository.getSetting('restaurant-B','name')).toBe('Beta');
    expect(await repository.getSetting('restaurant-B','timezone','not-set')).toBe('not-set');
    expect(calls.every(c=>c.sql.includes('tenant_id = ?'))).toBe(true);
    expect(calls.map(c=>c.params[0])).toEqual(['restaurant-A','restaurant-B','restaurant-B']);
  });
  it('retains historical default tenant semantics and first-existing-key behavior',async()=>{
    const {repository}=createFixture();
    expect(await repository.getSetting(undefined,'name')).toBe('Default');
    expect(await repository.getSettingAny('restaurant-A',['missing','empty','name'])).toBe('');
    expect(await repository.getSettingAny('restaurant-A',['missing','absent'],'fallback')).toBe('fallback');
    expect(await repository.getSettingsMap('restaurant-B',[])).toEqual({});
  });
  it('retrieves key maps with parameterized SQL and tenant-specific results',async()=>{
    const {repository,calls}=createFixture();
    expect(await repository.getSettingsMap('restaurant-A',['name','timezone','missing'])).toEqual({
      name:'Alpha',timezone:'Asia/Colombo',
    });
    expect(await repository.getSettingsMap('restaurant-B',['name','timezone'])).toEqual({name:'Beta'});
    expect(calls.every(c=>c.params[0]==='restaurant-A'||c.params[0]==='restaurant-B')).toBe(true);
    expect(calls[0].sql).toContain('key IN (?,?,?)');
  });
  it('updates and inserts without changing another restaurant settings',async()=>{
    const {repository,data,calls}=createFixture();
    await repository.setSetting('restaurant-A','name','New Alpha');
    await repository.setSetting('restaurant-A','newSetting',null);
    expect(data.get('restaurant-A').get('name')).toBe('New Alpha');
    expect(data.get('restaurant-A').get('newSetting')).toBe('');
    expect(data.get('restaurant-B').get('name')).toBe('Beta');
    expect(calls.filter(c=>/^(?:UPDATE|INSERT)/.test(c.sql)).every(c=>c.sql.includes('tenant_id'))).toBe(true);
  });
  it('rejects incomplete repository injection instead of silently opening a database',()=>{
    expect(()=>createTenantSettingsStore({dbGet:()=>{}})).toThrow(TypeError);
  });
});

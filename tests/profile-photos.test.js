import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {profilePhotoSchema,registerProfilePhotos} from '../routes/profile-photos.js';

it('stores validated photos privately for the authenticated tenant, role and account',async()=>{
  const db=new DatabaseSync(':memory:'); db.exec(profilePhotoSchema);
  const endpoints=new Map();
  const auth={customer:()=>{},driver:()=>{}};
  const app=Object.fromEntries(['get','put'].map(m=>[m,(path,middleware,handler)=>endpoints.set(m+path,{middleware,handler})]));
  registerProfilePhotos(app,{authenticateCustomer:auth.customer,authenticateDriver:auth.driver,
    dbGet:(sql,args)=>db.prepare(sql).get(...args),dbRun:(sql,args)=>db.prepare(sql).run(...args)});
  async function call(method,role,tenant,id,body){
    const path=role==='driver'?'/api/public/driver/profile/photo':'/api/customer/profile/photo';
    const {middleware,handler}=endpoints.get(method+path);
    expect(middleware).toBe(auth[role]);
    const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(data){this.data=data;}};
    await handler({[role]:{id,driverId:id,tenant_id:tenant},body},res,e=>{throw e;});return res;
  }
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lwsAAAAASUVORK5CYII=';
  for(const role of ['customer','driver']){
    expect((await call('put',role,'a','1',{photo})).code).toBe(200);
    expect((await call('get',role,'a','1')).data.photo).toBe(photo);
    expect((await call('get',role,'a','2')).data.photo).toBeNull();
    expect((await call('get',role,'b','1')).data.photo).toBeNull();
    expect((await call('get',role==='driver'?'customer':'driver','a','1')).data.photo).toBeNull();
    expect((await call('put',role,'a','1',{photo:'bad'})).code).toBe(400);
    expect((await call('get',role,'a','1')).data.photo).toBe(photo);
    expect((await call('put',role,'a','1',{photo:null})).code).toBe(200);
    expect((await call('get',role,'a','1')).data.photo).toBeNull();
  }
  db.close();
});

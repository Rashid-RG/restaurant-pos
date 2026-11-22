import {validateProofImage} from '../lib/delivery-proof.js';

export const profilePhotoSchema=`CREATE TABLE IF NOT EXISTS account_profile_photos (
      tenant_id TEXT NOT NULL, role TEXT NOT NULL, account_id TEXT NOT NULL, photo TEXT NOT NULL,
      PRIMARY KEY (tenant_id,role,account_id)
    )`;

export function registerProfilePhotos(app,{authenticateCustomer,authenticateDriver,dbRun,dbGet}) {
  for (const [role, path, authenticate] of [
    ['customer','/api/customer/profile/photo',authenticateCustomer],
    ['driver','/api/public/driver/profile/photo',authenticateDriver]
  ]) {
    const owner=req=>role==='customer' ? [req.customer.tenant_id,role,req.customer.id] : [req.driver.tenant_id,role,req.driver.driverId];
    app.get(path,authenticate,async(req,res,next)=>{
      try {
        const row=await dbGet('SELECT photo FROM account_profile_photos WHERE tenant_id=? AND role=? AND account_id=?',owner(req));
        res.set('Cache-Control','private, no-store').json({photo:row?.photo??null});
      } catch(err){next(err);}
    });
    app.put(path,authenticate,async(req,res,next)=>{
      const photo=req.body?.photo;
      if(photo!==null){
        try {
          if(typeof photo!=='string'||!photo||photo.length>175000)throw Error('Choose a smaller profile photo.');
          validateProofImage(photo,'Profile photo');
        } catch(err){return res.status(400).json({error:err.message});}
      }
      try {
        if(photo===null)await dbRun('DELETE FROM account_profile_photos WHERE tenant_id=? AND role=? AND account_id=?',owner(req));
        else await dbRun('INSERT INTO account_profile_photos (tenant_id,role,account_id,photo) VALUES (?,?,?,?) ON CONFLICT(tenant_id,role,account_id) DO UPDATE SET photo=excluded.photo',[...owner(req),photo]);
        res.set('Cache-Control','no-store').json({saved:true});
      } catch(err){next(err);}
    });
  }
}

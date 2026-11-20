import {createH3RiderIndex} from '../lib/delivery/h3-rider-index.js';
import * as h3 from 'h3-js';

/** Optional single-process staging pilot. Disabled unless explicitly enabled. */
export function createRiderPresenceRouter({
  express,authenticateDriver,authenticateToken,requireRole,dbGet,dbAll,presence,
  enabled=false,clock=Date.now
}){
  const router=express.Router();
  const gate=(req,res,next)=>enabled?next():res.status(404).json({error:'Location discovery is not enabled.'});
  router.post('/public/driver/on-duty-location',gate,authenticateDriver,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const tenantId=req.driver.tenant_id,driverId=req.driver.driverId;
    if(req.body?.consent===false){
      presence.revoke(tenantId,driverId);
      return res.json({success:true,sharing:false});
    }
    if(req.body?.consent!==true)return res.status(400).json({error:'Explicit on-duty location consent required.'});
    const d=await dbGet(
      `SELECT d.status,d.licenseReviewRequired,d.licenseVerifiedUntil,
        (SELECT m.review_state FROM driver_manual_reviews m WHERE m.driver_id=d.id AND m.tenant_id=d.tenant_id) AS manualReview,
        (SELECT c.state FROM driver_identity_checks c WHERE c.driver_id=d.id AND c.tenant_id=d.tenant_id AND COALESCE(c.check_type,'identity')='identity' ORDER BY c.created_at DESC LIMIT 1) AS identityReview
       FROM drivers d WHERE d.id=? AND d.tenant_id=?`,[driverId,tenantId]);
    const verified = d && (
      ['approved','verified'].includes(String(d.manualReview||'').toLowerCase()) ||
      ['approved','verified'].includes(String(d.identityReview||'').toLowerCase()) ||
      (Number(d.licenseReviewRequired)===0 && Number(d.licenseVerifiedUntil)>clock())
    );
    if(!d||!['available','active'].includes(d.status)||!verified){
      presence.revoke(tenantId,driverId);
      return res.status(403).json({error:'Verified on-duty availability is required.'});
    }
    const {lat,lng,accuracyMeters,recordedAt}=req.body;
    const result=presence.record({tenantId,driverId,lat,lng,accuracyMeters,recordedAt,consent:true});
    if(!result.accepted)return res.status(422).json({error:'Location fix rejected.',code:result.reason});
    return res.json({success:true,sharing:true,expiresInSeconds:90});
  });
  router.post('/public/driver/off-duty-location',gate,authenticateDriver,(req,res)=>{
    presence.revoke(req.driver.tenant_id,req.driver.driverId);
    res.set('Cache-Control','no-store').json({success:true,sharing:false});
  });
  router.get('/delivery/nearby-riders',gate,authenticateToken,requireRole(['owner','manager']),async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const lat=Number(req.query.lat),lng=Number(req.query.lng);
    if(req.query.lat===undefined||req.query.lng===undefined||!Number.isFinite(lat)||
      !Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)
      return res.status(400).json({error:'A valid dispatch origin is required.'});
    const tenantId=req.tenantId;
    const rows=presence.list(tenantId);
    // A dispatch or status update can make an earlier GPS heartbeat obsolete.
    // Always verify current availability against the authoritative tenant DB.
    const available=await dbAll("SELECT id FROM drivers WHERE tenant_id=? AND status IN ('available','active')",[tenantId]);
    const allowed=new Set(available.map(d=>d.id));
    const riders=rows.filter(r=>allowed.has(r.driverId)).map(r=>({
      id:r.driverId,tenantId,status:'available',verified:true,onDuty:true,locationConsent:true,
      fix:{lat:r.lat,lng:r.lng,accuracyMeters:r.accuracyMeters,updatedAt:r.recordedAt}
    }));
    // Real H3 v4 spatial prefilter. Cell radius is deliberately bounded and
    // results remain subject to actual distance, age and tenant checks.
    const index=createH3RiderIndex(h3,{resolution:8});
    index.replaceTenant(tenantId,riders,clock());
    const candidates=index.nearby({
      tenantId,origin:{lat,lng},ringCount:4,now:clock(),maxRadiusMeters:10000
    });
    index.clearTenant(tenantId);
    return res.json({candidates,method:'h3_cell_shortlist_not_road_eta'});
  });
  return router;
}

// A GPS row is not a driver credential. Match it against the currently
// assigned driver on its originating order, with the same restaurant tenant.
// Legacy rows may contain a name; accept a name only if unique in that tenant.
export async function loadVerifiedDispatchPings(dbAll,tenantId,since){
  if(!tenantId||!Number.isFinite(since))return [];
  const rows=await dbAll(`
    SELECT d.id AS driverId,d.name AS driverName,dl.lat,dl.lng,dl.updatedAt
      FROM driver_locations dl
      JOIN orders o ON o.id=dl.orderId AND o.tenant_id=?
      JOIN drivers d ON d.id=o.driverId AND d.tenant_id=o.tenant_id
     WHERE dl.updatedAt>?
       AND d.status IN ('available','active')
       AND (dl.driverName=d.id OR (
          dl.driverName=d.name AND
          (SELECT COUNT(*) FROM drivers same_name
             WHERE same_name.tenant_id=d.tenant_id AND same_name.name=d.name)=1
       ))
     ORDER BY dl.updatedAt DESC LIMIT 200
  `,[tenantId,since]);
  const seen=new Set();
  return rows.filter(row=>{
    if(typeof row.driverId!=='string'||!row.driverId||seen.has(row.driverId)||
       !Number.isFinite(Number(row.lat))||!Number.isFinite(Number(row.lng))||
       Number(row.lat)<-90||Number(row.lat)>90||Number(row.lng)<-180||Number(row.lng)>180)return false;
    seen.add(row.driverId);
    return true;
  });
}

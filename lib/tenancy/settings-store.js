/**
 * Tenant-scoped settings access for GastroFlow's shared API.
 * Injected SQL helpers preserve the existing server contract and do not open
 * connections, create tables, or change live data at module import time.
 */
export function createTenantSettingsStore({dbGet,dbAll,dbRun}) {
  if (![dbGet,dbAll,dbRun].every(fn=>typeof fn==='function'))
    throw new TypeError('Tenant settings require database helper functions');

  const tenant=tenantId=>tenantId||'default_tenant';

  async function getSetting(tenantId,key,fallback=undefined) {
    const row=await dbGet('SELECT value FROM settings WHERE tenant_id = ? AND key = ?', [tenant(tenantId),key]);
    return row?row.value:fallback;
  }

  async function getSettingAny(tenantId,keys,fallback=undefined) {
    for(const key of keys) {
      const value=await getSetting(tenantId,key);
      if(value!==undefined&&value!==null)return value;
    }
    return fallback;
  }

  async function getSettingsMap(tenantId,keys) {
    if(!keys.length)return {};
    const rows=await dbAll(
      `SELECT key, value FROM settings WHERE tenant_id = ? AND key IN (${keys.map(()=>'?').join(',')})`,
      [tenant(tenantId),...keys]
    );
    return Object.fromEntries(rows.map(row=>[row.key,row.value]));
  }

  async function setSetting(tenantId,key,value) {
    const tid=tenant(tenantId);
    const existing=await dbGet('SELECT key FROM settings WHERE tenant_id = ? AND key = ?', [tid,key]);
    if(existing)
      await dbRun('UPDATE settings SET value = ? WHERE tenant_id = ? AND key = ?', [String(value??''),tid,key]);
    else
      await dbRun('INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tid,key,String(value??'')]);
  }

  return {getSetting,getSettingAny,getSettingsMap,setSetting};
}

/**
 * Tenant resource ownership policy for legacy POS endpoints.
 * The database lookup remains inside authenticated server middleware.
 * Keep these decisions pure and explicit: table names must NEVER come from
 * user-controlled input or an unvalidated path.
 */
const RESOURCE_TABLES=Object.freeze({
  orders:'orders',
  tables:'tables',
  menu_items:'menu_items',
  categories:'categories',
  customers:'customers',
  ingredients:'ingredients',
  'delivery/drivers':'drivers',
  tickets:'support_tickets',
  'support/tickets':'support_tickets',
});
const EXCLUDED_IDS=new Set(['offline-sync','transfer','merge','clear-all']);
const ROUTE_PATTERN=/^\/(orders|tables|menu_items|categories|customers|ingredients|delivery\/drivers|tickets|support\/tickets)(?:\/([^/]+))?/;

/** Returns null for unrelated, bypassed or deliberately separate API flows. */
export function tenantResourceRequest(path) {
  if(typeof path!=='string'||path.includes('/driver-chat')||/^\/tables\/[^/]+\/qr$/.test(path))
    return null;
  const match=path.match(ROUTE_PATTERN);
  if(!match)return null;
  return {table:RESOURCE_TABLES[match[1]],pathId:match[2]||null};
}

/** Preserve existing checks for body id and table-to-table transfer IDs. */
export function resourceIdsToAuthorize(resource,body) {
  if(!resource)return [];
  const ids=[];
  if(resource.pathId&&!EXCLUDED_IDS.has(resource.pathId))ids.push(decodeURIComponent(resource.pathId));
  if(body?.id)ids.push(body.id);
  if(resource.table==='tables') {
    for(const key of ['fromTableId','toTableId','sourceTableId','targetTableId'])
      if(body?.[key])ids.push(body[key]);
  }
  return ids;
}

/** Existing resources are strictly tenant-bound; missing rows are handled by routes. */
export function resourceBelongsToTenant(row,tenantId) {
  return !row||row.tenant_id===tenantId;
}

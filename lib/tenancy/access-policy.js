/**
 * Pure authorization decisions for GastroFlow's multi-tenant SaaS boundary.
 * No tokens, queries, database clients, environment variables or side effects.
 * Requests remain authenticated by the existing server middleware.
 */
export const STAFF_ROLES=Object.freeze(['owner','manager','cashier','kitchen','staff','admin']);

export function isStaffClaim(claims) {
  return Boolean(claims?.id && STAFF_ROLES.includes(claims.role) && claims.type!=='customer');
}

/** Missing claim tenants are NOT equivalent to an explicit restaurant tenant. */
export function isStaffAccountAuthorized(user,claims) {
  return Boolean(user && claims && user.tenant_id===claims.tenant_id &&
    STAFF_ROLES.includes(user.role));
}

export function isExpectedRestaurant(selectedTenant,userTenantId) {
  return Boolean(selectedTenant?.id && selectedTenant.id===userTenantId);
}

export function isPlatformOwner(user) {
  return user?.isPlatformAdmin===1 && user?.role==='owner';
}

export function hasStaffRole(user,roles) {
  return Boolean(user && Array.isArray(roles) && roles.includes(user.role));
}

/** A tenant in a URL is never permission to access a different tenant. */
export function isCustomerTenantMatch(requested,accountTenantId) {
  return !requested || requested===accountTenantId;
}

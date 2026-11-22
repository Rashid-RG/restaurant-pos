import { describe, expect, it } from 'vitest';
import { isPlatformWorkspace, visibleWorkspaceDestinations } from '../src/platform/workspace-policy.js';

const restaurant = [
  { id: 'dashboard', management: false },
  { id: 'staff-management', management: true },
  { id: 'rider-verification', management: true },
  { id: 'online-orders', management: false },
];
const platform = { id: 'platform' };

describe('restaurant vs platform-owner navigation boundaries', () => {
  it('restricts non-platform restaurant employees to their permitted destinations', () => {
    const cashier = { role: 'cashier', isPlatformAdmin: false };
    expect(isPlatformWorkspace(cashier, 'platform')).toBe(false);
    expect(visibleWorkspaceDestinations(cashier, 'platform', restaurant, platform).map(x => x.id))
      .toEqual(['dashboard', 'online-orders']);
  });

  it('keeps restaurant management available for restaurant owners, without platform access', () => {
    const owner = { role: 'owner', isPlatformAdmin: false };
    expect(visibleWorkspaceDestinations(owner, 'platform', restaurant, platform))
      .toEqual(restaurant);
  });

  it('shows only platform navigation to the designated platform owner in the platform workspace', () => {
    const platformOwner = { role: 'owner', isPlatformAdmin: true };
    expect(isPlatformWorkspace(platformOwner, 'platform')).toBe(true);
    expect(visibleWorkspaceDestinations(platformOwner, 'platform', restaurant, platform))
      .toEqual([platform]);
    expect(visibleWorkspaceDestinations(platformOwner, 'dashboard', restaurant, platform))
      .toEqual(restaurant);
  });

  it('never shows private restaurant verification to a platform-only account',()=>{
    const platformOnly={role:'platform_admin',isPlatformAdmin:true};
    const allowed=visibleWorkspaceDestinations(platformOnly,'dashboard',restaurant,platform).map(x=>x.id);
    expect(allowed).not.toContain('rider-verification');
    const manager={role:'manager',isPlatformAdmin:false};
    expect(visibleWorkspaceDestinations(manager,'dashboard',restaurant,platform).map(x=>x.id))
      .toContain('rider-verification');
  });

  it('does not trust a truthy string or missing flag as platform authority', () => {
    for (const user of [null, {}, {role:'owner', isPlatformAdmin:'true'}]) {
      expect(isPlatformWorkspace(user, 'platform')).toBe(false);
      expect(visibleWorkspaceDestinations(user, 'platform', restaurant, platform).some(x => x.id === 'platform'))
        .toBe(false);
    }
  });
});

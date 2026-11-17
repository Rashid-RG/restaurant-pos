// Platform-owner navigation is intentionally separate from restaurant navigation.
// This is a presentation-only boundary. The API must enforce platform authorization.
export const platformWorkspaceDestination = Object.freeze({
  id: 'platform',
  name: 'Platform administration',
  description: 'Manage restaurants, plans and platform operations',
});

export function isPlatformWorkspace(currentUser, activeTab) {
  return currentUser?.isPlatformAdmin === true && activeTab === 'platform';
}

export function visibleWorkspaceDestinations(currentUser, activeTab, restaurantDestinations, platformDestination) {
  if (isPlatformWorkspace(currentUser, activeTab)) return [platformDestination];
  return restaurantDestinations.filter(item =>
    !item.management || ['owner', 'manager'].includes(currentUser?.role) || currentUser?.isPlatformAdmin === true
  );
}

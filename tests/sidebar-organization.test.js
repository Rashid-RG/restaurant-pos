import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sidebar = readFileSync(new URL('../apps/pos-web/src/components/Sidebar.jsx', import.meta.url), 'utf8');
const destinations = readFileSync(new URL('../src/components/WorkspaceTools.jsx', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../src/platform/workspace-policy.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

describe('GastroFlow organized sidebar safety', () => {
  it('pins Overview then New Sale at the beginning of the main desktop navigation', () => {
    expect(sidebar).toContain("const pinned = ['dashboard', 'pos', 'menu']");
    expect(sidebar).toContain('{pinned.map(link)}');
    expect(sidebar).toContain("item.id === 'pos' ? 'sidebar-new-sale'");
    expect(destinations).toMatch(/id: 'dashboard'[\s\S]*id: 'pos'/);
  });
  it('keeps Menu directly on the desktop sidebar and routed to existing menu management', () => {
    expect(sidebar).toContain("const pinned = ['dashboard', 'pos', 'menu']");
    expect(destinations).toContain("id: 'menu', name: 'Menu'");
    expect(destinations).toContain("icon: UtensilsCrossed, management: true");
    expect(app).toContain("case 'menu':");
    expect(app).toContain('<Settings key="menu-management" initialSubTab="menu" />');
    expect(app).toContain('<Settings key="settings-home" />');
    expect(settings).toContain('allowed.includes(initialSubTab)');
  });
  it('shows selection background only for the active page, including pinned New Sale', () => {
    expect(sidebar).toContain("activeTab === item.id ? 'active' : ''");
    expect(css).toContain(".desktop-sidebar .sidebar-new-sale:not(.active) { background:transparent;");
    expect(css).toContain(".sidebar-item.active {");
    expect(css).not.toContain(".sidebar-new-sale:not(.active) { background:var(--color-primary-light);");
  });
  it('keeps Menu and Settings as separate page instances on sidebar switching', () => {
    expect(app).toMatch(/case 'menu':[\s\S]*<Settings key="menu-management" initialSubTab="menu" \/>/);
    expect(app).toMatch(/case 'settings':[\s\S]*<Settings key="settings-home" \/>/);
  });
  it('never requires opening a group to reach the cashier sale screen', () => {
    expect(sidebar.indexOf('{pinned.map(link)}')).toBeLessThan(sidebar.indexOf('{groups.map(group =>'));
    expect(sidebar).toContain('(collapsed || isOpen)');
  });
  it('preserves original navigation policy for role and platform isolation', () => {
    expect(sidebar).toContain('const items = useDestinations()');
    expect(policy).toContain('visibleWorkspaceDestinations');
    expect(policy).toContain("item.id !== 'rider-verification'");
    expect(sidebar).toContain("const inPlatform = platformOwner && activeTab === 'platform'");
  });
  it('preserves the first four original mobile navigation shortcuts', () => {
    expect(sidebar).toContain("const mobilePrimary = items.filter(item => item.id !== 'menu').slice(0, 4)");
    expect(sidebar).toContain('mobilePrimary.map(item =>');
    expect(sidebar).toContain("mobileMenu && <button");
    expect(sidebar).toContain("select('my-attendance')");
  });
  it('keeps future destinations reachable even when not assigned to a group', () => {
    expect(sidebar).toContain("const additional = items.filter(item => !known.has(item.id))");
    expect(sidebar).toContain("id: 'additional'");
    expect(sidebar).toContain('mobileSections.map(group =>');
  });
});

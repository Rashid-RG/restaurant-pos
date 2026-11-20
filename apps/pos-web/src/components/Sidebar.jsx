import React, { useState } from 'react';
import { UtensilsCrossed, PanelLeftClose, PanelLeftOpen, LogOut, Sun, Moon, MoreHorizontal, X, Clock3, ChevronDown } from 'lucide-react';
import { usePOS } from '../../../../src/context/POSContext';
import { useDestinations } from '../../../../src/components/WorkspaceTools';

// Presentation only: useDestinations retains the existing role/tenant policy.
// New Sale stays pinned immediately after Overview, never inside a group.
export const SIDEBAR_GROUPS = [
  { id: 'service', title: 'SERVICE & ORDERS', ids: ['floor', 'kds', 'online-orders', 'delivery'] },
  { id: 'business', title: 'BUSINESS MANAGEMENT', ids: ['online-store', 'rider-verification', 'inventory', 'cash-drawer', 'staff-management', 'expenses', 'customers'] },
  { id: 'insights', title: 'SALES & REPORTS', ids: ['sold-items'] },
  { id: 'system', title: 'SYSTEM & SUPPORT', ids: ['tickets', 'settings'] }
];

export function organizeSidebarDestinations(items) {
  const pinned = ['dashboard', 'pos'].map(id => items.find(item => item.id === id)).filter(Boolean);
  const groups = SIDEBAR_GROUPS.map(group => ({
    ...group, items: group.ids.map(id => items.find(item => item.id === id)).filter(Boolean)
  })).filter(group => group.items.length);
  const known = new Set([...pinned.map(item => item.id), ...groups.flatMap(group => group.items.map(item => item.id)), 'my-attendance']);
  // A future navigation destination must never silently disappear.
  const additional = items.filter(item => !known.has(item.id));
  if (additional.length) groups.push({ id: 'additional', title: 'MORE TOOLS', items: additional });
  return { pinned, groups };
}

export default function Sidebar({ collapsed, onToggle }) {
  const { activeTab, setActiveTab, darkMode, setDarkMode, logout, currentUser } = usePOS();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(['service', 'business']);
  const items = useDestinations();
  const { pinned, groups } = organizeSidebarDestinations(items);
  const platformOwner = currentUser?.isPlatformAdmin === true;
  const inPlatform = platformOwner && activeTab === 'platform';
  const switchWorkspace = () => select(inPlatform ? 'dashboard' : 'platform');
  const select = id => { setActiveTab(id); setMoreOpen(false); };
  const toggleGroup = id => setOpenGroups(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const link = item => <button key={item.id} type="button"
    className={`sidebar-item ${activeTab === item.id ? 'active' : ''} ${item.id === 'pos' ? 'sidebar-new-sale' : ''}`}
    onClick={() => select(item.id)} title={item.name} aria-label={item.name}
    aria-current={activeTab === item.id ? 'page' : undefined}>
    <item.icon size={19}/>{!collapsed && <span>{item.name}</span>}
  </button>;
  // Preserve the original mobile bottom bar including New Sale's exact position.
  const mobilePrimary = items.slice(0, 4);
  const mobileSecondary = items.slice(4).filter(item => item.id !== 'my-attendance');
  const mobileSections = organizeSidebarDestinations(mobileSecondary).groups;

  return <>
    <aside className={`sidebar desktop-sidebar ${collapsed ? 'collapsed' : ''} ${platformOwner ? 'platform-owner-sidebar' : ''}`} aria-label="Staff navigation">
      <div className="sidebar-brand"><img src="/pos-logo.svg" alt="" width="38" height="38"/>{!collapsed && <span><strong>gastroflow<span>.</span></strong><small>{inPlatform ? 'PLATFORM ADMINISTRATION' : 'RESTAURANT WORKSPACE'}</small></span>}</div>
      <button className="sidebar-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
      {platformOwner && <div className="platform-workspace-switcher" style={{padding: collapsed ? '8px 4px' : '10px 12px', borderBottom: '1px solid var(--border-color)'}}>
        {!collapsed && <small style={{display: 'block', fontWeight: 700, marginBottom: 8, color: 'var(--text-muted)'}}>PLATFORM OWNER · TWO WORKSPACES</small>}
        <button type="button" className="sidebar-utility platform-switch-button" onClick={switchWorkspace} title={inPlatform ? 'Switch to restaurant POS' : 'Switch to platform administration'} aria-label={inPlatform ? 'Switch to restaurant POS workspace' : 'Switch to platform administration workspace'} style={{width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-color)', borderRadius: 10}}>
          {inPlatform ? <UtensilsCrossed size={18}/> : <PanelLeftOpen size={18}/>}
          {!collapsed && <span><strong>{inPlatform ? 'Open restaurant POS' : 'Open platform admin'}</strong><small style={{display: 'block', fontSize: 11}}>Switch workspace</small></span>}
        </button>
      </div>}
      {!collapsed && <p className="sidebar-section-label">{platformOwner ? (inPlatform ? 'PLATFORM OWNER TOOLS' : 'RESTAURANT POS TOOLS') : 'WORKSPACE'}</p>}
      <nav className="sidebar-menu" aria-label="Restaurant navigation">
        {pinned.map(link)}
        {!collapsed && pinned.length > 0 && groups.length > 0 && <div className="sidebar-group-separator" aria-hidden="true"/>}
        {groups.map(group => {
          const isOpen = openGroups.includes(group.id) || group.items.some(item => item.id === activeTab);
          return <div key={group.id} className="sidebar-nav-group">
            {!collapsed && <button type="button" className="sidebar-group-toggle" aria-expanded={isOpen}
              aria-controls={`sidebar-group-${group.id}`} onClick={() => toggleGroup(group.id)}>
              <span>{group.title}</span><ChevronDown size={14} className={isOpen ? 'expanded' : ''}/>
            </button>}
            {(collapsed || isOpen) && <div className="sidebar-group-items" id={`sidebar-group-${group.id}`}>
              {group.items.map(link)}
            </div>}
          </div>;
        })}
      </nav>
      <div className="sidebar-footer"><button className="sidebar-utility" onClick={() => select('my-attendance')} title="Open My Attendance"><Clock3 size={17}/>{!collapsed && <span>My attendance</span>}</button><button className="sidebar-utility" onClick={() => setDarkMode(!darkMode)} aria-label="Toggle color theme">{darkMode ? <Sun size={17}/> : <Moon size={17}/>}</button><div className="sidebar-account"><span className="account-avatar">{currentUser?.username?.slice(0, 2).toUpperCase()}</span>{!collapsed && <span><strong>{currentUser?.username}</strong><small>{currentUser?.isPlatformAdmin ? 'Platform owner' : currentUser?.role}</small></span>}<button onClick={logout} aria-label="Sign out"><LogOut size={16}/></button></div></div>
    </aside>
    <header className="mobile-top-header"><span className="mobile-brand"><img src="/pos-logo.svg" alt="" width="28" height="28"/> {inPlatform ? 'Platform admin' : 'gastroflow.'}</span>{platformOwner && <button onClick={switchWorkspace} aria-label={inPlatform ? 'Switch to restaurant POS workspace' : 'Switch to platform administration workspace'} style={{fontSize: 12, fontWeight: 700}}>{inPlatform ? 'Restaurant POS' : 'Platform admin'}</button>}<button onClick={logout} aria-label="Sign out"><LogOut size={19}/></button></header>
    <nav className="mobile-bottom-nav" aria-label="Mobile staff navigation">{mobilePrimary.map(item => <button key={item.id} className={`mobile-nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => select(item.id)}><item.icon size={20}/><span>{item.name}</span></button>)}<button className="mobile-nav-item" onClick={() => setMoreOpen(true)} aria-label="More pages"><MoreHorizontal size={20}/><span>More</span></button></nav>
    {moreOpen && <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)}><section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More pages" onClick={event => event.stopPropagation()}><header><h2>{inPlatform ? 'Platform administration' : 'Restaurant workspace'}</h2><button onClick={() => setMoreOpen(false)} aria-label="Close more pages"><X size={22}/></button></header>{platformOwner && <button onClick={switchWorkspace}>{inPlatform ? 'Switch to restaurant POS' : 'Switch to platform administration'}</button>}
      {mobileSections.map(group => <div className="mobile-nav-group" key={group.id}>
        <p className="mobile-nav-group-title">{group.title}</p>
        {group.items.map(item => <button key={item.id} onClick={() => select(item.id)}><item.icon size={20}/>{item.name}</button>)}
      </div>)}
      <button onClick={() => select('my-attendance')}><Clock3 size={20}/>My Attendance</button>
      <button onClick={() => setDarkMode(!darkMode)}><Sun size={20}/>Change appearance</button>
    </section></div>}
  </>;
}

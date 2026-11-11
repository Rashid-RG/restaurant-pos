import React, { useState } from 'react';
import { UtensilsCrossed, PanelLeftClose, PanelLeftOpen, LogOut, Sun, Moon, MoreHorizontal, X, Clock3 } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { useDestinations } from './WorkspaceTools';

export default function Sidebar({ collapsed, onToggle }) {
  const { activeTab, setActiveTab, darkMode, setDarkMode, logout, currentUser } = usePOS();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useDestinations();
  const platformOwner = currentUser?.isPlatformAdmin === true;
  const inPlatform = platformOwner && activeTab === 'platform';
  const switchWorkspace = () => select(inPlatform ? 'dashboard' : 'platform');
  const select = id => { setActiveTab(id); setMoreOpen(false); };
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
      <nav className="sidebar-menu">{items.map(item => <button key={item.id} className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => select(item.id)} title={item.name} aria-current={activeTab === item.id ? 'page' : undefined}><item.icon size={19}/>{!collapsed && <span>{item.name}</span>}</button>)}</nav>
      <div className="sidebar-footer"><button className="sidebar-utility" onClick={() => select("my-attendance")} title="Open My Attendance"><Clock3 size={17}/>{!collapsed && <span>My attendance</span>}</button><button className="sidebar-utility" onClick={() => setDarkMode(!darkMode)} aria-label="Toggle color theme">{darkMode ? <Sun size={17}/> : <Moon size={17}/>}{!collapsed && <span>{darkMode ? 'Light appearance' : 'Dark appearance'}</span>}</button><div className="sidebar-account"><span className="account-avatar">{currentUser?.username?.slice(0, 2).toUpperCase()}</span>{!collapsed && <span><strong>{currentUser?.username}</strong><small>{currentUser?.isPlatformAdmin ? 'Platform owner' : currentUser?.role}</small></span>}<button onClick={logout} aria-label="Sign out"><LogOut size={16}/></button></div></div>
    </aside>
    <header className="mobile-top-header"><span className="mobile-brand"><img src="/pos-logo.svg" alt="" width="28" height="28"/> {inPlatform ? 'Platform admin' : 'gastroflow.'}</span>{platformOwner && <button onClick={switchWorkspace} aria-label={inPlatform ? 'Switch to restaurant POS workspace' : 'Switch to platform administration workspace'} style={{fontSize: 12, fontWeight: 700}}>{inPlatform ? 'Restaurant POS' : 'Platform admin'}</button>}<button onClick={logout} aria-label="Sign out"><LogOut size={19}/></button></header>
    <nav className="mobile-bottom-nav" aria-label="Mobile staff navigation">{items.slice(0, 4).map(item => <button key={item.id} className={`mobile-nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => select(item.id)}><item.icon size={20}/><span>{item.name}</span></button>)}<button className="mobile-nav-item" onClick={() => setMoreOpen(true)}><MoreHorizontal size={20}/><span>More</span></button></nav>
    {moreOpen && <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)}><section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More pages" onClick={event => event.stopPropagation()}><header><h2>{inPlatform ? 'Platform administration' : 'Restaurant workspace'}</h2><button onClick={() => setMoreOpen(false)} aria-label="Close more pages"><X size={22}/></button></header>{platformOwner && <button onClick={switchWorkspace}>{inPlatform ? 'Switch to restaurant POS' : 'Switch to platform administration'}</button>}{items.slice(4).map(item => <button key={item.id} onClick={() => select(item.id)}><item.icon size={20}/>{item.name}</button>)}<button onClick={() => setDarkMode(!darkMode)}><Sun size={20}/>Change appearance</button></section></div>}
  </>;
}

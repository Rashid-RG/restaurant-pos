import React, { useState } from 'react';
import { UtensilsCrossed, PanelLeftClose, PanelLeftOpen, LogOut, Sun, Moon, MoreHorizontal, X, Clock3 } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { useDestinations } from './WorkspaceTools';

export default function Sidebar({ collapsed, onToggle }) {
  const { activeTab, setActiveTab, darkMode, setDarkMode, logout, currentUser } = usePOS();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useDestinations();
  const select = id => { setActiveTab(id); setMoreOpen(false); };
  return <>
    <aside className={`sidebar desktop-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Staff navigation">
      <div className="sidebar-brand"><img src="/pos-logo.svg" alt="" width="38" height="38"/>{!collapsed && <span><strong>gastroflow<span>.</span></strong><small>RESTAURANT WORKSPACE</small></span>}</div>
      <button className="sidebar-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
      {!collapsed && <p className="sidebar-section-label">WORKSPACE</p>}
      <nav className="sidebar-menu">{items.map(item => <button key={item.id} className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => select(item.id)} title={item.name} aria-current={activeTab === item.id ? 'page' : undefined}><item.icon size={19}/>{!collapsed && <span>{item.name}</span>}</button>)}</nav>
      <div className="sidebar-footer"><button className="sidebar-utility" onClick={() => select("my-attendance")} title="Open My Attendance"><Clock3 size={17}/>{!collapsed && <span>My attendance</span>}</button><button className="sidebar-utility" onClick={() => setDarkMode(!darkMode)} aria-label="Toggle color theme">{darkMode ? <Sun size={17}/> : <Moon size={17}/>}{!collapsed && <span>{darkMode ? 'Light appearance' : 'Dark appearance'}</span>}</button><div className="sidebar-account"><span className="account-avatar">{currentUser?.username?.slice(0, 2).toUpperCase()}</span>{!collapsed && <span><strong>{currentUser?.username}</strong><small>{currentUser?.isPlatformAdmin ? 'Platform owner' : currentUser?.role}</small></span>}<button onClick={logout} aria-label="Sign out"><LogOut size={16}/></button></div></div>
    </aside>
    <header className="mobile-top-header"><span className="mobile-brand"><img src="/pos-logo.svg" alt="" width="28" height="28"/> gastroflow.</span><button onClick={logout} aria-label="Sign out"><LogOut size={19}/></button></header>
    <nav className="mobile-bottom-nav" aria-label="Mobile staff navigation">{items.slice(0, 4).map(item => <button key={item.id} className={`mobile-nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => select(item.id)}><item.icon size={20}/><span>{item.name}</span></button>)}<button className="mobile-nav-item" onClick={() => setMoreOpen(true)}><MoreHorizontal size={20}/><span>More</span></button></nav>
    {moreOpen && <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)}><section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More pages" onClick={event => event.stopPropagation()}><header><h2>Your workspace</h2><button onClick={() => setMoreOpen(false)} aria-label="Close more pages"><X size={22}/></button></header>{items.slice(4).map(item => <button key={item.id} onClick={() => select(item.id)}><item.icon size={20}/>{item.name}</button>)}<button onClick={() => setDarkMode(!darkMode)}><Sun size={20}/>Change appearance</button></section></div>}
  </>;
}

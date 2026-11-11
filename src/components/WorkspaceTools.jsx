import { CookingIcon } from '../../shared/ui/AnimatedFeatureIcon.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Search, ArrowUpRight, Command, Store, ShoppingBag, LayoutDashboard, ChefHat, Package, Users, Truck, Settings, LifeBuoy, LayoutGrid, Receipt, ChartNoAxesCombined, ContactRound, AlarmClock, Banknote, ClipboardList } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { ConnectionStatus } from '../../shared/ui/Resilience.jsx';

export const workspaceDestinations = [
  { id: 'dashboard', name: 'Overview', description: 'Sales, activity and performance', icon: LayoutDashboard },
  { id: 'pos', name: 'New sale', description: 'Open the point of sale', icon: ShoppingBag },
  { id: 'floor', name: 'Tables', description: 'Manage your dining room', icon: LayoutGrid },
  { id: 'kds', name: 'Kitchen', description: 'Prepare and complete orders', icon: CookingIcon },
  { id: 'online-orders', name: 'Online Orders', description: 'Review, accept and manage customer online orders', icon: ClipboardList },
  { id: 'online-store', name: 'Online Store', description: 'Your customer storefront and online business', icon: Store, management: true },
  { id: 'delivery', name: 'Dispatch', description: 'Assign and track deliveries', icon: Truck },
  { id: 'inventory', name: 'Inventory', description: 'Menu, stock and ingredients', icon: Package, management: true },
  { id: 'sold-items', name: 'Sold Items', description: 'Items sold, quantities and gross item sales', icon: ChartNoAxesCombined, management: true },
  { id: 'my-attendance', name: 'My Attendance', description: 'Clock in or out and see your shifts', icon: AlarmClock },
  { id: 'cash-drawer', name: 'Cash Drawer', description: 'Opening cash, shift closing and daily cash balancing', icon: Banknote },
  { id: 'staff-management', name: 'Staff & Payroll', description: 'Employee management, attendance and salaries', icon: ContactRound, management: true },
  { id: 'expenses', name: 'Expenses', description: 'Daily restaurant expenses & costs', icon: Receipt, management: true },
  { id: 'customers', name: 'Customers', description: 'Customer relationships and loyalty', icon: Users },
  { id: 'tickets', name: 'Support', description: 'Customer conversations', icon: LifeBuoy },
  { id: 'settings', name: 'Settings', description: 'Your restaurant and team', icon: Settings, management: true }
];
export function useDestinations() {
  const { currentUser } = usePOS();
  const destinations = currentUser?.isPlatformAdmin === true ? [{ id: 'platform', name: 'Platform admin', description: 'Manage restaurants and their owners', icon: Store }, ...workspaceDestinations] : workspaceDestinations;
  return destinations.filter(item => !item.management || ['owner', 'manager'].includes(currentUser?.role) || Boolean(currentUser?.isPlatformAdmin));
}
export default function WorkspaceTools() {
  const { activeTab, setActiveTab, settings, currentUser } = usePOS();
  const destinations = useDestinations();
  const [query, setQuery] = useState('');
  const dialog = useRef(null);
  const search = useRef(null);
  const open = () => { setQuery(''); dialog.current.showModal(); search.current?.focus(); };
  useEffect(() => {
    const onKey = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog.current.open) dialog.current.close(); else open(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const results = destinations.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const navigate = id => { setActiveTab(id); dialog.current.close(); };
  return <>
    <div className="workspace-toolbar">
      <div className="workspace-location"><Store size={16}/><span>{settings.businessName || settings.restaurantName || 'My restaurant'}</span><span className="workspace-separator">/</span><strong>{destinations.find(item => item.id === activeTab)?.name || 'Workspace'}</strong></div>
      <div className="workspace-toolbar-actions"><ConnectionStatus compact/><button className="workspace-search" aria-label="Go to anything" onClick={open}><Search size={15}/><span>Go to anything</span><kbd>⌘ K</kbd></button><span className="workspace-avatar" title={currentUser?.username}>{currentUser?.username?.slice(0, 2).toUpperCase()}</span></div>
    </div>
    <dialog ref={dialog} className="command-dialog" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }} aria-label="Navigate your workspace">
      <div className="command-search"><Search size={20}/><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Where would you like to go?" aria-label="Search workspace" onKeyDown={event => { if (event.key === 'Enter' && results[0]) { event.preventDefault(); navigate(results[0].id); } }}/><button onClick={() => dialog.current.close()} aria-label="Close search">Esc</button></div>
      <p className="command-label">YOUR WORKSPACE</p>
      <div className="command-results">{results.length ? results.map(item => <button key={item.id} onClick={() => navigate(item.id)}><item.icon size={20}/><span><strong>{item.name}</strong><small>{item.description}</small></span><ArrowUpRight size={16}/></button>) : <p className="command-empty">No matching pages. Try “sales”, “kitchen” or “stock”.</p>}</div>
      <div className="command-footer"><Command size={13}/> Open with Ctrl / ⌘ K <span>Enter to select · Esc to close</span></div>
    </dialog>
  </>;
}

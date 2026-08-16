import React, { useState } from 'react';
import { POSProvider, usePOS } from './context/POSContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import POSView from './components/POSView';
import FloorPlan from './components/FloorPlan';
import KDSView from './components/KDSView';
import Inventory from './components/Inventory';
import Customers from './components/Customers';
import Settings from './components/Settings';
import DeliveryView from './components/DeliveryView';
import SupportTicketsView from './components/SupportTicketsView';
import Login from './components/Login';
import StoreStatusScreen from './components/StoreStatusScreen';

import SystemUpdatePrompt from '../apps/customer-web/src/components/SystemUpdatePrompt.jsx';

function AppContent() {
  const { activeTab, loading, currentUser, tenantLock, setTenantLock, logout } = usePOS();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // If the store is suspended or deleted, display full-screen status view immediately
  const isMasterOwner = currentUser?.role === 'owner' && (!currentUser?.tenant_id || currentUser?.tenant_id === 'default_tenant');
  if (tenantLock && !isMasterOwner) {
    return (
      <StoreStatusScreen
        status={tenantLock.status}
        storeId={tenantLock.storeId || currentUser?.tenant_id}
        storeName={tenantLock.storeName}
        customMessage={tenantLock.message}
        onRefresh={() => setTenantLock(null)}
        onSignOut={() => {
          logout();
          setTenantLock(null);
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('tenant');
            url.searchParams.delete('tenantId');
            window.location.href = url.pathname;
          } catch (_) {
            window.location.href = '/';
          }
        }}
      />
    );
  }

  if (!currentUser) {
    return <Login />;
  }

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <p>Loading GastroFlow Terminal...</p>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'pos':
        return <POSView />;
      case 'floor':
        return <FloorPlan />;
      case 'kds':
        return <KDSView />;
      case 'inventory':
        return <Inventory />;
      case 'customers':
        return <Customers />;
      case 'delivery':
        return <DeliveryView />;
      case 'tickets':
        return <SupportTicketsView />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      <SystemUpdatePrompt />
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      {renderActiveView()}
    </div>
  );
}


export default function App() {
  return (
    <POSProvider>
      <AppContent />
    </POSProvider>
  );
}

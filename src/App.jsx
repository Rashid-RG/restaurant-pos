import React, { useState } from 'react';
import WorkspaceTools from './components/WorkspaceTools';
import { ConnectionStatus } from '../shared/ui/Resilience.jsx';
import { POSProvider, usePOS } from './context/POSContext';
import Sidebar from './components/Sidebar';
import PlatformAdmin from './components/PlatformAdmin';
import Dashboard from './components/Dashboard';
import POSView from './components/POSView';
import FloorPlan from './components/FloorPlan';
import KDSView from './components/KDSView';
import Inventory from './components/Inventory';
import Customers from './components/Customers';
import Settings from './components/Settings';
import DeliveryView from './components/DeliveryView';
import SupportTicketsView from './components/SupportTicketsView';
import DailyExpenses from './components/DailyExpenses';
import SoldItems from './components/SoldItems';
import StaffManagement from './components/StaffManagement';
import MyAttendance from './components/MyAttendance';
import Login from './components/Login';
import StoreStatusScreen from './components/StoreStatusScreen';

function AppContent() {
  const { activeTab, loading, currentUser, tenantLock, setTenantLock, logout, platformBroadcast, setPlatformBroadcast } = usePOS();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // If the store is suspended or deleted, display full-screen status view immediately
  const isMasterOwner = currentUser?.isPlatformAdmin === true;
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
      case 'platform':
        return currentUser.isPlatformAdmin === true ? <PlatformAdmin /> : <Dashboard />;
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
      case 'sold-items':
        return ['owner', 'manager'].includes(currentUser?.role) || currentUser?.isPlatformAdmin ? <SoldItems /> : <Dashboard />;
      case 'my-attendance':
        return <MyAttendance />;
      case 'staff-management':
        return ['owner','manager'].includes(currentUser?.role) ? <StaffManagement /> : <Dashboard />;
      case 'expenses':
        return <DailyExpenses />;
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
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="workspace">
        <WorkspaceTools/>
        <ConnectionStatus/>
        {platformBroadcast && (
          <div style={{
            background: platformBroadcast.type === 'alert' ? '#ef4444' : platformBroadcast.type === 'warning' ? '#f59e0b' : '#2563eb',
            color: '#ffffff',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 100
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px' }}>📢</span>
              <span><strong>Platform Announcement:</strong> {platformBroadcast.message}</span>
            </div>
            <button
              onClick={() => setPlatformBroadcast(null)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', fontWeight: 'bold', padding: '0 4px', lineHeight: 1 }}
              aria-label="Dismiss announcement"
            >
              ×
            </button>
          </div>
        )}
        {renderActiveView()}
      </div>
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

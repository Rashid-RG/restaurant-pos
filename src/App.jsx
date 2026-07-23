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

function AppContent() {
  const { activeTab, loading, currentUser } = usePOS();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

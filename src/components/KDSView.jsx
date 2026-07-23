import React, { useEffect, useState } from 'react';
import { usePOS } from '../context/POSContext';

export default function KDSView() {
  const { orders, tables, updateOrderStatus, acceptOnlineOrder, rejectOnlineOrder } = usePOS();
  
  // Station filter state: 'all' | 'kitchen' | 'bar' | 'desserts'
  const [station, setStation] = useState('all');

  // Force re-render KDS timers every 10 seconds
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick((t) => t + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Filter items matching selected station
  const isItemForStation = (itemCategory) => {
    if (station === 'all') return true;
    const cat = (itemCategory || '').toLowerCase();
    if (station === 'bar') return cat.includes('drink') || cat.includes('beverage');
    if (station === 'desserts') return cat.includes('dessert') || cat.includes('bakery') || cat.includes('cake');
    if (station === 'kitchen') return !cat.includes('drink') && !cat.includes('dessert');
    return true;
  };

  // Filter out completed, cancelled, and served orders
  const activeOrders = orders.filter((o) => ['pending', 'preparing', 'ready', 'hold'].includes(o.status))
    .map((o) => {
      // Return order with station-filtered items
      const stationItems = o.items.filter(item => isItemForStation(item.category));
      return { ...o, filteredItems: stationItems };
    })
    .filter(o => station === 'all' || o.filteredItems.length > 0);

  const pendingOrders = activeOrders.filter((o) => ['pending', 'hold'].includes(o.status));
  const preparingOrders = activeOrders.filter((o) => o.status === 'preparing');
  const readyOrders = activeOrders.filter((o) => o.status === 'ready');

  // Helper to calculate minutes elapsed
  const getTicketAge = (timestamp) => {
    const elapsedMs = Date.now() - timestamp;
    const mins = Math.floor(elapsedMs / 60000);
    return `${mins}m ago`;
  };

  const getTableName = (tableId) => {
    if (!tableId) return '';
    const tbl = tables.find((t) => t.id === tableId);
    return tbl ? `Table ${tbl.number}` : '';
  };

  return (
    <div className="main-content">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div className="view-title">
          <h1>Kitchen Display System (KDS)</h1>
          <p>Real-time order tickets routed to stations for kitchen & bar staff.</p>
        </div>

        {/* Station Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-card)', padding: '6px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          {[
            { id: 'all', label: '🌐 All Stations' },
            { id: 'kitchen', label: '👨‍🍳 Hot Kitchen' },
            { id: 'bar', label: '🍹 Bar & Drinks' },
            { id: 'desserts', label: '🍰 Desserts' }
          ].map(st => (
            <button
              key={st.id}
              onClick={() => setStation(st.id)}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: station === st.id ? 'var(--color-primary)' : 'transparent',
                color: station === st.id ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      <div className="view-body" style={{ padding: '24px 32px' }}>
        <div className="kds-container">
          
          {/* 1. Pending Column */}
          <div className="kds-column">
            <div className="kds-column-header" style={{ borderTop: '4px solid var(--color-primary)' }}>
              <h2>New Orders</h2>
              <span className="badge badge-primary">{pendingOrders.length} Tickets</span>
            </div>
            <div className="kds-orders-scroll">
              {pendingOrders.length === 0 ? (
                <div className="cart-empty" style={{ margin: 'auto' }}>
                  <p>No new orders for {station} station.</p>
                </div>
              ) : (
                pendingOrders.map((order) => (
                  <div className="kds-card" key={order.id}>
                    <div className="kds-card-header">
                      <div className="kds-card-title">
                        <h3>Order #{order.id.slice(-4).toUpperCase()}</h3>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                          <span className={`badge ${order.diningType === 'dine-in' ? 'badge-primary' : 'badge-info'}`}>
                            {order.diningType === 'dine-in' ? getTableName(order.tableId) || 'Dine-In' : order.diningType}
                          </span>
                          {order.source === 'online' && (
                            <span className="badge" style={{ background: '#ff6b35', color: '#fff' }}>🌐 ONLINE</span>
                          )}
                        </div>
                      </div>
                      <span className="kds-timer">⏳ {getTicketAge(order.timestamp)}</span>
                    </div>

                    {/* Customer info for online / delivery orders */}
                    {(order.customerName || order.customerId || order.deliveryAddress) && (
                      <div style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.05)', padding: '6px 8px', borderRadius: '6px', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                          👤 {order.customerName || (order.customerId ? order.customerId.split('|')[0] : 'Customer')}
                          {(order.customerPhone || (order.customerId && order.customerId.includes('|'))) && (
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '6px' }}>
                              📞 {order.customerPhone || order.customerId.split('|')[1]}
                            </span>
                          )}
                        </div>
                        {order.deliveryAddress && (
                          <div style={{ marginTop: '2px', color: '#e0e0e0', fontSize: '0.74rem' }}>
                            📍 {order.deliveryAddress}
                          </div>
                        )}
                        {order.scheduledTime && (
                          <div style={{ marginTop: '4px', background: '#e65100', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '0.74rem', fontWeight: 700, display: 'inline-block' }}>
                            📅 SCHEDULED FOR: {new Date(order.scheduledTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ flexGrow: 1 }}>
                      {(order.filteredItems || order.items).map((item, idx) => (
                        <div key={idx} style={{ marginBottom: '6px' }}>
                          <div className="kds-item-row">
                            <span>
                              <span className="kds-item-qty">{item.quantity}x</span>
                              {item.name}
                            </span>
                          </div>
                          {item.notes && <p className="kds-item-notes">⚠️ {item.notes}</p>}
                        </div>
                      ))}
                    </div>

                    <div className="kds-card-actions" style={{ flexDirection: 'column', gap: '6px' }}>
                      {order.source === 'online' && order.status === 'pending' ? (
                        <>
                          <div style={{ fontSize: '0.72rem', color: '#aaa', fontWeight: 600 }}>Set ETA & Accept:</div>
                          <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                            <button className="btn btn-primary" style={{ flex: 1, padding: '6px 2px', fontSize: '0.75rem' }} onClick={() => acceptOnlineOrder(order.id, 15)}>⚡ 15m</button>
                            <button className="btn btn-primary" style={{ flex: 1, padding: '6px 2px', fontSize: '0.75rem' }} onClick={() => acceptOnlineOrder(order.id, 25)}>👨‍🍳 25m</button>
                            <button className="btn btn-primary" style={{ flex: 1, padding: '6px 2px', fontSize: '0.75rem' }} onClick={() => acceptOnlineOrder(order.id, 40)}>⏳ 40m</button>
                          </div>
                          <button className="btn btn-danger" style={{ width: '100%', padding: '6px', fontSize: '0.75rem', background: '#dc2626' }} onClick={() => rejectOnlineOrder(order.id, 'Kitchen busy')}>✕ Reject Order</button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary"
                          style={{ width: '100%', padding: '8px' }}
                          onClick={() => updateOrderStatus(order.id, 'preparing')}
                        >
                          🔥 Start Cooking
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Preparing Column */}
          <div className="kds-column">
            <div className="kds-column-header" style={{ borderTop: '4px solid var(--color-warning)' }}>
              <h2>Cooking</h2>
              <span className="badge badge-warning">{preparingOrders.length} Tickets</span>
            </div>
            <div className="kds-orders-scroll">
              {preparingOrders.length === 0 ? (
                <div className="cart-empty" style={{ margin: 'auto' }}>
                  <p>No active cooking.</p>
                </div>
              ) : (
                preparingOrders.map((order) => (
                  <div className="kds-card" key={order.id} style={{ borderColor: 'var(--color-warning)' }}>
                    <div className="kds-card-header">
                      <div className="kds-card-title">
                        <h3>Order #{order.id.slice(-4).toUpperCase()}</h3>
                        <span className={`badge ${order.diningType === 'dine-in' ? 'badge-primary' : 'badge-info'}`}>
                          {order.diningType === 'dine-in' ? getTableName(order.tableId) || 'Dine-In' : order.diningType}
                        </span>
                      </div>
                      <span className="kds-timer" style={{ color: 'var(--color-warning)' }}>
                        🔥 {getTicketAge(order.timestamp)}
                      </span>
                    </div>

                    <div style={{ flexGrow: 1 }}>
                      {(order.filteredItems || order.items).map((item, idx) => (
                        <div key={idx} style={{ marginBottom: '6px' }}>
                          <div className="kds-item-row">
                            <span>
                              <span className="kds-item-qty" style={{ color: 'var(--color-warning)' }}>{item.quantity}x</span>
                              {item.name}
                            </span>
                          </div>
                          {item.notes && <p className="kds-item-notes">⚠️ {item.notes}</p>}
                        </div>
                      ))}
                    </div>

                    <div className="kds-card-actions">
                      <button
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '8px', background: 'var(--color-warning)', color: '#000' }}
                        onClick={() => updateOrderStatus(order.id, 'ready')}
                      >
                        ✔️ Plated / Ready
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 3. Ready Column */}
          <div className="kds-column">
            <div className="kds-column-header" style={{ borderTop: '4px solid var(--color-success)' }}>
              <h2>Ready to Serve</h2>
              <span className="badge badge-success">{readyOrders.length} Tickets</span>
            </div>
            <div className="kds-orders-scroll">
              {readyOrders.length === 0 ? (
                <div className="cart-empty" style={{ margin: 'auto' }}>
                  <p>Nothing ready.</p>
                </div>
              ) : (
                readyOrders.map((order) => (
                  <div className="kds-card" key={order.id} style={{ borderColor: 'var(--color-success)', background: 'hsla(142, 71%, 45%, 0.03)' }}>
                    <div className="kds-card-header">
                      <div className="kds-card-title">
                        <h3>Order #{order.id.slice(-4).toUpperCase()}</h3>
                        <span className={`badge ${order.diningType === 'dine-in' ? 'badge-primary' : 'badge-info'}`}>
                          {order.diningType === 'dine-in' ? getTableName(order.tableId) || 'Dine-In' : order.diningType}
                        </span>
                      </div>
                      <span className="kds-timer" style={{ color: 'var(--color-success)' }}>
                        ✔️ Ready
                      </span>
                    </div>

                    <div style={{ flexGrow: 1 }}>
                      {(order.filteredItems || order.items).map((item, idx) => (
                        <div key={idx} style={{ marginBottom: '6px' }}>
                          <div className="kds-item-row">
                            <span>
                              <span className="kds-item-qty" style={{ color: 'var(--color-success)' }}>{item.quantity}x</span>
                              {item.name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="kds-card-actions">
                      <button
                        className="btn btn-success"
                        style={{ width: '100%', padding: '8px', background: 'var(--color-success)' }}
                        onClick={() => updateOrderStatus(order.id, 'served')}
                      >
                        🚚 Serve Order
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { usePOS } from '../context/POSContext';

export default function FloorPlan() {
  const { tables, saveTable, deleteTable, orders, setActiveTab, loadOrderToPOS, showToast } = usePOS();
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState('4');

  const [selectedTableDetails, setSelectedTableDetails] = useState(null);

  // Table Transfer & Merge & QR modal states
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  const handleTransferSubmit = async () => {
    if (!targetTableId) {
      showToast('Please select a target table.', 'warning');
      return;
    }
    const token = localStorage.getItem('gastroflow_token');
    try {
      const res = await fetch('/api/tables/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fromTableId: selectedTableDetails.table.id,
          toTableId: targetTableId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      showToast(`Table ${selectedTableDetails.table.number} successfully transferred!`, 'success');
      setShowTransferModal(false);
      setSelectedTableDetails(null);
      setTargetTableId('');
      loadAllData && loadAllData();
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleMergeSubmit = async () => {
    if (!targetTableId) {
      showToast('Please select a target table to merge into.', 'warning');
      return;
    }
    const token = localStorage.getItem('gastroflow_token');
    try {
      const res = await fetch('/api/tables/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sourceTableId: selectedTableDetails.table.id,
          targetTableId: targetTableId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Merge failed');
      showToast(`Table ${selectedTableDetails.table.number} merged successfully!`, 'success');
      setShowMergeModal(false);
      setSelectedTableDetails(null);
      setTargetTableId('');
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCreateTable = async (e) => {
    e.preventDefault();
    if (!newTableNumber) return;

    // Check if table number already exists
    const exists = tables.some((t) => t.number === newTableNumber);
    if (exists) {
      showToast('Table number already exists!', 'error');
      return;
    }

    const newTbl = {
      id: `table_${Date.now()}`,
      number: newTableNumber,
      capacity: parseInt(newTableCapacity) || 4,
      status: 'free',
      currentOrderId: null,
    };

    await saveTable(newTbl);
    setNewTableNumber('');
    setShowAddModal(false);
  };

  const handleTableClick = (table) => {
    if (table.status === 'free') {
      // Start order directly
      loadOrderToPOS({ tableId: table.id, items: [], diningType: 'dine-in' });
      setActiveTab('pos');
    } else {
      // Table is occupied or billing, show details
      const activeOrder = orders.find((o) => o.id === table.currentOrderId);
      setSelectedTableDetails({ table, order: activeOrder });
    }
  };

  const handleOpenInPOS = () => {
    if (selectedTableDetails && selectedTableDetails.order) {
      loadOrderToPOS(selectedTableDetails.order);
      setActiveTab('pos');
      setSelectedTableDetails(null);
    }
  };

  const handleDeleteClick = async (tableId) => {
    if (confirm('Are you sure you want to delete this table?')) {
      await deleteTable(tableId);
      setSelectedTableDetails(null);
    }
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>Floor Plan</h1>
          <p>Monitor dining table statuses, seat allocations, and active orders.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            ＋ Add Table
          </button>
        </div>
      </div>

      <div className="view-body">
        {/* Table status legend */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '32px', fontSize: '13px', fontWeight: '600' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-success)' }} />
            <span>Free</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-primary)' }} />
            <span>Occupied (Preparing/Cooking)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-warning)' }} />
            <span>Billing (Order Served)</span>
          </div>
        </div>

        {tables.length === 0 ? (
          <div className="cart-empty" style={{ height: '300px' }}>
            <p>No dining tables configured. Add a table to begin.</p>
          </div>
        ) : (
          <div className="tables-grid">
            {tables.map((table) => {
              const activeOrder = orders.find((o) => o.id === table.currentOrderId);
              return (
                <div
                  key={table.id}
                  className={`table-card ${table.status}`}
                  onClick={() => handleTableClick(table)}
                >
                  <span className="table-status-dot" style={{
                    background: table.status === 'free' ? 'var(--color-success)' : (table.status === 'billing' ? 'var(--color-warning)' : 'var(--color-primary)')
                  }} />
                  <span className="table-number">{table.number}</span>
                  <span className="table-capacity">{table.capacity} Pax</span>
                  {activeOrder && (
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                      {table.status === 'billing' ? 'Bill Pending' : 'Dining'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Table Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add New Table</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateTable}>
              <div className="form-group">
                <label>Table Number / Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 5, 12, VIP-1"
                  value={newTableNumber}
                  onChange={(e) => setNewTableNumber(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Seating Capacity</label>
                <select
                  className="form-select"
                  value={newTableCapacity}
                  onChange={(e) => setNewTableCapacity(e.target.value)}
                >
                  {[2, 3, 4, 6, 8, 10, 12].map((num) => (
                    <option key={num} value={num}>
                      {num} Guests
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table Detail Modal */}
      {selectedTableDetails && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2>Table {selectedTableDetails.table.number} - Active Session</h2>
              <button className="modal-close" onClick={() => setSelectedTableDetails(null)}>×</button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span className={`badge ${selectedTableDetails.table.status === 'billing' ? 'badge-warning' : 'badge-primary'}`}>
                  {selectedTableDetails.table.status === 'billing' ? 'Bill Generated' : 'Occupied / Cooking'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Capacity:</span>
                <span style={{ fontWeight: '600' }}>{selectedTableDetails.table.capacity} Guests</span>
              </div>
            </div>

            {selectedTableDetails.order ? (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>Order Details</h3>
                <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedTableDetails.order.items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span>{item.quantity}x {item.name}</span>
                      <span style={{ fontWeight: '600' }}>{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', borderTop: '1px dashed var(--border-color)', paddingTop: '12px', fontSize: '16px', marginBottom: '24px' }}>
                  <span>Total Payable:</span>
                  <span>${selectedTableDetails.order.total.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <p style={{ color: 'var(--color-danger)', fontWeight: '500', marginBottom: '20px' }}>
                Warning: Table marked occupied but no active order found in DB.
              </p>
            )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%', marginTop: '12px' }}>
                <button 
                  className="btn btn-outline" 
                  style={{ flex: 1, fontSize: '0.8rem' }}
                  onClick={() => setShowTransferModal(true)}
                >
                  🔄 Transfer Table
                </button>
                <button 
                  className="btn btn-outline" 
                  style={{ flex: 1, fontSize: '0.8rem' }}
                  onClick={() => setShowMergeModal(true)}
                >
                  🔀 Merge Table
                </button>
                <button 
                  className="btn btn-outline" 
                  style={{ flex: 1, fontSize: '0.8rem' }}
                  onClick={() => setShowQrModal(true)}
                >
                  📱 Table QR
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', width: '100%', marginTop: '8px' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                  onClick={() => handleDeleteClick(selectedTableDetails.table.id)}
                >
                  Delete Table
                </button>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-secondary" onClick={() => setSelectedTableDetails(null)}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={handleOpenInPOS}>
                    Open in POS
                  </button>
                </div>
              </div>
          </div>
        </div>
      )}

      {/* Transfer Table Modal */}
      {showTransferModal && selectedTableDetails && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Transfer Table {selectedTableDetails.table.number}</h2>
              <button className="modal-close" onClick={() => setShowTransferModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Select a free target table to move Order #{selectedTableDetails.order?.id?.slice(-4).toUpperCase()}.
            </p>
            <div className="form-group">
              <label>Target Free Table</label>
              <select 
                className="form-select"
                value={targetTableId}
                onChange={e => setTargetTableId(e.target.value)}
              >
                <option value="">-- Select Target Table --</option>
                {tables.filter(t => t.id !== selectedTableDetails.table.id && t.status === 'free').map(t => (
                  <option key={t.id} value={t.id}>Table {t.number} ({t.capacity} Guests)</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowTransferModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleTransferSubmit}>Confirm Transfer</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Table Modal */}
      {showMergeModal && selectedTableDetails && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Merge Table {selectedTableDetails.table.number}</h2>
              <button className="modal-close" onClick={() => setShowMergeModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Combine items from Table {selectedTableDetails.table.number} into another occupied table's bill.
            </p>
            <div className="form-group">
              <label>Target Occupied Table</label>
              <select 
                className="form-select"
                value={targetTableId}
                onChange={e => setTargetTableId(e.target.value)}
              >
                <option value="">-- Select Target Occupied Table --</option>
                {tables.filter(t => t.id !== selectedTableDetails.table.id && t.status === 'occupied').map(t => (
                  <option key={t.id} value={t.id}>Table {t.number} (Active Order)</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowMergeModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleMergeSubmit}>Confirm Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* Table QR Code Generator Modal */}
      {showQrModal && selectedTableDetails && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div className="modal-header">
              <h2>Dine-In QR Code: Table {selectedTableDetails.table.number}</h2>
              <button className="modal-close" onClick={() => setShowQrModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Scan to open customer web app bound to <strong>Table {selectedTableDetails.table.number}</strong>.
            </p>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', display: 'inline-block', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.protocol}//${window.location.hostname}:3001/?table=${selectedTableDetails.table.number}`)}`}
                alt={`QR Code Table ${selectedTableDetails.table.number}`}
                style={{ width: 180, height: 180 }}
              />
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: '700', wordBreak: 'break-all', marginBottom: '16px', color: 'var(--color-primary)' }}>
              {`${window.location.protocol}//${window.location.hostname}:3001/?table=${selectedTableDetails.table.number}`}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setShowQrModal(false)}>Close</button>
              <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print QR Label</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { usePOS } from '../context/POSContext';

export default function Customers() {
  const { customers, saveCustomer, orders, settings } = usePOS();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');

  const [selectedCustHistory, setSelectedCustHistory] = useState(null);

  const currencySymbol = settings.currencySymbol || '$';

  // Filter customers
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!custName || !custPhone) return;

    const newCust = {
      id: `cust_${Date.now()}`,
      name: custName,
      phone: custPhone,
      email: custEmail,
      points: 0,
      orderCount: 0,
      totalSpent: 0.0,
    };

    await saveCustomer(newCust);
    setCustName('');
    setCustPhone('');
    setCustEmail('');
    setShowAddModal(false);
  };

  const handleRowClick = (customer) => {
    // Get order history
    const history = orders.filter((o) => o.customerId === customer.id && o.status === 'paid');
    setSelectedCustHistory({ customer, history });
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>Customer CRM & Loyalty</h1>
          <p>Manage customer profiles, trace dining history, and track loyalty point balances.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            ＋ Register Customer
          </button>
        </div>
      </div>

      <div className="view-body">
        {/* Search Input */}
        <div className="search-bar" style={{ maxWidth: '400px', marginBottom: '24px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or phone number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Customer Table */}
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Email Address</th>
                <th>Loyalty Balance</th>
                <th>Total Orders</th>
                <th>Total Spent</th>
                <th>Avg. Order Size</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    No customers registered yet.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => {
                  const avgSpend = cust.orderCount > 0 ? cust.totalSpent / cust.orderCount : 0;
                  return (
                    <tr 
                      key={cust.id} 
                      onClick={() => handleRowClick(cust)} 
                      style={{ cursor: 'pointer' }}
                      title="Click to view history"
                    >
                      <td style={{ fontWeight: '600' }}>{cust.name}</td>
                      <td>{cust.phone}</td>
                      <td>{cust.email || 'N/A'}</td>
                      <td>
                        <span className="badge badge-primary">{cust.points} Points</span>
                      </td>
                      <td>{cust.orderCount} orders</td>
                      <td style={{ fontWeight: '600' }}>{currencySymbol}{cust.totalSpent.toFixed(2)}</td>
                      <td>{currencySymbol}{avgSpend.toFixed(2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Register New Customer</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. John Doe"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="e.g. 555-0199"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Email Address (Optional)</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="e.g. john@example.com"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer history details modal */}
      {selectedCustHistory && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>Dining History - {selectedCustHistory.customer.name}</h2>
              <button className="modal-close" onClick={() => setSelectedCustHistory(null)}>×</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', background: 'var(--bg-surface)', padding: '16px', borderRadius: '12px' }}>
              <div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Points Balance:</span>
                <h4 style={{ fontSize: '20px', color: 'var(--color-primary)', fontWeight: 'bold' }}>{selectedCustHistory.customer.points}</h4>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Lifetime Spending:</span>
                <h4 style={{ fontSize: '20px', color: 'var(--color-success)', fontWeight: 'bold' }}>
                  {currencySymbol}{selectedCustHistory.customer.totalSpent.toFixed(2)}
                </h4>
              </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>Recent Paid Invoices</h3>
            
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {selectedCustHistory.history.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>No completed orders found.</p>
              ) : (
                selectedCustHistory.history.map((order) => (
                  <div 
                    key={order.id} 
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card-hover)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: '700', fontSize: '13px' }}>#{order.id.slice(-6).toUpperCase()}</span>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Date(order.paymentTimestamp || order.timestamp).toLocaleDateString()} at {new Date(order.paymentTimestamp || order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>
                      {currencySymbol}{order.total.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedCustHistory(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

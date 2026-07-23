import React, { useEffect, useRef, useState } from 'react';
import { usePOS } from '../context/POSContext';

export default function Dashboard() {
  const { orders, tables, menuItems, settings, refundOrder, showToast } = usePOS();
  const canvasRef = useRef(null);

  // Refund States
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [refundError, setRefundError] = useState('');

  // Timeclock, Feedback & X-Report States
  const [timeclockLogs, setTimeclockLogs] = useState([]);
  const [feedbacksList, setFeedbacksList] = useState([]);
  const [showXReportModal, setShowXReportModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('pos_token');
    if (!token) return;

    fetch('/api/timeclock/entries', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => setTimeclockLogs(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error loading timeclock logs:', err));

    fetch('/api/feedbacks', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => setFeedbacksList(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error loading feedbacks:', err));
  }, []);

  // Filter orders for "today"
  const getTodayOrders = () => {
    const today = new Date().toDateString();
    return orders.filter(
      (order) => order.status === 'paid' && new Date(order.paymentTimestamp || order.timestamp).toDateString() === today
    );
  };

  // 1. Calculate Live Metrics
  const todayOrders = getTodayOrders();
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);

  const activeOrdersCount = orders.filter((o) => ['pending', 'preparing', 'ready', 'hold'].includes(o.status)).length;

  const occupiedTables = tables.filter((t) => t.status !== 'free').length;
  const occupancyRate = tables.length > 0 ? Math.round((occupiedTables / tables.length) * 100) : 0;

  const lowStockItems = menuItems.filter((item) => item.stock <= item.minStock).length;

  // 2. Format Currency
  const formatCurrency = (amount) => {
    const symbol = settings.currencySymbol || '$';
    return `${symbol}${amount.toFixed(2)}`;
  };

  // 3. Draw Sales Trend Chart (Canvas)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Set display size
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Get last 7 days names and totals
    const daysData = [];
    const todayVal = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayVal.getDate() - i);
      const dateStr = d.toDateString();
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      
      const daySales = orders
        .filter((o) => o.status === 'paid' && new Date(o.paymentTimestamp || o.timestamp).toDateString() === dateStr)
        .reduce((sum, o) => sum + o.total, 0);

      daysData.push({ day: dayName, total: daySales });
    }

    const maxVal = Math.max(...daysData.map((d) => d.total), 100);
    const chartHeight = height - 60;
    const chartWidth = width - 60;
    const paddingLeft = 45;
    const paddingTop = 20;

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // Determine grid colors based on theme
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? '#2a354f' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const primaryColor = '#6366f1';

    // Draw Grid Lines (Y axis)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.fillStyle = textColor;
    ctx.font = '11px Inter, sans-serif';

    const yLines = 4;
    for (let i = 0; i <= yLines; i++) {
      const y = paddingTop + (chartHeight / yLines) * i;
      const val = maxVal - (maxVal / yLines) * i;
      
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + chartWidth, y);
      ctx.stroke();
      ctx.fillText(`${settings.currencySymbol || '$'}${Math.round(val)}`, 8, y + 4);
    }

    // Plot Points and Draw Bars/Lines
    const points = [];
    const stepX = chartWidth / (daysData.length - 1 || 1);

    daysData.forEach((data, index) => {
      const x = paddingLeft + index * stepX;
      const y = paddingTop + chartHeight - (data.total / maxVal) * chartHeight;
      points.push({ x, y, label: data.day, total: data.total });
    });

    // Draw Gradient Area under Line
    if (points.length > 0) {
      const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
      gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
      
      ctx.beginPath();
      ctx.moveTo(points[0].x, paddingTop + chartHeight);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, paddingTop + chartHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw Line
    ctx.beginPath();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 3;
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Draw Points & Labels
    points.forEach((p) => {
      // Circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Tooltip Text on top of point if sales > 0
      if (p.total > 0) {
        ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(p.total).toString(), p.x, p.y - 10);
      }

      // X Axis Label
      ctx.fillStyle = textColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, paddingTop + chartHeight + 20);
    });

  }, [orders, settings, activeOrdersCount]);

  // Calculate top items
  const getTopItems = () => {
    const itemCounts = {};
    orders
      .filter((o) => o.status === 'paid')
      .forEach((order) => {
        order.items.forEach((item) => {
          itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
        });
      });

    return Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const topItems = getTopItems();

  // Get recent transactions
  const recentSales = orders.filter((o) => o.status === 'paid').slice(0, 5);

  // Export CSV handler
  const exportToCSV = () => {
    if (!orders || orders.length === 0) return showToast('No orders available to export.', 'info');
    const headers = ['Order ID', 'Timestamp', 'Dining Type', 'Status', 'Subtotal', 'Tax', 'Tip', 'Total'];
    const rows = orders.map(o => [
      o.id,
      new Date(o.timestamp || Date.now()).toLocaleString(),
      o.diningType || 'dine-in',
      o.status,
      o.subtotal || o.total,
      o.tax || 0,
      o.tip || 0,
      o.total
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `gastroflow_sales_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>Manager Dashboard</h1>
          <p>Real-time sales insights, table occupancy, and kitchen status.</p>
        </div>
        <div className="view-actions" style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setShowXReportModal(true)}>
            📄 Generate X-Report (Mid-Shift)
          </button>
          <button className="btn btn-secondary" onClick={exportToCSV}>
            📊 Export CSV Report
          </button>
        </div>
      </div>

      <div className="view-body">
        {/* KPI Cards */}
        <div className="dashboard-grid">
          <div className="card stat-card">
            <div className="stat-info">
              <h3>Today's Sales</h3>
              <p>{formatCurrency(todayRevenue)}</p>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
              💰
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Active Tickets</h3>
              <p>{activeOrdersCount}</p>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
              🔥
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Table Occupancy</h3>
              <p>{occupancyRate}%</p>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
              🍽️
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Low Stock Warning</h3>
              <p>{lowStockItems}</p>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
              ⚠️
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="charts-row">
          <div className="card chart-card">
            <div className="chart-header">
              <h2>Weekly Sales Volume</h2>
            </div>
            <div className="chart-container">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="card chart-card">
            <div className="chart-header">
              <h2>Top 5 Selling Items</h2>
            </div>
            {topItems.length === 0 ? (
              <div className="cart-empty" style={{ flexGrow: 1 }}>
                <p>No sales recorded yet.</p>
              </div>
            ) : (
              <div className="top-items-list">
                {topItems.map((item, idx) => (
                  <div className="top-item-row" key={idx}>
                    <div className="top-item-name">
                      {idx + 1}. {item.name}
                    </div>
                    <div className="top-item-count">{item.count} sold</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Transactions List */}
        <div className="dashboard-details">
          <div className="card" style={{ gridColumn: 'span 2' }}>
            <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>
              Recent Sales Receipts
            </h2>
            {recentSales.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No completed orders today.</p>
            ) : (
              <div className="data-table-container" style={{ border: 'none', marginTop: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Dining Mode</th>
                      <th>Table</th>
                      <th>Time Paid</th>
                      <th>Payment Mode</th>
                      <th>Total Amount</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map((sale) => (
                      <tr key={sale.id}>
                        <td style={{ fontWeight: '600' }}>#{sale.id.slice(-6)}</td>
                        <td>
                          <span className={`badge ${sale.diningType === 'dine-in' ? 'badge-primary' : 'badge-info'}`}>
                            {sale.diningType}
                          </span>
                        </td>
                        <td>{sale.tableId ? `Table ${tables.find(t => t.id === sale.tableId)?.number || '?'}` : 'N/A'}</td>
                        <td>{new Date(sale.paymentTimestamp || sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>
                          <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>{sale.paymentMethod || 'Cash'}</span>
                        </td>
                        <td style={{ fontWeight: '700' }}>{formatCurrency(sale.total)}</td>
                        <td>
                          {sale.refundedAmount >= sale.total ? (
                            <span style={{ fontSize: '11px', color: 'var(--color-danger)', fontWeight: 'bold' }}>REFUNDED</span>
                          ) : (
                            <button 
                              className="btn" 
                              style={{ padding: '4px 8px', fontSize: '11px', background: 'var(--color-danger-light)', color: 'var(--color-danger)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              onClick={() => {
                                setRefundTarget(sale);
                                setRefundAmountInput((sale.total - (sale.refundedAmount || 0)).toString());
                              }}
                            >
                              💸 Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 6. Staff Timeclock & Customer Feedback Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginTop: '24px' }}>
          
          {/* Timeclock Shifts */}
          <div className="card glass" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⏱️ Staff Shift Timeclock
            </h2>
            {timeclockLogs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No recorded shift entries yet.</p>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 4px' }}>Staff</th>
                      <th style={{ padding: '8px 4px' }}>Clock In</th>
                      <th style={{ padding: '8px 4px' }}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeclockLogs.map(tc => (
                      <tr key={tc.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 4px', fontWeight: 600 }}>👤 {tc.username}</td>
                        <td style={{ padding: '8px 4px' }}>{new Date(tc.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ padding: '8px 4px' }}>
                          {tc.clockOut ? (
                            <span className="badge badge-success">{tc.durationMinutes}m</span>
                          ) : (
                            <span className="badge badge-warning">Active 🔥</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Customer Reviews Inbox */}
          <div className="card glass" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              💬 Customer Reviews Inbox
            </h2>
            {feedbacksList.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No customer feedback received yet.</p>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {feedbacksList.map(fb => (
                  <div key={fb.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>Order #{fb.orderId ? fb.orderId.slice(-4).toUpperCase() : '---'}</span>
                      <span style={{ color: '#f59e0b', fontSize: '13px' }}>{'★'.repeat(fb.rating || 5)}{'☆'.repeat(5 - (fb.rating || 5))}</span>
                    </div>
                    {fb.comment && <p style={{ fontSize: '12px', color: 'var(--text-1)', margin: 0 }}>"{fb.comment}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tax & VAT Compliance Breakdown Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🏛️ Tax & VAT Compliance Breakdown
            </h2>
            {(() => {
              const taxRate = parseFloat(settings.taxRate) || 0;
              const serviceRate = parseFloat(settings.serviceChargeRate) || 0;
              const totalTaxCollected = todayOrders.reduce((acc, o) => acc + (o.tax || 0), 0);
              const totalServiceCharge = todayOrders.reduce((acc, o) => acc + (o.serviceCharge || 0), 0);
              const totalDiscounts = todayOrders.reduce((acc, o) => acc + (o.discount || 0), 0);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    <span>Gross Sales (Today):</span>
                    <strong>{formatCurrency(todayRevenue)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    <span>Total Tax / VAT ({taxRate}%):</span>
                    <strong style={{ color: 'var(--color-primary)' }}>{formatCurrency(totalTaxCollected)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    <span>Total Service Charge ({serviceRate}%):</span>
                    <strong>{formatCurrency(totalServiceCharge)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total Promotional Discounts:</span>
                    <strong style={{ color: 'var(--color-danger)' }}>-{formatCurrency(totalDiscounts)}</strong>
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        {/* X-REPORT MID-SHIFT MODAL */}
        {showXReportModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h2>📄 Mid-Shift X-Report Snapshot</h2>
                <button className="modal-close" onClick={() => setShowXReportModal(false)}>×</button>
              </div>

              {(() => {
                const cashSales = todayOrders.filter(o => o.paymentMethod === 'cash').reduce((acc, o) => acc + o.total, 0);
                const cardSales = todayOrders.filter(o => o.paymentMethod === 'card' || o.paymentMethod === 'payhere').reduce((acc, o) => acc + o.total, 0);
                const voidsCount = orders.filter(o => o.status === 'cancelled' || o.status === 'refunded').length;
                const totalTax = todayOrders.reduce((acc, o) => acc + (o.tax || 0), 0);

                return (
                  <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ background: 'var(--bg-surface)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mid-Shift Sales Snapshot</div>
                      <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '4px' }}>{formatCurrency(todayRevenue)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{todayOrders.length} Paid Tickets</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div style={{ background: 'rgba(34, 197, 94, 0.08)', padding: '10px', borderRadius: '6px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Cash Sales</div>
                        <div style={{ fontWeight: 700, fontSize: '15px' }}>{formatCurrency(cashSales)}</div>
                      </div>
                      <div style={{ background: 'rgba(99, 102, 241, 0.08)', padding: '10px', borderRadius: '6px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Card / Online Sales</div>
                        <div style={{ fontWeight: 700, fontSize: '15px' }}>{formatCurrency(cardSales)}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                      <span>Collected Tax / VAT:</span>
                      <strong>{formatCurrency(totalTax)}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Voided / Refunded Orders:</span>
                      <strong style={{ color: 'var(--color-danger)' }}>{voidsCount} Orders</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                      <button className="btn btn-secondary" onClick={() => window.print()}>🖨️ Print X-Report</button>
                      <button className="btn btn-primary" onClick={() => setShowXReportModal(false)}>Close</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {refundTarget && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px' }}>
              <div className="modal-header">
                <h2>Refund Order #{refundTarget.id.slice(-6)}</h2>
                <button className="modal-close" onClick={() => { setRefundTarget(null); setRefundError(''); }}>×</button>
              </div>
              
              <form onSubmit={async (e) => {
                e.preventDefault();
                setRefundError('');
                const amt = parseFloat(refundAmountInput) || 0;
                if (amt <= 0 || amt > (refundTarget.total - (refundTarget.refundedAmount || 0))) {
                  setRefundError(`Refund amount must be between ${settings.currencySymbol || '$'}0.01 and ${formatCurrency(refundTarget.total - (refundTarget.refundedAmount || 0))}`);
                  return;
                }
                if (!refundReason) {
                  setRefundError('Please specify a refund reason.');
                  return;
                }
                if (!managerPin) {
                  setRefundError('Manager PIN is required.');
                  return;
                }

                try {
                  await refundOrder(refundTarget.id, amt, refundReason, managerPin);
                  showToast('Refund processed successfully!', 'success');
                  setRefundTarget(null);
                  setRefundAmountInput('');
                  setRefundReason('');
                  setManagerPin('');
                } catch (err) {
                  setRefundError(err.message || 'Refund failed');
                }
              }}>
                {refundError && (
                  <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                    ⚠️ {refundError}
                  </div>
                )}

                <div style={{ marginBottom: '16px', fontSize: '13px', background: 'var(--bg-surface)', padding: '12px', borderRadius: '8px' }}>
                  <div>Total Paid: <strong>{formatCurrency(refundTarget.total)}</strong></div>
                  {refundTarget.refundedAmount > 0 && (
                    <div style={{ color: 'var(--color-danger)' }}>Already Refunded: <strong>{formatCurrency(refundTarget.refundedAmount)}</strong></div>
                  )}
                </div>

                <div className="form-group">
                  <label>Refund Amount ({settings.currencySymbol || '$'})</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={refundAmountInput}
                    onChange={(e) => setRefundAmountInput(e.target.value)}
                    max={refundTarget.total - (refundTarget.refundedAmount || 0)}
                    placeholder="e.g. 500.00"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Mandatory Structured Void Reason Code</label>
                  <select
                    className="form-input"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    required
                  >
                    <option value="">-- Select Void / Refund Reason --</option>
                    <option value="Customer Changed Mind">Customer Changed Mind</option>
                    <option value="Wrong Order Entry">Wrong Order Entry</option>
                    <option value="Food Quality Issue">Food Quality Issue</option>
                    <option value="Payment Processing Error">Payment Processing Error</option>
                    <option value="Other Manager Override">Other Manager Override</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label>Manager Security PIN</label>
                  <input
                    type="password"
                    maxLength="4"
                    className="form-input"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                  Authorize & Process Refund
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

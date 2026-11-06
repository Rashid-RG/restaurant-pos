import React, { useState, useEffect } from 'react';
import { 
  Receipt, Plus, Calendar, ChevronLeft, ChevronRight, Trash2, 
  DollarSign, TrendingUp, TrendingDown, PieChart, Download, 
  Printer, Filter, Search, X, Check, AlertCircle, RefreshCw 
} from 'lucide-react';
import { usePOS } from '../context/POSContext';

const EXPENSE_CATEGORIES = [
  { id: 'Ingredients', name: 'Ingredients & Groceries', icon: '🥬', color: '#10b981' },
  { id: 'Utilities', name: 'Utilities (Gas / Power / Water)', icon: '⚡', color: '#f59e0b' },
  { id: 'Wages', name: 'Staff Wages / Daily Pay', icon: '👨‍🍳', color: '#3b82f6' },
  { id: 'Rent', name: 'Rent & Space Lease', icon: '🏠', color: '#8b5cf6' },
  { id: 'Maintenance', name: 'Repairs & Maintenance', icon: '🛠️', color: '#ec4899' },
  { id: 'Packaging', name: 'Packaging & Disposables', icon: '📦', color: '#06b6d4' },
  { id: 'Transport', name: 'Transport & Fuel', icon: '🛵', color: '#14b8a6' },
  { id: 'Marketing', name: 'Marketing & Promo', icon: '📣', color: '#f97316' },
  { id: 'Other', name: 'Other / Miscellaneous', icon: '📝', color: '#64748b' },
];

export default function DailyExpenses() {
  const { showToast, currencySymbol } = usePOS();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [formCategory, setFormCategory] = useState('Ingredients');
  const [formAmount, setFormAmount] = useState('');
  const [formMethod, setFormMethod] = useState('cash');
  const [formNotes, setFormNotes] = useState('');
  const [formDate, setFormDate] = useState(selectedDate);

  const fetchExpensesAndSummary = async (dateToFetch) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('gastroflow_token');
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      };

      const [listRes, sumRes] = await Promise.all([
        fetch(`/api/expenses?date=${encodeURIComponent(dateToFetch)}`, { headers }),
        fetch(`/api/expenses/summary?date=${encodeURIComponent(dateToFetch)}`, { headers })
      ]);

      if (listRes.ok) {
        const listData = await listRes.json();
        setExpenses(Array.isArray(listData) ? listData : []);
      }
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary(sumData);
      }
    } catch (err) {
      showToast('Could not load daily expense records.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpensesAndSummary(selectedDate);
    setFormDate(selectedDate);
  }, [selectedDate]);

  const changeDateByDays = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    if (!formAmount || parseFloat(formAmount) <= 0) {
      showToast('Please enter a valid expense amount.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          date: formDate || selectedDate,
          category: formCategory,
          amount: parseFloat(formAmount),
          paymentMethod: formMethod,
          notes: formNotes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save expense');
      showToast(`Saved expense: ${formCategory} (${currencySymbol || 'Rs. '} ${parseFloat(formAmount).toFixed(2)})`, 'success');
      setShowAddModal(false);
      setFormAmount('');
      setFormNotes('');
      fetchExpensesAndSummary(selectedDate);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id, cat, amt) => {
    if (!window.confirm(`Delete expense "${cat}" (${currencySymbol || 'Rs. '} ${amt.toFixed(2)})?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Could not delete expense.');
      showToast('Expense removed.', 'info');
      fetchExpensesAndSummary(selectedDate);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const exportToCSV = () => {
    if (!expenses.length) {
      showToast('No expenses to export for this date.', 'info');
      return;
    }
    const headers = ['ID', 'Date', 'Category', 'Amount', 'Payment Method', 'Notes', 'Created By', 'Created At'];
    const rows = expenses.map(e => [
      e.id,
      e.date,
      `"${e.category}"`,
      e.amount,
      e.paymentMethod,
      `"${(e.notes || '').replace(/"/g, '""')}"`,
      e.createdBy,
      new Date(e.createdAt).toLocaleString()
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `GastroFlow_Expenses_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const printDailyVoucher = () => {
    window.print();
  };

  const filteredExpenses = expenses.filter(e => {
    const matchesCat = filterCategory === 'all' || e.category === filterCategory;
    const matchesQuery = !searchQuery || 
      `${e.category} ${e.notes} ${e.paymentMethod} ${e.createdBy}`.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const curr = currencySymbol || 'Rs.';

  return (
    <div className="main-content" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* View Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase' }}>
            OPERATIONS & FINANCIALS
          </span>
          <h1 style={{ fontSize: '28px', fontWeight: 800, margin: '4px 0 0', letterSpacing: '-0.5px' }}>
            Daily Restaurant Expenses
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0' }}>
            Track everyday kitchen groceries, utilities, wages, and operating costs per day.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={exportToCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={15} /> Export CSV
          </button>
          <button className="btn btn-outline" onClick={printDailyVoucher} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={15} /> Print Summary
          </button>
          <button 
            className="btn btn-primary" 
            onClick={() => { setShowAddModal(true); setFormDate(selectedDate); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} /> Record Expense
          </button>
        </div>
      </div>

      {/* Date Navigator Bar */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        padding: '12px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn btn-outline" style={{ padding: '6px 10px', height: 'auto' }} onClick={() => changeDateByDays(-1)} title="Previous Day">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer'
            }}
          />
          <button className="btn btn-outline" style={{ padding: '6px 10px', height: 'auto' }} onClick={() => changeDateByDays(1)} title="Next Day">
            <ChevronRight size={16} />
          </button>
          <button
            className="btn btn-outline"
            style={{ padding: '6px 12px', height: 'auto', fontSize: '12px', fontWeight: 600 }}
            onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
          >
            Today
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn btn-outline" onClick={() => fetchExpensesAndSummary(selectedDate)} disabled={loading} style={{ padding: '6px 12px', height: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Financial Health Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginBottom: '28px'
      }}>
        {/* Card 1: Today's Expenses */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: 'var(--shadow-card)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TODAY'S TOTAL EXPENSES</span>
            <span style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 700 }}>
              {summary?.expenseCount || 0} entries
            </span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#ef4444', letterSpacing: '-0.5px' }}>
            {curr} {(summary?.totalExpenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Total cash & bank outflows recorded
          </span>
        </div>

        {/* Card 2: Today's Sales */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: 'var(--shadow-card)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TODAY'S GROSS SALES</span>
            <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 700 }}>
              {summary?.orderCount || 0} orders
            </span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#10b981', letterSpacing: '-0.5px' }}>
            {curr} {(summary?.totalSales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Settled orders revenue today
          </span>
        </div>

        {/* Card 3: Net Daily Balance (Profit/Loss) */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: 'var(--shadow-card)',
          borderLeft: `4px solid ${(summary?.netDailyBalance || 0) >= 0 ? '#10b981' : '#f59e0b'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NET DAILY BALANCE</span>
            {(summary?.netDailyBalance || 0) >= 0 ? <TrendingUp size={16} color="#10b981" /> : <TrendingDown size={16} color="#ef4444" />}
          </div>
          <div style={{
            fontSize: '28px',
            fontWeight: 800,
            color: (summary?.netDailyBalance || 0) >= 0 ? 'var(--color-primary)' : '#ef4444',
            letterSpacing: '-0.5px'
          }}>
            {curr} {(summary?.netDailyBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Sales minus recorded daily costs
          </span>
        </div>

        {/* Card 4: Month to Date Expenses */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: 'var(--shadow-card)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>MONTH TOTAL (TO DATE)</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{summary?.month || ''}</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.5px' }}>
            {curr} {(summary?.monthTotalExpenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Cumulative expenses this month
          </span>
        </div>
      </div>

      {/* Category Breakdown Progress */}
      {summary?.categoryBreakdown?.length > 0 && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '28px'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PieChart size={17} color="var(--color-primary)" /> Expense Distribution ({selectedDate})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {summary.categoryBreakdown.map(item => {
              const meta = EXPENSE_CATEGORIES.find(c => c.id === item.category || c.name === item.category);
              const percentage = summary.totalExpenses > 0 ? ((item.total / summary.totalExpenses) * 100).toFixed(1) : 0;
              return (
                <div key={item.category} style={{ background: 'var(--bg-app)', padding: '12px 14px', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    <span>{meta?.icon || '📝'} {item.category}</span>
                    <span>{percentage}%</span>
                  </div>
                  <div style={{ height: '6px', width: '100%', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${percentage}%`, background: meta?.color || 'var(--color-primary)', borderRadius: '3px' }} />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
                    {curr} {item.total.toFixed(2)} ({item.count} items)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expense Ledger Table Section */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        padding: '20px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
            Expenses Ledger ({filteredExpenses.length})
          </h2>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', minWidth: '180px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search notes / category…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  paddingLeft: '32px',
                  paddingRight: '12px',
                  paddingTop: '8px',
                  paddingBottom: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                  width: '100%'
                }}
              />
            </div>

            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontSize: '13px'
              }}
            >
              <option value="all">All Categories</option>
              {EXPENSE_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading expenses…</p>
        ) : filteredExpenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' }}>
            <Receipt size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', color: 'var(--text-main)' }}>No expenses recorded for {selectedDate}</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px' }}>Click below to record your kitchen purchases, utility payments, or wages.</p>
            <button className="btn btn-primary" onClick={() => { setShowAddModal(true); setFormDate(selectedDate); }}>
              <Plus size={15} /> Add First Expense
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 14px' }}>Category</th>
                  <th style={{ padding: '12px 14px' }}>Notes / Description</th>
                  <th style={{ padding: '12px 14px' }}>Payment Method</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px 14px' }}>Staff</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(exp => {
                  const meta = EXPENSE_CATEGORIES.find(c => c.id === exp.category || c.name === exp.category);
                  return (
                    <tr key={exp.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'var(--bg-app)',
                          padding: '4px 10px',
                          borderRadius: '8px'
                        }}>
                          {meta?.icon || '📝'} {exp.category}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: exp.notes ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {exp.notes || '—'}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          textTransform: 'uppercase',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: exp.paymentMethod === 'cash' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                          color: exp.paymentMethod === 'cash' ? '#10b981' : '#3b82f6'
                        }}>
                          {exp.paymentMethod || 'cash'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, fontSize: '14px', color: '#ef4444' }}>
                        {curr} {exp.amount.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        {exp.createdBy || 'Staff'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteExpense(exp.id, exp.category, exp.amount)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '6px',
                            borderRadius: '6px'
                          }}
                          title="Delete expense"
                        >
                          <Trash2 size={16} color="#ef4444" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RECORD EXPENSE MODAL */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => !submitting && setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Receipt size={20} color="var(--color-primary)" /> Record Daily Expense
              </h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>

            <form onSubmit={handleCreateExpense} style={{ display: 'grid', gap: '16px', padding: '16px 0 0' }}>
              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Expense Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Category</label>
                <select
                  className="form-select"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  required
                >
                  {EXPENSE_CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Amount ({curr})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="form-input"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Paid Out Via</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'cash', label: '💵 Cash Drawer' },
                    { id: 'bank', label: '🏦 Bank Transfer' },
                    { id: 'petty_cash', label: '🪙 Petty Cash' }
                  ].map(m => (
                    <button
                      type="button"
                      key={m.id}
                      className={`btn ${formMethod === m.id ? 'btn-primary' : 'btn-outline'}`}
                      style={{ fontSize: '12px', padding: '8px 4px', height: 'auto' }}
                      onClick={() => setFormMethod(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Notes / Description</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Bought 10kg chicken, onion, and cooking oil"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ flex: 1, padding: '12px' }}>
                  {submitting ? 'Saving Expense…' : 'Save Expense'}
                </button>
                <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


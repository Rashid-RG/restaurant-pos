import React, { useState, useEffect } from 'react';
import { 
  Receipt, Plus, Calendar, ChevronLeft, ChevronRight, Trash2, 
  DollarSign, TrendingUp, TrendingDown, PieChart, Download, 
  Printer, Filter, Search, X, Check, AlertCircle, RefreshCw,
  Tag, Settings2, FolderPlus, Building2, FileText
} from 'lucide-react';
import { usePOS } from '../context/POSContext';
import './daily-expenses-layout.css';
import { dateAtRestaurant, formatRestaurantTime, restaurantTimeZone, shiftCalendarDate } from '../utils/restaurant-time';

const DEFAULT_CATEGORIES = [
  { id: 'cat_meat_chicken', name: 'Meat, Chicken & Poultry', icon: '🍗', color: '#ef4444' },
  { id: 'cat_vegetables', name: 'Vegetables & Fresh Produce', icon: '🥕', color: '#10b981' },
  { id: 'cat_ingredients', name: 'Ingredients & Groceries', icon: '🥬', color: '#059669' },
  { id: 'cat_seafood', name: 'Fish & Seafood', icon: '🐟', color: '#06b6d4' },
  { id: 'cat_dairy', name: 'Dairy, Milk & Eggs', icon: '🧀', color: '#f59e0b' },
  { id: 'cat_beverages', name: 'Beverages & Syrups', icon: '🥤', color: '#3b82f6' },
  { id: 'cat_gas_fuel', name: 'Gas Cylinders & Kitchen Fuel', icon: '🔥', color: '#f97316' },
  { id: 'cat_utilities', name: 'Utilities (Electricity & Water)', icon: '⚡', color: '#eab308' },
  { id: 'cat_wages', name: 'Staff Daily Wages & Pay', icon: '👨‍🍳', color: '#6366f1' },
  { id: 'cat_packaging', name: 'Packaging, Boxes & Bags', icon: '📦', color: '#8b5cf6' },
  { id: 'cat_repairs', name: 'Repairs & Maintenance', icon: '🛠️', color: '#ec4899' },
  { id: 'cat_cleaning', name: 'Cleaning & Sanitation Supplies', icon: '🧹', color: '#14b8a6' },
  { id: 'cat_rent', name: 'Rent & Space Lease', icon: '🏠', color: '#a855f7' },
  { id: 'cat_transport', name: 'Transport & Logistics', icon: '🛵', color: '#0284c7' },
  { id: 'cat_marketing', name: 'Marketing & Promo', icon: '📣', color: '#d97706' },
  { id: 'cat_other', name: 'Other / Miscellaneous', icon: '📝', color: '#64748b' }
];

const EMOJI_OPTIONS = ['🍗', '🥩', '🍔', '🥬', '🥕', '🐟', '🧀', '🧂', '🥤', '☕', '🔥', '⚡', '💧', '👨‍🍳', '📦', '🛠️', '🧹', '🏠', '🛵', '📣', '📝', '💼', '🛒', '💰'];
const COLOR_OPTIONS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#64748b'];

export default function DailyExpenses() {
  const { showToast, currencySymbol, settings } = usePOS();
  const timeZone = restaurantTimeZone(settings);
  const [selectedDate, setSelectedDate] = useState(() => dateAtRestaurant(new Date(), restaurantTimeZone(settings)));
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showQuickAddCat, setShowQuickAddCat] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [formCategory, setFormCategory] = useState('Meat, Chicken & Poultry');
  const [formAmount, setFormAmount] = useState('');
  const [formMethod, setFormMethod] = useState('cash');
  const [formNotes, setFormNotes] = useState('');
  const [formVendor, setFormVendor] = useState('');
  const [formReceiptNo, setFormReceiptNo] = useState('');
  const [formDate, setFormDate] = useState(selectedDate);

  // New Category State
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🍗');
  const [newCatColor, setNewCatColor] = useState('#ef4444');
  const [creatingCat, setCreatingCat] = useState(false);

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/expenses/categories', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setCategories(data);
          // Set initial form category to first item if current is invalid
          if (!data.some(c => c.name === formCategory)) {
            setFormCategory(data[0].name);
          }
        }
      }
    } catch (_) {
      // Fallback to default categories
    }
  };

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
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchExpensesAndSummary(selectedDate);
    setFormDate(selectedDate);
  }, [selectedDate]);

  const changeDateByDays = (days) => {
    setSelectedDate(shiftCalendarDate(selectedDate, days));
  };

  const handleCreateCategory = async (e) => {
    if (e) e.preventDefault();
    if (!newCatName || !newCatName.trim()) {
      showToast('Please enter a category name (e.g. Chicken Expense).', 'warning');
      return;
    }
    setCreatingCat(true);
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/expenses/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newCatName.trim(),
          icon: newCatIcon,
          color: newCatColor
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create category');

      showToast(`Category "${newCatName.trim()}" added successfully!`, 'success');
      const created = data.category || { name: newCatName.trim(), icon: newCatIcon, color: newCatColor };
      setCategories(prev => [created, ...prev]);
      setFormCategory(created.name);
      setNewCatName('');
      setShowQuickAddCat(false);
      fetchCategories();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleDeleteCategory = async (catId, catName) => {
    if (!window.confirm(`Delete category "${catName}"?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/expenses/categories/${catId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete category');
      showToast(data.message || `Deleted category "${catName}"`, 'info');
      fetchCategories();
    } catch (err) {
      showToast(err.message, 'error');
    }
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
          notes: formNotes,
          vendor: formVendor,
          receiptNumber: formReceiptNo
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save expense');
      showToast(`✅ Expense Recorded: ${formCategory} (${currencySymbol || 'Rs. '}${parseFloat(formAmount).toFixed(2)}) for ${formDate || selectedDate}`, 'success');
      setShowAddModal(false);
      setFormAmount('');
      setFormNotes('');
      setFormVendor('');
      setFormReceiptNo('');
      fetchExpensesAndSummary(selectedDate);
    } catch (err) {
      showToast(`❌ Could not record expense: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id, cat, amt) => {
    if (!window.confirm(`Delete expense "${cat}" (${currencySymbol || 'Rs. '}${amt.toFixed(2)})?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Could not delete expense.');
      showToast(`🗑️ Removed expense: ${cat} (${currencySymbol || 'Rs. '}${amt.toFixed(2)})`, 'info');
      fetchExpensesAndSummary(selectedDate);
    } catch (err) {
      showToast(`❌ Error removing expense: ${err.message}`, 'error');
    }
  };

  const exportToCSV = () => {
    if (!expenses.length) {
      showToast('No expenses to export for this date.', 'info');
      return;
    }
    const headers = ['ID', 'Date', 'Category', 'Amount', 'Payment Method', 'Vendor / Supplier', 'Receipt No', 'Notes', 'Created By', 'Created At'];
    const rows = expenses.map(e => [
      e.id,
      e.date,
      `"${e.category}"`,
      e.amount,
      e.paymentMethod,
      `"${(e.vendor || '').replace(/"/g, '""')}"`,
      `"${(e.receiptNumber || '').replace(/"/g, '""')}"`,
      `"${(e.notes || '').replace(/"/g, '""')}"`,
      e.createdBy,
      formatRestaurantTime(e.createdAt, timeZone)
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
      `${e.category} ${e.notes || ''} ${e.vendor || ''} ${e.receiptNumber || ''} ${e.paymentMethod} ${e.createdBy}`.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const getCategoryMeta = (catName) => {
    return categories.find(c => c.name === catName || c.id === catName) || { icon: '📝', color: '#64748b' };
  };

  const curr = currencySymbol || 'Rs.';

  return (
    <div className="main-content expenses-page" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
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
            Track meat & chicken, groceries, utilities, daily wages, and operating costs with custom categories.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => setShowCategoryModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Settings2 size={15} /> Categories ({categories.length})
          </button>
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
            onClick={() => setSelectedDate(dateAtRestaurant(new Date(), timeZone))}
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
        gap: '16px',
        marginBottom: '24px'
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
            Cash & vendor disbursements today
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
            Sales minus recorded operating costs
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
            Cumulative outflows this month
          </span>
        </div>
      </div>

      {/* Category filters wrap to additional rows instead of disappearing under a scrollbar. */}
      <div className="expenses-category-filters" aria-label="Filter expenses by category" style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        overflowX: 'visible',
        paddingBottom: '12px',
        marginBottom: '20px'
      }}>
        <button
          onClick={() => setFilterCategory('all')}
          style={{
            padding: '6px 14px',
            borderRadius: '20px',
            border: `1px solid ${filterCategory === 'all' ? 'var(--color-primary)' : 'var(--border-color)'}`,
            background: filterCategory === 'all' ? 'var(--color-primary)' : 'var(--bg-card)',
            color: filterCategory === 'all' ? '#fff' : 'var(--text-main)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s'
          }}
        >
          All Categories ({expenses.length})
        </button>
        {categories.map(cat => {
          const count = expenses.filter(e => e.category === cat.name).length;
          const isSelected = filterCategory === cat.name;
          return (
            <button
              key={cat.id || cat.name}
              onClick={() => setFilterCategory(cat.name)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: `1px solid ${isSelected ? (cat.color || 'var(--color-primary)') : 'var(--border-color)'}`,
                background: isSelected ? (cat.color || 'var(--color-primary)') : 'var(--bg-card)',
                color: isSelected ? '#fff' : 'var(--text-main)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
            >
              <span>{cat.icon || '📦'}</span>
              <span>{cat.name}</span>
              {count > 0 && (
                <span style={{
                  background: isSelected ? 'rgba(255,255,255,0.25)' : 'var(--bg-app)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontSize: '10px'
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Category Breakdown Progress */}
      {summary?.categoryBreakdown?.length > 0 && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '24px'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PieChart size={17} color="var(--color-primary)" /> Expense Distribution ({selectedDate})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
            {summary.categoryBreakdown.map(item => {
              const meta = getCategoryMeta(item.category);
              const percentage = summary.totalExpenses > 0 ? ((item.total / summary.totalExpenses) * 100).toFixed(1) : 0;
              return (
                <div key={item.category} style={{ background: 'var(--bg-app)', padding: '12px 14px', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    <span>{meta.icon || '📝'} {item.category}</span>
                    <span>{percentage}%</span>
                  </div>
                  <div style={{ height: '6px', width: '100%', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${percentage}%`, background: meta.color || 'var(--color-primary)', borderRadius: '3px' }} />
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
            <div style={{ position: 'relative', minWidth: '220px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search notes / vendor / bill #…"
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
              <option value="all">All Categories ({categories.length})</option>
              {categories.map(c => (
                <option key={c.id || c.name} value={c.name}>{c.icon || '📦'} {c.name}</option>
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
            <p style={{ margin: '0 0 16px 0', fontSize: '13px' }}>Click below to record your kitchen purchases (chicken, veggies, gas), wages, or operating bills.</p>
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
                  <th style={{ padding: '12px 14px' }}>Vendor / Supplier</th>
                  <th style={{ padding: '12px 14px' }}>Notes / Description</th>
                  <th style={{ padding: '12px 14px' }}>Bill / Ref #</th>
                  <th style={{ padding: '12px 14px' }}>Payment Method</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px 14px' }}>Staff</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(exp => {
                  const meta = getCategoryMeta(exp.category);
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
                          {meta.icon || '📝'} {exp.category}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: exp.vendor ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {exp.vendor || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', color: exp.notes ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {exp.notes || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', color: exp.receiptNumber ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px' }}>
                        {exp.receiptNumber || '—'}
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
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Receipt size={20} color="var(--color-primary)" /> Record Daily Expense
              </h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>

            <form onSubmit={handleCreateExpense} style={{ display: 'grid', gap: '14px', padding: '16px 0 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
              </div>

              {/* Category selector with quick "+ New" trigger */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>Category</label>
                  <button
                    type="button"
                    onClick={() => setShowQuickAddCat(!showQuickAddCat)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={13} /> {showQuickAddCat ? 'Cancel New Category' : '+ New Category (e.g. Chicken)'}
                  </button>
                </div>

                {showQuickAddCat ? (
                  <div style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'grid',
                    gap: '10px',
                    marginBottom: '8px'
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>
                      Quick Add Category:
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Chicken Expense, Beef, Bakery Supplies…"
                        value={newCatName}
                        onChange={e => setNewCatName(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <select
                        className="form-select"
                        value={newCatIcon}
                        onChange={e => setNewCatIcon(e.target.value)}
                        style={{ width: '65px' }}
                      >
                        {EMOJI_OPTIONS.map(em => (
                          <option key={em} value={em}>{em}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleCreateCategory}
                        disabled={creatingCat || !newCatName.trim()}
                        style={{ padding: '8px 14px' }}
                      >
                        {creatingCat ? '…' : 'Add'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    className="form-select"
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    required
                  >
                    {categories.map(c => (
                      <option key={c.id || c.name} value={c.name}>{c.icon || '📦'} {c.name}</option>
                    ))}
                  </select>
                )}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Vendor / Supplier</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. City Chicken Farm, Lanka Gas"
                    value={formVendor}
                    onChange={e => setFormVendor(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Bill / Invoice #</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. INV-90412"
                    value={formReceiptNo}
                    onChange={e => setFormReceiptNo(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Notes / Description</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 25kg fresh chicken breasts + transport charge"
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

      {/* MANAGE CATEGORIES MODAL */}
      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tag size={20} color="var(--color-primary)" /> Manage Expense Categories
              </h2>
              <button className="modal-close" onClick={() => setShowCategoryModal(false)}>×</button>
            </div>

            <div style={{ padding: '16px 0 0', display: 'grid', gap: '20px' }}>
              {/* Add New Category Card */}
              <div style={{ background: 'var(--bg-app)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FolderPlus size={16} color="var(--color-primary)" /> Create Custom Category
                </h3>
                <form onSubmit={handleCreateCategory} style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Category Name (e.g. Chicken Expense, Seafood)"
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      style={{ flex: 1 }}
                      required
                    />
                    <select
                      className="form-select"
                      value={newCatIcon}
                      onChange={e => setNewCatIcon(e.target.value)}
                      style={{ width: '65px' }}
                    >
                      {EMOJI_OPTIONS.map(em => (
                        <option key={em} value={em}>{em}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Color:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {COLOR_OPTIONS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewCatColor(c)}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: c,
                            border: newCatColor === c ? '2px solid #fff' : 'none',
                            boxShadow: newCatColor === c ? '0 0 0 2px var(--color-primary)' : 'none',
                            cursor: 'pointer'
                          }}
                        />
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={creatingCat || !newCatName.trim()}
                      style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: '12px' }}
                    >
                      {creatingCat ? 'Adding…' : 'Save Category'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Existing Categories List */}
              <div>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 700 }}>
                  Active Categories ({categories.length})
                </h3>
                <div style={{ display: 'grid', gap: '8px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                  {categories.map(cat => (
                    <div
                      key={cat.id || cat.name}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: 'var(--bg-app)',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '18px' }}>{cat.icon || '📦'}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{cat.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {cat.isDefault ? 'Default Category' : 'Custom Category'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: cat.color || '#10b981' }} />
                        {!cat.isDefault && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.id, cat.name)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '4px'
                            }}
                            title="Delete category"
                          >
                            <Trash2 size={15} color="#ef4444" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setShowCategoryModal(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

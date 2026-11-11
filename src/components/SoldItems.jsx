import React, { useMemo, useState } from 'react';
import { BarChart3, Download, PackageCheck, Search, TrendingUp, ShoppingBasket } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { dateAtRestaurant, restaurantTimeZone } from '../utils/restaurant-time';
import { soldItemsPeriod, summarizeSoldItems } from '../utils/sold-items';
import './sold-items.css';

function csvCell(value) {
  const raw = String(value ?? '');
  // Prevent spreadsheet formula execution when opening exported restaurant data.
  const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export default function SoldItems() {
  const { orders, menuItems, settings, currentUser } = usePOS();
  const timeZone = restaurantTimeZone(settings);
  const today = dateAtRestaurant(new Date(), timeZone);
  const [period, setPeriod] = useState('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('quantity');

  // The staff /api/orders endpoint returns only the authenticated restaurant's orders.
  const window = soldItemsPeriod(period, today, from, to);
  const report = useMemo(() => summarizeSoldItems(orders, {
    timeZone, from: window.from, to: window.to, menuItems
  }), [orders, menuItems, timeZone, window.from, window.to]);

  if (!['owner', 'manager'].includes(currentUser?.role) && !currentUser?.isPlatformAdmin) {
    return <section className="view-body"><p role="alert">Only restaurant owners and managers may view sold-item reports.</p></section>;
  }

  const filtered = report.rows.filter(item =>
    (item.name + ' ' + item.category).toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) =>
    sort === 'gross' ? b.gross - a.gross : sort === 'name' ? a.name.localeCompare(b.name) : b.quantity - a.quantity
  );
  const money = value => `${settings?.currencySymbol || 'Rs.'} ${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const exportCsv = () => {
    const header = ['Item', 'Category', 'Quantity sold', 'Orders', 'Gross item sales'];
    const lines = [
      header.map(csvCell).join(','),
      ...filtered.map(row => [row.name, row.category, row.quantity, row.orders, row.gross.toFixed(2)].map(csvCell).join(','))
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gastroflow_sold_items_${window.from || 'all'}_${window.to || 'all'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return <main className="view-body sold-items-view">
    <header className="sold-items-heading">
      <div>
        <p className="sold-items-eyebrow"><BarChart3 size={16}/> RESTAURANT REPORTS</p>
        <h1>Sold Items</h1>
        <p>Understand what customers buy, using your restaurant's local dates ({timeZone}).</p>
      </div>
      <button className="btn btn-secondary" disabled={!filtered.length} onClick={exportCsv}><Download size={17}/> Export CSV</button>
    </header>
    <div className="sold-items-filters" aria-label="Sold items filters">
      <div className="sold-items-period" role="group" aria-label="Reporting period">
        {[['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']].map(([value, label]) =>
          <button key={value} className={period === value ? 'selected' : ''} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>
        )}
      </div>
      {period === 'custom' && <div className="sold-items-range">
        <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
        <label>To <input type="date" min={from} value={to} onChange={e => setTo(e.target.value)}/></label>
      </div>}
    </div>
    <div className="sold-items-stats">
      <article><ShoppingBasket size={20}/><span>Items sold</span><strong>{report.unitsSold.toLocaleString()}</strong></article>
      <article><PackageCheck size={20}/><span>Different items</span><strong>{report.rows.length}</strong></article>
      <article><TrendingUp size={20}/><span>Gross item sales</span><strong>{money(report.grossItemSales)}</strong></article>
      <article><BarChart3 size={20}/><span>Paid orders with items</span><strong>{report.paidOrderCount}</strong></article>
    </div>
    <div className="sold-items-panel">
      <div className="sold-items-panel-head">
        <div><h2>Item performance</h2><p>Rankings and totals from paid orders.</p></div>
        <div className="sold-items-tools">
          <label className="sold-items-search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search items or category" aria-label="Search items"/></label>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort sold items"><option value="quantity">Most sold</option><option value="gross">Highest gross sales</option><option value="name">Name A–Z</option></select>
        </div>
      </div>
      <div className="sold-items-table-wrap">
        <table className="sold-items-table">
          <thead><tr><th>Item</th><th>Category</th><th className="numeric">Units sold</th><th className="numeric">Orders</th><th className="numeric">Gross item sales</th></tr></thead>
          <tbody>{filtered.map((item, index) => <tr key={item.key}>
            <td><span className="sold-items-rank">{index + 1}</span><strong>{item.name}</strong></td>
            <td>{item.category}</td>
            <td className="numeric">{item.quantity.toLocaleString()}</td>
            <td className="numeric">{item.orders.toLocaleString()}</td>
            <td className="numeric sold-items-money">{money(item.gross)}</td>
          </tr>)}</tbody>
        </table>
        {!filtered.length && <div className="sold-items-empty">No sold items match the selected period and search.</div>}
      </div>
      <p className="sold-items-note">Gross item sales are based on item prices before order-level discounts, tax, service charges, and refunds. This is not net profit or reconciled revenue.</p>
    </div>
  </main>;
}

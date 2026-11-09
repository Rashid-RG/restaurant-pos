import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Calendar, ChevronLeft, ChevronRight, Download, Printer, Filter, 
  Search, X, Eye, FileText, CheckCircle2, ShieldCheck, Utensils
} from 'lucide-react';
import { usePOS } from '../context/POSContext';

export default function Dashboard() {
  const { orders, tables, menuItems, settings, refundOrder, showToast, currentUser } = usePOS();
  const canvasRef = useRef(null);

  // Shop details
  const shopName = settings?.businessName || settings?.restaurantName || 'KB2C';
  const shopLogo = settings?.logoUrl || settings?.restaurantLogo || settings?.logo || null;

  // ─── Date Filter States ──────────────────────────────────────────────────
  // 'today' | 'yesterday' | 'date' | 'range' | 'week' | 'month' | 'all'
  const [filterMode, setFilterMode] = useState('today');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Table search & filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDining, setFilterDining] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');

  // Receipt Modal State
  const [viewingReceipt, setViewingReceipt] = useState(null);

  // PDF Report Modal State
  const [showPdfModal, setShowPdfModal] = useState(false);

  // Refund States
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [refundError, setRefundError] = useState('');
  const refundBusyRef = useRef(false);
  const [refundBusy, setRefundBusy] = useState(false);

  // Timeclock, Feedback & X-Report States
  const [timeclockLogs, setTimeclockLogs] = useState([]);
  const [feedbacksList, setFeedbacksList] = useState([]);
  const [showXReportModal, setShowXReportModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('gastroflow_token');
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

  const safeDate = (val) => {
    if (!val) return new Date();
    const num = typeof val === 'number' ? val : Number(val);
    return isNaN(num) ? new Date(val) : new Date(num);
  };

  const toLocalDateIso = (val) => {
    const d = safeDate(val);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatCurrency = (amount) => {
    const symbol = settings?.currencySymbol || 'Rs.';
    return `${symbol} ${Number(amount || 0).toFixed(2)}`;
  };

  // Change single date navigator (< Prev / Next >)
  const shiftSingleDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
    setFilterMode('date');
  };

  // ─── Filtered Orders Calculation ─────────────────────────────────────────
  const { 
    filteredOrders, periodRevenue, cashRevenue, cardRevenue, splitRevenue, 
    totalTax, totalDiscount, filterDescription,
    dineInOrders, takeawayOrders, deliveryOrders
  } = useMemo(() => {
    const todayIso = toLocalDateIso(new Date());
    
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yesterdayIso = toLocalDateIso(yest);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoIso = toLocalDateIso(weekAgo);

    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartIso = toLocalDateIso(monthStart);

    let desc = "Today's Sales";
    if (filterMode === 'yesterday') desc = `Yesterday's Sales (${yesterdayIso})`;
    else if (filterMode === 'date') desc = `Sales for ${selectedDate}`;
    else if (filterMode === 'range') desc = `Sales from ${startDate} to ${endDate}`;
    else if (filterMode === 'week') desc = "Past 7 Days Sales";
    else if (filterMode === 'month') desc = "This Month's Sales";
    else if (filterMode === 'all') desc = "All-Time Sales";

    // Only paid orders count toward sales
    const paidOrders = orders.filter((o) => o.paymentStatus === 'paid' || o.status === 'paid');

    const result = paidOrders.filter((order) => {
      const orderDate = toLocalDateIso(order.paymentTimestamp || order.timestamp);

      // Date match
      let dateMatch = false;
      if (filterMode === 'today') dateMatch = orderDate === todayIso;
      else if (filterMode === 'yesterday') dateMatch = orderDate === yesterdayIso;
      else if (filterMode === 'date') dateMatch = orderDate === selectedDate;
      else if (filterMode === 'range') dateMatch = orderDate >= startDate && orderDate <= endDate;
      else if (filterMode === 'week') dateMatch = orderDate >= weekAgoIso && orderDate <= todayIso;
      else if (filterMode === 'month') dateMatch = orderDate >= monthStartIso && orderDate <= todayIso;
      else if (filterMode === 'all') dateMatch = true;

      if (!dateMatch) return false;

      // Dining type match
      if (filterDining !== 'all') {
        const dType = order.diningType || order.orderType || 'dine-in';
        if (dType !== filterDining) return false;
      }

      // Payment method match
      if (filterPayment !== 'all') {
        const pMethod = order.paymentMethod || 'cash';
        if (pMethod !== filterPayment) return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const idMatch = (order.id || '').toLowerCase().includes(q);
        const invMatch = (order.invoiceNumber || '').toLowerCase().includes(q);
        const nameMatch = (order.customerName || '').toLowerCase().includes(q);
        const phoneMatch = (order.customerPhone || '').toLowerCase().includes(q);
        const tableMatch = order.tableId && String(tables.find(t => t.id === order.tableId)?.number || '').includes(q);
        const itemsMatch = Array.isArray(order.items) && order.items.some(it => (it.name || '').toLowerCase().includes(q));

        if (!idMatch && !invMatch && !nameMatch && !phoneMatch && !tableMatch && !itemsMatch) {
          return false;
        }
      }

      return true;
    });

    const rev = result.reduce((sum, o) => sum + (o.total || 0), 0);
    const cash = result.filter(o => o.paymentMethod === 'cash').reduce((sum, o) => sum + (o.total || 0), 0);
    const card = result.filter(o => o.paymentMethod === 'card' || o.paymentMethod === 'payhere').reduce((sum, o) => sum + (o.total || 0), 0);
    const split = result.filter(o => o.paymentMethod === 'split').reduce((sum, o) => sum + (o.total || 0), 0);
    const tax = result.reduce((sum, o) => sum + (o.tax || 0), 0);
    const disc = result.reduce((sum, o) => sum + (o.discount || 0), 0);

    const dineIn = result.filter(o => (o.diningType || o.orderType || 'dine-in') === 'dine-in');
    const takeaway = result.filter(o => (o.diningType || o.orderType) === 'takeaway');
    const delivery = result.filter(o => (o.diningType || o.orderType) === 'delivery');

    return {
      filteredOrders: result,
      periodRevenue: rev,
      cashRevenue: cash,
      cardRevenue: card,
      splitRevenue: split,
      totalTax: tax,
      totalDiscount: disc,
      filterDescription: desc,
      dineInOrders: dineIn,
      takeawayOrders: takeaway,
      deliveryOrders: delivery
    };
  }, [orders, tables, filterMode, selectedDate, startDate, endDate, filterDining, filterPayment, searchTerm]);

  // General live indicators
  const activeOrdersCount = orders.filter((o) => ['pending', 'preparing', 'ready', 'hold'].includes(o.status)).length;
  const occupiedTables = tables.filter((t) => t.status !== 'free').length;
  const occupancyRate = tables.length > 0 ? Math.round((occupiedTables / tables.length) * 100) : 0;
  const lowStockItems = menuItems.filter((item) => item.stock <= item.minStock).length;

  // 3. Draw Sales Trend Chart (Canvas) - Past 7 Days
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const daysData = [];
    const todayVal = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayVal.getDate() - i);
      const dateStr = d.toDateString();
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      
      const daySales = orders
        .filter((o) => (o.paymentStatus === 'paid' || o.status === 'paid') && safeDate(o.paymentTimestamp || o.timestamp).toDateString() === dateStr)
        .reduce((sum, o) => sum + o.total, 0);

      daysData.push({ day: dayName, total: daySales });
    }

    const maxVal = Math.max(...daysData.map((d) => d.total), 100);
    const chartHeight = height - 60;
    const chartWidth = width - 60;
    const paddingLeft = 45;
    const paddingTop = 20;

    ctx.clearRect(0, 0, width, height);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? '#2a354f' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const primaryColor = '#10b981';

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
      ctx.fillText(`${settings?.currencySymbol || 'Rs.'}${Math.round(val)}`, 8, y + 4);
    }

    const points = [];
    const stepX = chartWidth / (daysData.length - 1 || 1);

    daysData.forEach((data, index) => {
      const x = paddingLeft + index * stepX;
      const y = paddingTop + chartHeight - (data.total / maxVal) * chartHeight;
      points.push({ x, y, label: data.day, total: data.total });
    });

    if (points.length > 0) {
      const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
      gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
      ctx.beginPath();
      ctx.moveTo(points[0].x, paddingTop + chartHeight);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, paddingTop + chartHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 3;
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      if (p.total > 0) {
        ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(p.total).toString(), p.x, p.y - 10);
      }

      ctx.fillStyle = textColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, paddingTop + chartHeight + 20);
    });
  }, [orders, settings]);

  // Top items in the filtered period
  const topItems = useMemo(() => {
    const itemCounts = {};
    filteredOrders.forEach((order) => {
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const name = item.name || 'Dish';
          itemCounts[name] = (itemCounts[name] || 0) + (item.quantity || 1);
        });
      }
    });

    return Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredOrders]);

  // Export CSV handler for currently filtered sales
  const exportToCSV = () => {
    if (!filteredOrders || filteredOrders.length === 0) {
      return showToast('No sales records match the current filter to export.', 'info');
    }
    const headers = ['Invoice / Order ID', 'Date & Time', 'Dining Mode', 'Table', 'Customer', 'Payment Mode', 'Subtotal', 'Tax', 'Discount', 'Tip', 'Total'];
    const rows = filteredOrders.map(o => [
      o.invoiceNumber || o.id,
      safeDate(o.paymentTimestamp || o.timestamp).toLocaleString(),
      o.diningType || o.orderType || 'dine-in',
      o.tableId ? (tables.find(t => t.id === o.tableId)?.number || o.tableId) : 'N/A',
      `"${(o.customerName || 'Walk-in').replace(/"/g, '""')}"`,
      o.paymentMethod || 'cash',
      o.subtotal || o.total,
      o.tax || 0,
      o.discount || 0,
      o.tip || 0,
      o.total
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `gastroflow_sales_${shopName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`✅ Exported ${filteredOrders.length} sales records to CSV`, 'success');
  };

  // Reusable PDF / Printable Document Component Layout
  const renderAuditDocument = () => {
    const dineInRevenue = dineInOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const takeawayRevenue = takeawayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const deliveryRevenue = deliveryOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    return (
      <div style={{
        background: '#ffffff',
        color: '#111827',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        lineHeight: 1.4,
        padding: '24px 30px'
      }}>
        {/* ─── DOCUMENT HEADER (DUAL BRANDING: SHOP + PLATFORM) ─── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '3px solid #24664f',
          paddingBottom: '16px',
          marginBottom: '20px'
        }}>
          {/* Left: Restaurant / Shop Branding */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '55%' }}>
            {shopLogo ? (
              <img 
                src={shopLogo} 
                alt={shopName} 
                style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '10px', border: '1px solid #e2e8f0' }} 
              />
            ) : (
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #24664f 0%, #174233 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: '800',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
              }}>
                {shopName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#111827', letterSpacing: '-0.5px' }}>
                {shopName}
              </h1>
              <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
                {settings?.address || 'Restaurant Operations • Colombo, Sri Lanka'}
              </div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>
                Hotline: {settings?.phone || '0712237947'} {settings?.whatsapp ? `• WhatsApp: ${settings.whatsapp}` : ''}
              </div>
            </div>
          </div>

          {/* Right: Platform Branding & Statement Title */}
          <div style={{ textAlign: 'right', maxWidth: '42%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginBottom: '4px' }}>
              <img src="/pos-logo.svg" alt="GastroFlow" width="28" height="28" style={{ borderRadius: '6px' }} />
              <span style={{ fontSize: '17px', fontWeight: '800', color: '#24664f', letterSpacing: '-0.3px' }}>
                gastroflow<span style={{ color: '#edc780' }}>.</span>
              </span>
            </div>
            <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '600' }}>
              The Smart Restaurant Workspace
            </div>
            <div style={{
              display: 'inline-block',
              background: '#24664f',
              color: '#ffffff',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginTop: '8px'
            }}>
              Official Sales Audit Statement
            </div>
            <div style={{ fontSize: '11px', color: '#374151', marginTop: '6px', fontWeight: '600' }}>
              Period: <span style={{ color: '#24664f' }}>{filterDescription}</span>
            </div>
            <div style={{ fontSize: '10px', color: '#9ca3af' }}>
              Generated: {new Date().toLocaleString()} by {currentUser?.username || 'Authorized Staff'}
            </div>
          </div>
        </div>

        {/* ─── EXECUTIVE KPI SUMMARY (4 CARDS) ─── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginBottom: '20px'
        }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#166534', fontWeight: '700', letterSpacing: '0.5px' }}>Total Gross Revenue</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: '#15803d', marginTop: '4px' }}>{formatCurrency(periodRevenue)}</div>
            <div style={{ fontSize: '10px', color: '#166534' }}>{filteredOrders.length} Settled Invoices</div>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#1e40af', fontWeight: '700', letterSpacing: '0.5px' }}>Avg. Ticket Value</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: '#1d4ed8', marginTop: '4px' }}>
              {formatCurrency(filteredOrders.length > 0 ? periodRevenue / filteredOrders.length : 0)}
            </div>
            <div style={{ fontSize: '10px', color: '#1e40af' }}>Per Customer Check</div>
          </div>
          <div style={{ background: '#fefce8', border: '1px solid #fef08a', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#854d0e', fontWeight: '700', letterSpacing: '0.5px' }}>Tax & Discounts</div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#713f12', marginTop: '4px' }}>
              Tax: +{formatCurrency(totalTax)}
            </div>
            <div style={{ fontSize: '10px', color: '#854d0e' }}>Disc: -{formatCurrency(totalDiscount)}</div>
          </div>
          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#6b21a8', fontWeight: '700', letterSpacing: '0.5px' }}>Cash vs Card</div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#581c87', marginTop: '4px' }}>
              💵 {formatCurrency(cashRevenue)}
            </div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#581c87' }}>
              💳 {formatCurrency(cardRevenue)}
            </div>
          </div>
        </div>

        {/* ─── BREAKDOWN GRIDS: PAYMENT TENDERS & DINING CHANNELS ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          {/* Payment Mode Ledger */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', background: '#fafafa' }}>
            <div style={{ fontWeight: '700', fontSize: '12px', color: '#374151', textTransform: 'uppercase', marginBottom: '8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }}>
              💳 Payment Tender Reconciliation
            </div>
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 0' }}>💵 Cash In Hand</td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(cashRevenue)}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>
                    ({filteredOrders.filter(o => o.paymentMethod === 'cash').length} bills)
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 0' }}>💳 Card / Terminal</td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(cardRevenue)}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>
                    ({filteredOrders.filter(o => o.paymentMethod === 'card' || o.paymentMethod === 'payhere').length} bills)
                  </td>
                </tr>
                {splitRevenue > 0 && (
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '4px 0' }}>🔀 Split Tender</td>
                    <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(splitRevenue)}</td>
                    <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>
                      ({filteredOrders.filter(o => o.paymentMethod === 'split').length} bills)
                    </td>
                  </tr>
                )}
                <tr style={{ fontWeight: '800', color: '#111827' }}>
                  <td style={{ paddingTop: '6px' }}>Total Settled Tenders</td>
                  <td style={{ paddingTop: '6px', textAlign: 'right', color: '#24664f' }}>{formatCurrency(periodRevenue)}</td>
                  <td style={{ paddingTop: '6px', textAlign: 'right' }}>{filteredOrders.length} bills</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Dining Channel Breakdown */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', background: '#fafafa' }}>
            <div style={{ fontWeight: '700', fontSize: '12px', color: '#374151', textTransform: 'uppercase', marginBottom: '8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }}>
              🍽️ Fulfillment Channel Breakdown
            </div>
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 0' }}>🍽️ Dine-in Service</td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(dineInRevenue)}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>({dineInOrders.length} tables)</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 0' }}>🥡 Takeaway & Pickup</td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(takeawayRevenue)}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>({takeawayOrders.length} orders)</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 0' }}>🛵 Delivery Orders</td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(deliveryRevenue)}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '10px' }}>({deliveryOrders.length} drops)</td>
                </tr>
                <tr style={{ fontWeight: '800', color: '#111827' }}>
                  <td style={{ paddingTop: '6px' }}>Total Channel Sales</td>
                  <td style={{ paddingTop: '6px', textAlign: 'right', color: '#24664f' }}>{formatCurrency(periodRevenue)}</td>
                  <td style={{ paddingTop: '6px', textAlign: 'right' }}>100% Volume</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── TOP DISHES SUMMARY (IF ANY) ─── */}
        {topItems.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontWeight: '700', fontSize: '12px', color: '#374151', textTransform: 'uppercase', marginBottom: '6px' }}>
              🔥 Top 5 Dishes Sold in this Period
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
              {topItems.map((item, idx) => (
                <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px', textAlign: 'center', background: '#f9fafb' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {idx + 1}. {item.name}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: '800', color: '#24664f', marginTop: '2px' }}>
                    {item.count} sold
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── DETAILED SALES TRANSACTIONS LEDGER TABLE ─── */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontWeight: '700', fontSize: '12px', color: '#374151', textTransform: 'uppercase' }}>
              🧾 Settled Sales Ledger ({filteredOrders.length} Invoices)
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              Amounts in {settings?.currencySymbol || 'Rs.'} (LKR)
            </div>
          </div>

          <table style={{
            width: '100%',
            fontSize: '11px',
            borderCollapse: 'collapse',
            border: '1px solid #e5e7eb'
          }}>
            <thead>
              <tr style={{ background: '#f3f4f6', color: '#374151', textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '6px 8px', width: '14%' }}>Invoice / ID</th>
                <th style={{ padding: '6px 8px', width: '13%' }}>Date & Time</th>
                <th style={{ padding: '6px 8px', width: '12%' }}>Channel</th>
                <th style={{ padding: '6px 8px', width: '16%' }}>Customer / Table</th>
                <th style={{ padding: '6px 8px', width: '25%' }}>Dishes Ordered</th>
                <th style={{ padding: '6px 8px', width: '10%' }}>Tender</th>
                <th style={{ padding: '6px 8px', width: '10%', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((sale, idx) => {
                const itemsSummary = Array.isArray(sale.items)
                  ? sale.items.map(it => `${it.quantity}x ${it.name}`).join(', ')
                  : 'N/A';

                return (
                  <tr key={sale.id} style={{
                    borderBottom: '1px solid #e5e7eb',
                    background: idx % 2 === 0 ? '#ffffff' : '#f9fafb'
                  }}>
                    <td style={{ padding: '6px 8px', fontWeight: '700', color: '#1f2937' }}>
                      {sale.invoiceNumber ? `INV-${sale.invoiceNumber}` : `#${sale.id.slice(-6)}`}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div>{safeDate(sale.paymentTimestamp || sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div style={{ color: '#9ca3af', fontSize: '9px' }}>{toLocalDateIso(sale.paymentTimestamp || sale.timestamp)}</div>
                    </td>
                    <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>
                      {sale.diningType || sale.orderType || 'dine-in'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {sale.tableId ? `Table ${tables.find(t => t.id === sale.tableId)?.number || sale.tableId}` : (sale.customerName || 'Walk-in')}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={itemsSummary}>
                      {itemsSummary}
                    </td>
                    <td style={{ padding: '6px 8px', textTransform: 'capitalize', fontWeight: '600' }}>
                      {sale.paymentMethod || 'Cash'}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '700', color: '#111827' }}>
                      {formatCurrency(sale.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f3f4f6', fontWeight: '800', borderTop: '2px solid #cbd5e1' }}>
                <td colSpan="6" style={{ padding: '8px', textAlign: 'right', textTransform: 'uppercase' }}>
                  GRAND TOTAL AUDITED:
                </td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#24664f', fontSize: '13px' }}>
                  {formatCurrency(periodRevenue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ─── AUDIT SIGNATURES & OFFICIAL STAMP AREA ─── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px',
          borderTop: '1px dashed #94a3b8',
          paddingTop: '20px',
          marginBottom: '24px'
        }}>
          <div>
            <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', marginBottom: '32px' }}>
              Prepared By (Cashier / Operator)
            </div>
            <div style={{ borderBottom: '1px solid #111827', width: '85%' }}></div>
            <div style={{ fontSize: '10px', color: '#374151', marginTop: '4px' }}>
              Name: {currentUser?.username || 'Staff'} • Signature
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', marginBottom: '32px' }}>
              Verified By (Store Manager / Owner)
            </div>
            <div style={{ borderBottom: '1px solid #111827', width: '85%' }}></div>
            <div style={{ fontSize: '10px', color: '#374151', marginTop: '4px' }}>
              Authorized Manager Signature
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', marginBottom: '32px' }}>
              Official Restaurant Seal & Date
            </div>
            <div style={{ borderBottom: '1px solid #111827', width: '85%' }}></div>
            <div style={{ fontSize: '10px', color: '#374151', marginTop: '4px' }}>
              Date Stamp: {new Date().toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* ─── FOOTER (PLATFORM BRANDING + SLOGAN) ─── */}
        <div style={{
          borderTop: '2px solid #e5e7eb',
          paddingTop: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '10px',
          color: '#6b7280'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <img src="/pos-logo.svg" alt="GastroFlow" width="18" height="18" style={{ borderRadius: '3px' }} />
            <strong style={{ color: '#24664f' }}>GastroFlow Restaurant Workspace</strong>
            <span>• Smarter Dining Operations & Cloud POS</span>
          </div>
          <div>
            Official Financial Statement • Store: <strong>{shopName}</strong> • www.gastroflow.lk
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="main-content">
      {/* Top Header */}
      <div className="view-header">
        <div className="view-title">
          <h1>Manager Dashboard & Sales</h1>
          <p>Real-time analytics, daily revenue reports, and entire sales receipts history.</p>
        </div>
        <div className="view-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setShowXReportModal(true)}>
            📄 X-Report (Mid-Shift)
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => setShowPdfModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={15} />
            Print / Save as PDF
          </button>
          <button className="btn btn-primary" onClick={exportToCSV}>
            <Download size={15} style={{ marginRight: '6px' }} />
            Export Filtered CSV ({filteredOrders.length})
          </button>
        </div>
      </div>

      <div className="view-body">
        {/* ─── Modern Date Filtering Toolbar ─── */}
        <div className="card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '16px 20px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            {/* Quick Filter Tabs */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'date', label: 'Specific Day' },
                { id: 'range', label: 'Date Range' },
                { id: 'week', label: 'Past 7 Days' },
                { id: 'month', label: 'This Month' },
                { id: 'all', label: 'All Time' },
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`btn ${filterMode === tab.id ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    padding: '6px 14px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    fontWeight: filterMode === tab.id ? '700' : '500'
                  }}
                  onClick={() => setFilterMode(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Subtitle / Period Indicator */}
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={15} style={{ color: 'var(--color-primary)' }} />
              <strong style={{ color: 'var(--text-main)' }}>{filterDescription}</strong>
            </div>
          </div>

          {/* Conditional Date Pickers */}
          {filterMode === 'date' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid var(--border-color)',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontSize: '13px', fontWeight: '600' }}>Pick Day:</span>
              <button 
                className="btn btn-outline" 
                style={{ padding: '6px 10px', height: 'auto' }} 
                onClick={() => shiftSingleDate(-1)} 
                title="Previous Day"
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={e => e.target.value && setSelectedDate(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              />
              <button 
                className="btn btn-outline" 
                style={{ padding: '6px 10px', height: 'auto' }} 
                onClick={() => shiftSingleDate(1)} 
                title="Next Day"
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="btn btn-outline"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => {
                  setSelectedDate(new Date().toISOString().slice(0, 10));
                  setFilterMode('today');
                }}
              >
                Reset to Today
              </button>
            </div>
          )}

          {filterMode === 'range' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid var(--border-color)',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: '600' }}>From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => e.target.value && setStartDate(e.target.value)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: '600' }}>To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => e.target.value && setEndDate(e.target.value)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ─── Dynamic Sales Summary KPIs for Selected Period ─── */}
        <div className="dashboard-grid" style={{ marginBottom: '20px' }}>
          <div className="card stat-card">
            <div className="stat-info">
              <h3>{filterMode === 'today' ? "Today's Revenue" : 'Filtered Revenue'}</h3>
              <p style={{ color: 'var(--color-primary)', fontWeight: '800' }}>{formatCurrency(periodRevenue)}</p>
              <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {filteredOrders.length} paid order{filteredOrders.length === 1 ? '' : 's'}
              </small>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
              💰
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Avg. Order Value</h3>
              <p>{formatCurrency(filteredOrders.length > 0 ? periodRevenue / filteredOrders.length : 0)}</p>
              <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                Per settled ticket
              </small>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>
              📊
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Payment Breakdown</h3>
              <div style={{ fontSize: '12px', marginTop: '4px', lineHeight: 1.4 }}>
                <div>💵 Cash: <strong>{formatCurrency(cashRevenue)}</strong></div>
                <div>💳 Card: <strong>{formatCurrency(cardRevenue)}</strong></div>
                {splitRevenue > 0 && <div>🔀 Split: <strong>{formatCurrency(splitRevenue)}</strong></div>}
              </div>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(234, 179, 8, 0.1)', color: '#eab308' }}>
              💳
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-info">
              <h3>Live Operations</h3>
              <p>{activeOrdersCount} Active</p>
              <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {occupiedTables} of {tables.length} tables ({occupancyRate}%)
              </small>
            </div>
            <div className="stat-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
              🔥
            </div>
          </div>
        </div>

        {/* ─── Charts Row ─── */}
        <div className="charts-row" style={{ marginBottom: '20px' }}>
          <div className="card chart-card">
            <div className="chart-header">
              <h2>Weekly Sales Trend (Last 7 Days)</h2>
            </div>
            <div className="chart-container">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="card chart-card">
            <div className="chart-header">
              <h2>Top 5 Dishes Sold ({filterDescription})</h2>
            </div>
            {topItems.length === 0 ? (
              <div className="cart-empty" style={{ flexGrow: 1 }}>
                <p>No item sales recorded for this period.</p>
              </div>
            ) : (
              <div className="top-items-list">
                {topItems.map((item, idx) => (
                  <div className="top-item-row" key={idx}>
                    <div className="top-item-name">
                      {idx + 1}. {item.name}
                    </div>
                    <div className="top-item-count">{item.count} portions sold</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── ENTIRE SALES RECEIPTS TABLE (Full Historical + Filtered) ─── */}
        <div className="card" style={{ marginBottom: '24px' }}>
          {/* Table Header and Search Toolbar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '18px', fontWeight: '700', margin: 0 }}>
                Entire Sales Receipts ({filteredOrders.length})
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {filterDescription} • Total Revenue: <strong style={{ color: 'var(--color-primary)' }}>{formatCurrency(periodRevenue)}</strong>
              </span>
            </div>

            {/* Filters & Search */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search order, invoice, dish..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ paddingLeft: '32px', height: '34px', fontSize: '13px', width: '200px' }}
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')} 
                    style={{ position: 'absolute', right: '8px', top: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                className="form-input"
                value={filterDining}
                onChange={e => setFilterDining(e.target.value)}
                style={{ height: '34px', fontSize: '12px', padding: '4px 8px' }}
              >
                <option value="all">All Dining Types</option>
                <option value="dine-in">Dine-in</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>

              <select
                className="form-input"
                value={filterPayment}
                onChange={e => setFilterPayment(e.target.value)}
                style={{ height: '34px', fontSize: '12px', padding: '4px 8px' }}
              >
                <option value="all">All Payment Modes</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="split">Split Tender</option>
                <option value="payhere">PayHere</option>
              </select>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🧾</div>
              <p style={{ fontWeight: 600, fontSize: '15px', margin: '0 0 6px 0' }}>No sales found for this filter</p>
              <p style={{ fontSize: '13px', margin: '0 0 16px 0' }}>Try picking another date or reset the date filter to view earlier receipts.</p>
              <button 
                className="btn btn-primary" 
                style={{ padding: '6px 16px', fontSize: '13px' }} 
                onClick={() => { setFilterMode('all'); setSearchTerm(''); setFilterDining('all'); setFilterPayment('all'); }}
              >
                Show All-Time Sales
              </button>
            </div>
          ) : (
            <div className="data-table-container" style={{ border: 'none', marginTop: 0, maxHeight: '520px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 2 }}>
                  <tr>
                    <th>Invoice / ID</th>
                    <th>Date & Time</th>
                    <th>Dining Mode</th>
                    <th>Table / Customer</th>
                    <th>Dishes Summary</th>
                    <th>Payment</th>
                    <th>Total Amount</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((sale) => {
                    const itemsSummary = Array.isArray(sale.items)
                      ? sale.items.map(it => `${it.quantity}x ${it.name}`).join(', ')
                      : 'N/A';

                    return (
                      <tr key={sale.id}>
                        <td>
                          <div style={{ fontWeight: '700', color: 'var(--color-primary)' }}>
                            {sale.invoiceNumber ? `INV-${sale.invoiceNumber}` : `#${sale.id.slice(-6)}`}
                          </div>
                          {sale.invoiceNumber && <small style={{ color: 'var(--text-muted)', fontSize: '10px' }}>#{sale.id.slice(-6)}</small>}
                        </td>
                        <td>
                          <div style={{ fontSize: '13px', fontWeight: '600' }}>
                            {safeDate(sale.paymentTimestamp || sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {toLocalDateIso(sale.paymentTimestamp || sale.timestamp)}
                          </small>
                        </td>
                        <td>
                          <span className={`badge ${(sale.diningType || sale.orderType) === 'dine-in' ? 'badge-primary' : (sale.diningType || sale.orderType) === 'delivery' ? 'badge-warning' : 'badge-info'}`}>
                            {sale.diningType || sale.orderType || 'dine-in'}
                          </span>
                        </td>
                        <td>
                          {sale.tableId ? (
                            <span style={{ fontWeight: '600' }}>
                              Table {tables.find(t => t.id === sale.tableId)?.number || sale.tableId}
                            </span>
                          ) : sale.customerName ? (
                            <span>👤 {sale.customerName}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Counter Walk-in</span>
                          )}
                        </td>
                        <td style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={itemsSummary}>
                          <span style={{ fontSize: '12px' }}>{itemsSummary}</span>
                        </td>
                        <td>
                          <span style={{
                            textTransform: 'capitalize',
                            fontWeight: '600',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            background: sale.paymentMethod === 'cash' ? 'rgba(34, 197, 94, 0.1)' : sale.paymentMethod === 'card' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                            color: sale.paymentMethod === 'cash' ? 'var(--color-success)' : sale.paymentMethod === 'card' ? '#3b82f6' : '#ca8a04'
                          }}>
                            {sale.paymentMethod || 'Cash'}
                          </span>
                        </td>
                        <td style={{ fontWeight: '800', fontSize: '14px', color: 'var(--color-primary)' }}>
                          {formatCurrency(sale.total)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => setViewingReceipt(sale)}
                              title="View and Print Receipt"
                            >
                              <Eye size={12} /> Receipt
                            </button>
                            {sale.refundedAmount >= sale.total ? (
                              <span style={{ fontSize: '11px', color: 'var(--color-danger)', fontWeight: 'bold', alignSelf: 'center' }}>REFUNDED</span>
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
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                  <div key={fb.id} style={{ padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600 }}>Order #{fb.orderId ? fb.orderId.slice(-6) : 'N/A'}</span>
                      <span style={{ color: '#f59e0b' }}>{'★'.repeat(fb.rating || 5)}{'☆'.repeat(5 - (fb.rating || 5))}</span>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-main)', fontStyle: 'italic' }}>"{fb.comment || 'Good food and service!'}"</p>
                    <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                      {new Date(fb.createdAt).toLocaleDateString()}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── DEDICATED SALES REPORT PDF PREVIEW MODAL ─── */}
        {showPdfModal && (
          <div className="modal-overlay" style={{ zIndex: 1200 }}>
            <div className="modal-content" style={{ maxWidth: '880px', width: '92%', maxHeight: '92vh', overflowY: 'auto', padding: '0', background: '#f8fafc' }}>
              {/* Modal Control Bar */}
              <div style={{
                position: 'sticky',
                top: 0,
                background: '#ffffff',
                borderBottom: '1px solid #e2e8f0',
                padding: '14px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                zIndex: 10
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#111827' }}>
                    📄 Sales Audit Statement PDF Preview
                  </h3>
                  <small style={{ color: '#64748b' }}>Ready for printing or saving as PDF via browser print dialog</small>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => window.print()}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700' }}
                  >
                    <Printer size={15} /> Save as PDF / Print
                  </button>
                  <button className="modal-close" onClick={() => setShowPdfModal(false)}>×</button>
                </div>
              </div>

              {/* Rendered Document */}
              <div style={{ padding: '24px' }}>
                <div style={{
                  background: '#ffffff',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid #e2e8f0'
                }}>
                  {renderAuditDocument()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hidden Printable Container: Becomes visible only on window.print() */}
        <div className="sales-report-print-area">
          {renderAuditDocument()}
        </div>

        {/* ─── RECEIPT PREVIEW & PRINT MODAL ─── */}
        {viewingReceipt && (
          <div className="modal-overlay" style={{ zIndex: 1200 }}>
            <div className="modal-content" style={{ maxWidth: '420px', padding: '24px' }}>
              <div className="modal-header" style={{ marginBottom: '14px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px' }}>Order Receipt</h2>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {viewingReceipt.invoiceNumber ? `Invoice #${viewingReceipt.invoiceNumber}` : `Order #${viewingReceipt.id?.slice(-6)}`}
                  </span>
                </div>
                <button className="modal-close" onClick={() => setViewingReceipt(null)}>×</button>
              </div>

              {/* Printable Thermal Receipt Box */}
              <div id="printable-receipt" style={{
                background: '#ffffff',
                color: '#111827',
                padding: '20px',
                borderRadius: '8px',
                border: '1px dashed #cbd5e1',
                fontFamily: 'monospace',
                fontSize: '12px',
                lineHeight: 1.5,
                marginBottom: '16px'
              }}>
                <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                  <div style={{ fontWeight: '800', fontSize: '16px' }}>{shopName}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{settings?.address || 'Colombo, Sri Lanka'}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Tel: {settings?.phone || '0712237947'}</div>
                  <div style={{ borderBottom: '1px dashed #94a3b8', margin: '8px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span>Date: {safeDate(viewingReceipt.paymentTimestamp || viewingReceipt.timestamp).toLocaleDateString()}</span>
                    <span>Time: {safeDate(viewingReceipt.paymentTimestamp || viewingReceipt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span>Type: {(viewingReceipt.diningType || viewingReceipt.orderType || 'dine-in').toUpperCase()}</span>
                    <span>{viewingReceipt.tableId ? `Table: ${tables.find(t => t.id === viewingReceipt.tableId)?.number || viewingReceipt.tableId}` : ''}</span>
                  </div>
                  {viewingReceipt.customerName && (
                    <div style={{ textAlign: 'left', fontSize: '11px', marginTop: '2px' }}>
                      Customer: {viewingReceipt.customerName}
                    </div>
                  )}
                  <div style={{ borderBottom: '1px dashed #94a3b8', margin: '8px 0' }} />
                </div>

                {/* Items */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px' }}>
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Amount</span>
                  </div>
                  {Array.isArray(viewingReceipt.items) && viewingReceipt.items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                      <span>x{item.quantity}</span>
                      <span>{formatCurrency((item.price || item.unitPrice || 0) * item.quantity)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ borderBottom: '1px dashed #94a3b8', margin: '8px 0' }} />

                {/* Totals */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Subtotal:</span>
                    <span>{formatCurrency(viewingReceipt.subtotal || viewingReceipt.total)}</span>
                  </div>
                  {viewingReceipt.discount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                      <span>Discount:</span>
                      <span>-{formatCurrency(viewingReceipt.discount)}</span>
                    </div>
                  )}
                  {viewingReceipt.tax > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tax / VAT:</span>
                      <span>+{formatCurrency(viewingReceipt.tax)}</span>
                    </div>
                  )}
                  {viewingReceipt.tip > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tip:</span>
                      <span>+{formatCurrency(viewingReceipt.tip)}</span>
                    </div>
                  )}
                  <div style={{ borderBottom: '1px dashed #94a3b8', margin: '4px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px' }}>
                    <span>TOTAL:</span>
                    <span>{formatCurrency(viewingReceipt.total)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                    <span>Paid Via:</span>
                    <span style={{ textTransform: 'capitalize' }}>{viewingReceipt.paymentMethod || 'Cash'}</span>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: '14px', fontSize: '11px', color: '#64748b' }}>
                  Thank you for dining with us!
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => window.print()}
                >
                  <Printer size={15} /> Print
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={() => setViewingReceipt(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* X-REPORT MID-SHIFT MODAL */}
        {showXReportModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h2>📄 Mid-Shift X-Report Snapshot</h2>
                <button className="modal-close" onClick={() => setShowXReportModal(false)}>×</button>
              </div>

              {(() => {
                const todayOrders = orders.filter(o => (o.paymentStatus === 'paid' || o.status === 'paid') && toLocalDateIso(o.paymentTimestamp || o.timestamp) === toLocalDateIso(new Date()));
                const todayRev = todayOrders.reduce((sum, o) => sum + o.total, 0);
                const cashSales = todayOrders.filter(o => o.paymentMethod === 'cash').reduce((acc, o) => acc + o.total, 0);
                const cardSales = todayOrders.filter(o => o.paymentMethod === 'card' || o.paymentMethod === 'payhere').reduce((acc, o) => acc + o.total, 0);
                const voidsCount = orders.filter(o => o.status === 'cancelled' || o.status === 'refunded').length;
                const totalTax = todayOrders.reduce((acc, o) => acc + (o.tax || 0), 0);

                return (
                  <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ background: 'var(--bg-surface)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mid-Shift Sales Snapshot</div>
                      <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '4px' }}>{formatCurrency(todayRev)}</div>
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

        {/* REFUND MODAL */}
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
                  setRefundError(`Refund amount must be between ${settings?.currencySymbol || 'Rs.'} 0.01 and ${formatCurrency(refundTarget.total - (refundTarget.refundedAmount || 0))}`);
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

                if (refundBusyRef.current) return;
                refundBusyRef.current = true; setRefundBusy(true);
                try {
                  await refundOrder(refundTarget.id, amt, refundReason, managerPin);
                  showToast('Refund processed successfully!', 'success');
                  setRefundTarget(null);
                  setRefundAmountInput('');
                  setRefundReason('');
                  setManagerPin('');
                } catch (err) {
                  setRefundError(err.message || 'Refund failed');
                } finally { refundBusyRef.current = false; setRefundBusy(false); }
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
                  <label>Refund Amount ({settings?.currencySymbol || 'Rs.'})</label>
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
                    maxLength="6"
                    className="form-input"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    required
                  />
                </div>

                <button type="submit" disabled={refundBusy} className="btn btn-primary" style={{ width: '100%', background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                  {refundBusy ? 'Saving refund…' : 'Authorize & Process Refund'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import ServiceExceptions from "./ServiceExceptions.jsx";
import React, { useCallback, useEffect, useState } from "react";
import { usePOS } from "../context/POSContext";
import { AnimatedFeatureIcon } from "../../shared/ui/AnimatedFeatureIcon.jsx";
import { LayoutGrid, Columns, Maximize2, Minimize2, Clock, CheckCircle2, Flame } from "lucide-react";
import "./service-workflows.css";

export default function KDSView() {
  const { orders, tables, currentUser, settings, playNewOrderChime } = usePOS();
  const [printTicket, setPrintTicket] = useState(null);
  useEffect(() => {
    if (printTicket) {
      const timer = setTimeout(() => window.print(), 150);
      return () => clearTimeout(timer);
    }
  }, [printTicket]);

  const [amendTicket, setAmendTicket] = useState(null);
  const [tickets, setTickets] = useState([]),
    [station, setStation] = useState("all"),
    [stageFilter, setStageFilter] = useState("all"),
    [layoutMode, setLayoutMode] = useState("grid"), // "grid" (All on one page) | "kanban" (3 columns)
    [compactMode, setCompactMode] = useState(true),
    [isFullscreen, setIsFullscreen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [lastSync, setLastSync] = useState(null),
    [routing, setRouting] = useState(null),
    [now, setNow] = useState(Date.now());

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const api = useCallback(async (path, body) => {
    const r = await fetch("/api/kitchen/" + path, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("gastroflow_token"),
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Kitchen unavailable");
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      setTickets(await api("tickets"));
      setLastSync(Date.now());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh, orders]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act(ticket, state, lineId) {
    if (busy) return;
    setBusy(true);
    try {
      await api("tickets/" + ticket.orderId, {
        revision: ticket.revision,
        state,
        lineId,
        ...(ticket.state === "pending" ? { etaMinutes: 25 } : {}),
      });
      await refresh();
    } catch (e) {
      setError(
        e.message + " Refresh to confirm the saved state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = tickets
    .map((t) => ({
      ...t,
      visibleLines: t.lines.filter(
        (l) => station === "all" || l.station === station,
      ),
    }))
    .filter((t) => t.visibleLines.length);

  const filteredTickets = visible.filter(t => stageFilter === "all" || t.state === stageFilter);

  const pendingCount = visible.filter(t => t.state === "pending").length;
  const preparingCount = visible.filter(t => t.state === "preparing").length;
  const readyCount = visible.filter(t => t.state === "ready").length;

  const renderTicketCard = (t) => {
    const elapsedMins = Math.max(0, Math.floor((now - t.createdAt) / 60000));
    const isUrgent = elapsedMins >= 25;
    const isWarning = elapsedMins >= 15 && !isUrgent;
    const stateBadgeColor = t.state === 'ready' ? '#10b981' : t.state === 'preparing' ? '#2563eb' : '#f59e0b';
    const stateLabel = t.state === 'ready' ? 'Ready' : t.state === 'preparing' ? 'Preparing' : 'New';

    return (
      <article
        key={t.orderId}
        className={`service-ticket ${compactMode ? 'compact' : ''}`}
        style={{
          borderTop: `4px solid ${stateBadgeColor}`,
          padding: compactMode ? '12px 14px' : '16px 18px',
          margin: compactMode ? '6px 0' : '10px 0',
          background: 'var(--bg-card)',
          borderRadius: '14px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          border: '1px solid var(--border-color)',
          borderTopColor: stateBadgeColor
        }}
      >
        <div>
          {/* Header: Order ID + Wait Time */}
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ fontSize: compactMode ? '15px' : '17px', color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
                #{t.orderId.slice(-6).toUpperCase()}
              </strong>
              <span style={{
                fontSize: '10px',
                fontWeight: 800,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: '4px',
                background: `${stateBadgeColor}20`,
                color: stateBadgeColor
              }}>
                {stateLabel}
              </span>
            </div>

            {/* Elapsed Timer Badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '6px',
              background: isUrgent ? 'rgba(239, 68, 68, 0.15)' : isWarning ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-surface)',
              color: isUrgent ? '#ef4444' : isWarning ? '#d97706' : 'var(--text-muted)'
            }}>
              {isUrgent ? <Flame size={13} color="#ef4444" /> : <Clock size={12} />}
              <span>{elapsedMins} min</span>
            </div>
          </header>

          {/* Dining Type & Payment Details */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>
              {t.tableId
                ? `Table ${tables.find((x) => x.id === t.tableId)?.number || "—"}`
                : t.diningType || t.orderType || 'Dine-in'}
            </span>
            <span>•</span>
            <span style={{
              fontWeight: 700,
              color: t.paymentStatus === 'paid' ? '#10b981' : '#f59e0b'
            }}>
              {t.orderStatus === "refunded"
                ? "Refunded"
                : t.paymentStatus === "paid"
                  ? "Paid"
                  : "Unpaid"}
            </span>
            {t.customerName && <span>• {t.customerName}</span>}
          </div>

          {/* Line Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: compactMode ? '6px' : '8px' }}>
            {t.visibleLines.map((l) => (
              <div
                key={l.id}
                style={{
                  borderTop: '1px solid var(--border-color)',
                  paddingTop: compactMode ? '6px' : '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: compactMode ? '13px' : '14px', color: 'var(--text-main)' }}>
                    {l.quantity} × {l.name}
                  </strong>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {l.station}
                  </span>
                </div>

                {l.modifiers?.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {l.modifiers.map((m) => m.name).join(", ")}
                  </div>
                )}

                {l.notes && (
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#b45309',
                    background: '#fef3c7',
                    padding: '3px 6px',
                    borderRadius: '4px',
                    marginTop: '3px',
                    borderLeft: '3px solid #f59e0b'
                  }}>
                    Note: {l.notes}
                  </div>
                )}

                {/* Instant Action Button per item */}
                <div style={{ marginTop: '6px' }}>
                  {l.state === "pending" && (
                    <button
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        padding: compactMode ? '5px 8px' : '7px 10px',
                        height: 'auto',
                        minHeight: compactMode ? '32px' : '38px',
                        fontSize: compactMode ? '12px' : '13px',
                        fontWeight: 700
                      }}
                      disabled={busy || !!error}
                      onClick={() => act(t, "preparing", l.id)}
                    >
                      Start {l.name}
                    </button>
                  )}
                  {l.state === "preparing" && (
                    <button
                      className="btn btn-success"
                      style={{
                        width: '100%',
                        padding: compactMode ? '5px 8px' : '7px 10px',
                        height: 'auto',
                        minHeight: compactMode ? '32px' : '38px',
                        fontSize: compactMode ? '12px' : '13px',
                        fontWeight: 700,
                        background: '#10b981',
                        borderColor: '#10b981'
                      }}
                      disabled={busy || !!error}
                      onClick={() => act(t, "ready", l.id)}
                    >
                      Ready: {l.name}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Confirm Handover Button when all items are ready */}
          {t.state === "ready" && t.diningType !== "delivery" && t.orderType !== "delivery" && (
            <div style={{ marginTop: '10px' }}>
              <button
                className="btn btn-success"
                style={{
                  width: '100%',
                  padding: compactMode ? '6px 10px' : '9px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  background: '#10b981'
                }}
                disabled={busy || !!error}
                onClick={() => act(t, "served")}
              >
                ✓ Confirm Served / Handed Over
              </button>
            </div>
          )}

          {t.state === "ready" && (t.diningType === "delivery" || t.orderType === "delivery") && (
            <div style={{ fontSize: '11px', color: 'var(--color-primary)', marginTop: '8px', fontWeight: 600 }}>
              🛵 Awaiting assigned driver pickup.
            </div>
          )}
        </div>

        {/* Card Footer: Compact Secondary Buttons & Revision */}
        <div style={{ marginTop: '10px', paddingTop: '6px', borderTop: '1px dashed var(--border-color)' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {["owner", "manager"].includes(currentUser?.role) && (
              <button
                className="btn btn-secondary"
                style={{ flex: 1, padding: '3px 6px', fontSize: '11px', height: 'auto', minHeight: '26px' }}
                disabled={busy}
                onClick={() => setAmendTicket(t)}
              >
                Amend
              </button>
            )}
            <button
              className="btn btn-secondary"
              style={{ flex: 1, padding: '3px 6px', fontSize: '11px', height: 'auto', minHeight: '26px' }}
              onClick={() => setPrintTicket({ ...t, printedAt: Date.now() })}
            >
              Print
            </button>
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '3px', textAlign: 'right' }}>
            Revision {t.revision}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="main-content service-workspace">
      <header className="view-header">
        <div>
          <h1>Kitchen service</h1>
          <p>
            Preparation stays visible after payment. Finish every station before serving.
          </p>
          <small role="status">
            {lastSync
              ? "Last synchronized " + new Date(lastSync).toLocaleTimeString()
              : "Connecting…"}{" "}
            · refreshes every 10 seconds
          </small>
        </div>
        <div className="service-actions">
          <button className="btn btn-secondary" onClick={refresh}>
            Refresh board
          </button>
          <button className="btn btn-secondary" onClick={playNewOrderChime}>
            Test sound
          </button>
          {["owner", "manager"].includes(currentUser?.role) && (
            <button
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  setRouting(routing ? null : await api("routing"));
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Station routing
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="service-alert" role="alert">
          {error}
        </p>
      )}

      {routing && (
        <section className="service-panel">
          <h2>Route new tickets</h2>
          <p>
            Existing tickets retain their original station. Unconfigured items go to Hot kitchen.
          </p>
          {routing.map((item) => (
            <label className="service-route" key={item.id}>
              <span>{item.name}</span>
              <select
                aria-label={"Station for " + item.name}
                value={item.station}
                disabled={busy}
                onChange={async (e) => {
                  const value = e.target.value;
                  setBusy(true);
                  try {
                    await api("routing", {
                      menuItemId: item.id,
                      station: value,
                    });
                    setRouting(await api("routing"));
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {[
                  ["kitchen", "Hot kitchen"],
                  ["bar", "Bar & drinks"],
                  ["desserts", "Desserts"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}

      {/* ─── KDS CONTROLS TOOLBAR (STATION, STAGE, LAYOUT & COMPACT MODE) ─── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
        margin: '12px 0 16px 0',
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        borderRadius: '14px',
        border: '1px solid var(--border-color)'
      }}>
        {/* Left: Station Filters & Stage Filters */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Station Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            {[
              ["all", "All Stations"],
              ["kitchen", "Hot Kitchen"],
              ["bar", "Bar & Drinks"],
              ["desserts", "Desserts"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={`btn ${station === id ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '4px 10px', height: 'auto', fontSize: '12px', borderRadius: '7px', fontWeight: station === id ? '700' : '500' }}
                onClick={() => setStation(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Stage Filters (All / New / Preparing / Ready) */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            {[
              ["all", `All Tickets (${visible.length})`],
              ["pending", `🟡 New (${pendingCount})`],
              ["preparing", `🔵 Preparing (${preparingCount})`],
              ["ready", `🟢 Ready (${readyCount})`],
            ].map(([id, label]) => (
              <button
                key={id}
                className={`btn ${stageFilter === id ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '4px 10px', height: 'auto', fontSize: '12px', borderRadius: '7px', fontWeight: stageFilter === id ? '700' : '500' }}
                onClick={() => setStageFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Layout Switcher & Compact Mode Toggle */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View Mode Toggle: Grid (All on one page) vs Stage Columns */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <button
              className={`btn ${layoutMode === 'grid' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '4px 10px', height: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '7px', fontWeight: layoutMode === 'grid' ? '700' : '500' }}
              onClick={() => setLayoutMode('grid')}
              title="Fit all active tickets across the full screen in one page"
            >
              <LayoutGrid size={14} /> All on One Page (Grid)
            </button>
            <button
              className={`btn ${layoutMode === 'kanban' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '4px 10px', height: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '7px', fontWeight: layoutMode === 'kanban' ? '700' : '500' }}
              onClick={() => setLayoutMode('kanban')}
              title="Classic 3-column stage view"
            >
              <Columns size={14} /> Stage Columns
            </button>
          </div>

          {/* Compact Density Button */}
          <button
            className={`btn ${compactMode ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '4px 10px', height: 'auto', fontSize: '12px', borderRadius: '8px' }}
            onClick={() => setCompactMode(!compactMode)}
            title="Toggle compact card spacing so more tickets fit on one screen"
          >
            {compactMode ? '🗜️ Compact View' : 'Comfort View'}
          </button>

          {/* Fullscreen Button */}
          <button
            className="btn btn-outline"
            style={{ padding: '4px 8px', height: 'auto', fontSize: '12px', borderRadius: '8px' }}
            onClick={toggleFullscreen}
            title="Toggle fullscreen monitor view"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {printTicket && (
        <div
          className={
            "receipt-print-area " +
            (settings.printerPaperWidth === "58mm"
              ? "paper-58mm"
              : "paper-80mm")
          }
        >
          <h2>KITCHEN TICKET</h2>
          <p>
            Order #{printTicket.orderId.slice(-6).toUpperCase()} · Revision{" "}
            {printTicket.revision}
          </p>
          <p>
            {printTicket.diningType}{" "}
            {printTicket.tableId
              ? "Table " +
                (tables.find((t) => t.id === printTicket.tableId)?.number ||
                  "—")
              : ""}
          </p>
          <p>
            Copy requested {new Date(printTicket.printedAt).toLocaleString()}
          </p>
          {printTicket.visibleLines.map((l) => (
            <section key={l.id}>
              <div className="receipt-divider" />
              <strong>
                {l.quantity} × {l.name}
              </strong>
              <p>
                {l.station} · {l.state}
              </p>
              {l.modifiers.map((m) => (
                <p key={m.id}>{m.name}</p>
              ))}
              {l.notes && (
                <p>
                  <strong>NOTE: {l.notes}</strong>
                </p>
              )}
            </section>
          ))}
          <p>Match order and revision before preparing a duplicate copy.</p>
        </div>
      )}

      <ServiceExceptions
        ticket={amendTicket}
        onClosed={() => setAmendTicket(null)}
        onSaved={refresh}
      />

      {/* ─── VIEW MODE 1: ALL ON ONE PAGE (RESPONSIVE MULTI-COLUMN GRID) ─── */}
      {layoutMode === "grid" && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '14px',
          padding: '4px 0',
          maxHeight: 'calc(100vh - 230px)',
          overflowY: 'auto'
        }}>
          {filteredTickets.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface)', borderRadius: '16px' }}>
              <CheckCircle2 size={36} style={{ color: '#10b981', margin: '0 auto 12px auto' }} />
              <h3 style={{ margin: 0, fontSize: '16px' }}>No active tickets in this stage.</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>All orders have been prepared and served!</p>
            </div>
          ) : (
            filteredTickets.map(renderTicketCard)
          )}
        </div>
      )}

      {/* ─── VIEW MODE 2: STAGE COLUMNS (WITH INDEPENDENT SCROLLING) ─── */}
      {layoutMode === "kanban" && (
        <div className="service-board" style={{ padding: '0', gap: '14px' }}>
          {[
            ["pending", "New tickets"],
            ["preparing", "Preparing"],
            ["ready", "Ready to serve"],
          ].map(([state, label]) => {
            const colTickets = visible.filter((t) => t.state === state);
            return (
              <section className="service-column" key={state} style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
                  {state === "preparing" && <AnimatedFeatureIcon size={22} />}
                  <span>{label}</span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: state === 'ready' ? '#10b981' : state === 'preparing' ? '#2563eb' : '#f59e0b',
                    color: '#fff',
                    marginLeft: 'auto'
                  }}>
                    {colTickets.length}
                  </span>
                </h2>
                <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', paddingRight: '4px' }}>
                  {colTickets.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
                      No tickets in this stage.
                    </p>
                  ) : (
                    colTickets.map(renderTicketCard)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

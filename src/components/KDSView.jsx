import React, { useCallback, useEffect, useState } from "react";
import { usePOS } from "../context/POSContext";
import { AnimatedFeatureIcon } from "../../shared/ui/AnimatedFeatureIcon.jsx";
import "./service-workflows.css";
export default function KDSView() {
  const { orders, tables, currentUser, playNewOrderChime } = usePOS();
  const [tickets, setTickets] = useState([]),
    [station, setStation] = useState("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [lastSync, setLastSync] = useState(null),
    [routing, setRouting] = useState(null),
    [now, setNow] = useState(Date.now());
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
  return (
    <div className="main-content service-workspace">
      <header className="view-header">
        <div>
          <h1>Kitchen service</h1>
          <p>
            Preparation stays visible after payment. Finish every station before
            serving.
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
            Existing tickets retain their original station. Unconfigured items
            go to Hot kitchen.
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
      <nav className="service-actions" aria-label="Kitchen stations">
        {[
          ["all", "All stations"],
          ["kitchen", "Hot kitchen"],
          ["bar", "Bar & drinks"],
          ["desserts", "Desserts"],
        ].map(([id, label]) => (
          <button
            className={
              "btn " + (station === id ? "btn-primary" : "btn-secondary")
            }
            key={id}
            aria-pressed={station === id}
            onClick={() => setStation(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="service-board">
        {[
          ["pending", "New tickets"],
          ["preparing", "Preparing"],
          ["ready", "Ready to serve"],
        ].map(([state, label]) => (
          <section className="service-column" key={state}>
            <h2>
              {state === "preparing" && <AnimatedFeatureIcon size={26} />}{" "}
              {label}{" "}
              <small>{visible.filter((t) => t.state === state).length}</small>
            </h2>
            {!visible.some((t) => t.state === state) && (
              <p>No tickets in this stage.</p>
            )}
            {visible
              .filter((t) => t.state === state)
              .map((t) => (
                <article className="service-ticket" key={t.orderId}>
                  <header>
                    <strong>#{t.orderId.slice(-6).toUpperCase()}</strong>
                    <span>
                      {Math.max(0, Math.floor((now - t.createdAt) / 60000))} min
                    </span>
                  </header>
                  <p>
                    {t.tableId
                      ? "Table " +
                        (tables.find((x) => x.id === t.tableId)?.number || "—")
                      : t.diningType}{" "}
                    ·{" "}
                    <strong>
                      {t.paymentStatus === "paid"
                        ? "Paid"
                        : t.paymentStatus === "partial"
                          ? "Part paid"
                          : "Unpaid"}
                    </strong>
                  </p>
                  {t.customerName && <p>{t.customerName}</p>}
                  {t.visibleLines.map((l) => (
                    <div className="service-line" key={l.id}>
                      <strong>
                        {l.quantity} × {l.name}
                      </strong>
                      <small>
                        {l.station} · {l.state}
                      </small>
                      {l.modifiers?.length > 0 && (
                        <p>{l.modifiers.map((m) => m.name).join(", ")}</p>
                      )}
                      {l.notes && (
                        <p className="service-note">
                          Preparation note: {l.notes}
                        </p>
                      )}
                      {l.state === "pending" && (
                        <button
                          className="btn btn-primary"
                          disabled={busy || !!error}
                          onClick={() => act(t, "preparing", l.id)}
                        >
                          Start {l.name}
                        </button>
                      )}
                      {l.state === "preparing" && (
                        <button
                          className="btn btn-success"
                          disabled={busy || !!error}
                          onClick={() => act(t, "ready", l.id)}
                        >
                          Ready: {l.name}
                        </button>
                      )}
                    </div>
                  ))}
                  {t.state === "ready" &&
                    t.diningType !== "delivery" &&
                    t.orderType !== "delivery" && (
                      <button
                        className="btn btn-success"
                        disabled={busy || !!error}
                        onClick={() => act(t, "served")}
                      >
                        Confirm served / handed over
                      </button>
                    )}
                  {t.state === "ready" &&
                    (t.diningType === "delivery" ||
                      t.orderType === "delivery") && (
                      <p>Awaiting assigned driver pickup.</p>
                    )}
                  <small>Ticket revision {t.revision}</small>
                </article>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

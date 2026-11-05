import React, { useEffect, useRef, useState } from "react";
import { usePOS } from "../context/POSContext";
import "./service-workflows.css";
export default function ManualPayments({ openOrder, onOpened, onReceipt }) {
  const { currentUser, settings, loadAllData } = usePOS(),
    dialog = useRef(null),
    lock = useRef(false);
  const key =
    "gastroflow:manual-payment:" +
    currentUser?.tenant_id +
    ":" +
    currentUser?.id;
  const [list, setList] = useState([]),
    [selected, setSelected] = useState(null),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("cash"),
    [reference, setReference] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    });
  const money = (c) =>
    `${settings.currencySymbol || "LKR "}${(c / 100).toFixed(2)}`;
  async function api(path = "", body) {
    const r = await fetch("/api/manual-payments" + path, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("gastroflow_token"),
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(data.error || "Payment request failed"), {
        status: r.status,
      });
    return data;
  }
  async function choose(id) {
    try {
      const row = await api("/" + id);
      setSelected(row);
      setAmount((row.balanceCents / 100).toFixed(2));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function open(id) {
    dialog.current.showModal();
    setError("");
    try {
      setList(await api());
      if (id) await choose(id);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (openOrder) {
      open(openOrder);
      onOpened?.();
    }
  }, [openOrder]);
  async function submit(saved) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const attempt = saved || {
      orderId: selected.order.id,
      body: {
        requestId: crypto.randomUUID(),
        method,
        amount,
        reference: method === "bank" ? reference : "",
        confirmed,
      },
    };
    try {
      // Persist before sending. If storage fails, do not collect or submit the payment.
      sessionStorage.setItem(key, JSON.stringify(attempt));
      setPending(attempt);
      const row = await api("/" + attempt.orderId, attempt.body);
      sessionStorage.removeItem(key);
      setPending(null);
      setSelected(row);
      setAmount((row.balanceCents / 100).toFixed(2));
      setReference("");
      setConfirmed(false);
      try {
        setList(await api());
        await loadAllData();
      } catch {
        setError(
          "Payment saved. Refresh the bill list before your next action.",
        );
      }
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="btn btn-secondary"
        style={{ margin: 12 }}
        onClick={() => open()}
      >
        Open bills / cash & bank
      </button>
      {pending && (
        <span role="status">Unconfirmed payment: open bills to recover.</span>
      )}
      <dialog
        ref={dialog}
        className="service-dialog"
        aria-label="Cash and bank payments"
      >
        <header>
          <h2>Cash & bank payments</h2>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => dialog.current.close()}
          >
            Close
          </button>
        </header>
        <p>
          Each received amount is saved immediately. Only record money actually
          received; a transfer screenshot is not bank confirmation.
        </p>
        {error && (
          <p role="alert" className="service-alert">
            {error}
          </p>
        )}
        {pending && (
          <section className="service-panel">
            <h3>Unconfirmed payment</h3>
            <p>
              The response was not confirmed. Retry the saved request before
              recording another payment.
            </p>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => submit(pending)}
            >
              Recover saved payment
            </button>
          </section>
        )}
        <label>
          Saved bill
          <select
            aria-label="Saved bill"
            disabled={busy || !!pending}
            value={selected?.order.id || ""}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Choose a bill</option>
            {list.map((row) => (
              <option key={row.order.id} value={row.order.id}>
                #{row.order.id.slice(-6)} ·{" "}
                {row.balanceCents
                  ? money(row.balanceCents) + " remaining"
                  : "Paid"}{" "}
                · {row.order.customerName || row.order.diningType}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <section>
            <h3>Bill #{selected.order.id.slice(-6)}</h3>
            <div className="service-balance">
              <span>
                Total<strong>{money(selected.totalCents)}</strong>
              </span>
              <span>
                Remaining<strong>{money(selected.balanceCents)}</strong>
              </span>
              <span>
                {selected.order.invoiceNumber
                  ? "Invoice " + selected.order.invoiceNumber
                  : "Open bill — no final invoice yet"}
              </span>
            </div>
            <ul>
              {selected.order.items.map((item, i) => (
                <li key={i}>
                  {item.quantity} × {item.name}
                </li>
              ))}
            </ul>
            {selected.balanceCents > 0 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <fieldset
                  disabled={busy || !!pending}
                  style={{ border: 0, padding: 0 }}
                >
                  <label>
                    Received amount
                    <input
                      aria-label="Received amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={selected.balanceCents / 100}
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <div className="service-actions">
                    {[2, 3, 4].map((n) => (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        key={n}
                        onClick={() =>
                          setAmount(
                            (
                              Math.ceil(selected.balanceCents / n) / 100
                            ).toFixed(2),
                          )
                        }
                      >
                        1 of {n} remaining portions
                      </button>
                    ))}
                  </div>
                  <label>
                    Payment method
                    <select
                      aria-label="Payment method"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option value="cash">Cash received</option>
                      {["owner", "manager"].includes(currentUser?.role) && (
                        <option value="bank">
                          Bank transfer — manager verified
                        </option>
                      )}
                    </select>
                  </label>
                  {method === "bank" && (
                    <>
                      <label>
                        Bank transaction reference
                        <input
                          required
                          minLength={3}
                          maxLength={120}
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </label>
                      <label className="service-check">
                        <input
                          type="checkbox"
                          required
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I checked the restaurant bank account and confirmed this
                        amount arrived.
                      </label>
                    </>
                  )}
                  <button className="btn btn-primary" type="submit">
                    {busy ? "Saving…" : "Record received payment"}
                  </button>
                </fieldset>
              </form>
            )}
            {selected.order.paymentStatus === "paid" && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  dialog.current.close();
                  onReceipt?.(selected.order);
                }}
              >
                View / print final receipt
              </button>
            )}
            <h3>Saved payment history</h3>
            {selected.payments.length ? (
              selected.payments.map((p) => (
                <div className="service-history" key={p.id}>
                  <strong>
                    {money(p.amountCents)} · {p.method}
                  </strong>
                  <p>
                    {new Date(p.createdAt).toLocaleString()} ·{" "}
                    {p.reference || "Cash drawer"} · {p.actorId}
                  </p>
                  <small>Receipt {p.id}</small>
                </div>
              ))
            ) : (
              <p>
                {selected.order.paymentStatus === "paid"
                  ? "Settled through the original checkout. See its final receipt."
                  : "No amounts received yet."}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => choose(selected.order.id)}
              disabled={busy}
            >
              Refresh this bill
            </button>
          </section>
        )}
      </dialog>
    </>
  );
}

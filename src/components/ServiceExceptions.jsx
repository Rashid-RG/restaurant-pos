import React, { useEffect, useRef, useState } from "react";
import { usePOS } from "../context/POSContext";
export default function ServiceExceptions({ ticket, onClosed, onSaved }) {
  const { orders, menuItems, currentUser } = usePOS(),
    dialog = useRef(null),
    lock = useRef(false),
    key =
      "gastroflow:service-change:" +
      currentUser?.tenant_id +
      ":" +
      currentUser?.id;
  const [action, setAction] = useState("replace"),
    [lines, setLines] = useState([]),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    });
  useEffect(() => {
    if (ticket) {
      setAction("replace");
      setLines(
        (orders.find((o) => o.id === ticket.orderId)?.items || []).map((i) => ({
          id: i.menuItemId || i.id,
          quantity: i.quantity,
          notes: i.notes || "",
          selectedModifiers: i.selectedModifiers || [],
        })),
      );
      setReason("");
      setConfirmed(false);
      setError("");
      dialog.current.showModal();
    }
  }, [ticket]);
  const close = () => {
    if (busy) return;
    dialog.current.close();
    onClosed?.();
  };
  async function submit(saved) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const attempt = saved || {
      orderId: ticket.orderId,
      body: {
        requestId: crypto.randomUUID(),
        revision: ticket.revision,
        action,
        reason,
        discardPreparedBatch: confirmed,
        items: action === "replace" ? lines : undefined,
      },
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(attempt));
      setPending(attempt);
      const response = await fetch(
          "/api/service-exceptions/" + attempt.orderId,
          {
            method: "POST",
            headers: {
              Authorization:
                "Bearer " + localStorage.getItem("gastroflow_token"),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(attempt.body),
          },
        ),
        data = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(data.error || "Change failed"), {
          status: response.status,
        });
      sessionStorage.removeItem(key);
      setPending(null);
      dialog.current.close();
      onClosed?.();
      await onSaved?.();
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
      {pending && (
        <section className="service-panel">
          <strong>Unconfirmed manager change</strong>
          <p>Recover the saved change before submitting another amendment.</p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              dialog.current.showModal();
              submit(pending);
            }}
          >
            Recover manager change
          </button>
        </section>
      )}
      <dialog
        ref={dialog}
        className="service-dialog"
        aria-label="Manager kitchen amendment"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else onClosed?.();
        }}
      >
        <header>
          <h2>Manager kitchen amendment</h2>
          <button className="btn btn-secondary" disabled={busy} onClick={close}>
            Close
          </button>
        </header>
        <p>
          Return any payments before changing an unpaid bill. For a settled
          bill, refund it and cancel this ticket; place a new order separately.
        </p>
        {error && (
          <p role="alert" className="service-alert">
            {error}
          </p>
        )}
        {pending && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => submit(pending)}
          >
            Retry saved manager change
          </button>
        )}
        {ticket && (
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
                Manager action
                <select
                  aria-label="Manager action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="replace">
                    Replace the entire unpaid ticket
                  </option>
                  <option value="cancel">Cancel this kitchen ticket</option>
                </select>
              </label>
              {ticket.state !== "pending" && (
                <div className="service-alert">
                  <strong>Preparation has started.</strong>
                  <p>
                    This replaces or cancels the whole previous batch. Prepared
                    ingredients remain consumed; replacement food reserves fresh
                    stock. Do not use this for a small change to food you intend
                    to keep.
                  </p>
                  <label className="service-check">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I coordinated with the kitchen and confirm the previous
                    prepared batch is discarded.
                  </label>
                </div>
              )}
              {action === "replace" && (
                <section>
                  <h3>Replacement items</h3>
                  {lines.map((line, index) => (
                    <div className="service-panel" key={index}>
                      <label>
                        Menu item
                        <select
                          aria-label={"Replacement item " + (index + 1)}
                          value={line.id}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((l, i) =>
                                i === index
                                  ? {
                                      ...l,
                                      id: e.target.value,
                                      selectedModifiers: [],
                                    }
                                  : l,
                              ),
                            )
                          }
                        >
                          {menuItems.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Quantity
                        <input
                          aria-label={"Replacement quantity " + (index + 1)}
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          required
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((l, i) =>
                                i === index
                                  ? { ...l, quantity: Number(e.target.value) }
                                  : l,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Preparation notes
                        <input
                          maxLength={500}
                          value={line.notes}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((l, i) =>
                                i === index
                                  ? { ...l, notes: e.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                      </label>
                      {!!line.selectedModifiers?.length && (
                        <p>
                          Retained modifiers:{" "}
                          {line.selectedModifiers
                            .map((m) => m.name || m.id)
                            .join(", ")}
                        </p>
                      )}
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setLines((old) => old.filter((_, i) => i !== index))
                        }
                      >
                        Remove replacement line
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={!menuItems.length || lines.length >= 100}
                    onClick={() =>
                      setLines((old) => [
                        ...old,
                        {
                          id: menuItems[0].id,
                          quantity: 1,
                          notes: "",
                          selectedModifiers: [],
                        },
                      ])
                    }
                  >
                    Add replacement line
                  </button>
                </section>
              )}
              <label>
                Amendment reason
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>
                The server recalculates the bill at current menu prices. Review
                the saved total before collecting payment.
              </p>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={action === "replace" && !lines.length}
              >
                Confirm manager change
              </button>
            </fieldset>
          </form>
        )}
      </dialog>
    </>
  );
}

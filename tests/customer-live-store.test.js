import { it, expect, vi } from "vitest";
import { apiUrl } from "../apps/customer-web/src/utils/api.js";
import { startStoreUpdates } from "../apps/customer-web/src/utils/live-store.js";
it("uses the HTTPS app origin in production, never localhost", () => {
  expect(
    apiUrl("/api/stream/store", {
      origin: "https://gastroflow-staging.onrender.com",
      protocol: "https:",
      hostname: "gastroflow-staging.onrender.com",
      port: "",
    }),
  ).toBe("https://gastroflow-staging.onrender.com/api/stream/store");
});
it("retains explicit development port routing", () => {
  expect(
    apiUrl("/api/stream/store", {
      origin: "http://localhost:3001",
      protocol: "http:",
      hostname: "localhost",
      port: "3001",
    }),
  ).toBe("http://localhost:5000/api/stream/store");
});
it("survives Safari SecurityError and polls with cleanup", async () => {
  let tick;
  const refresh = vi.fn(),
    state = vi.fn(),
    clear = vi.fn();
  const stream = startStoreUpdates({
    url: "https://example.test/api/stream/store",
    EventSourceImpl: class {
      constructor() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }
    },
    onMessage: vi.fn(),
    onRefresh: refresh,
    onConnection: state,
    setIntervalImpl: (fn) => {
      tick = fn;
      return 5;
    },
    clearIntervalImpl: clear,
  });
  expect(state).toHaveBeenCalledWith("polling");
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  stream.close();
  expect(clear).toHaveBeenCalledWith(5);
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("falls back on disconnect without overlapping refreshes and recovers live status", async () => {
  let source, tick, finish;
  const refresh = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    state = vi.fn(),
    message = vi.fn();
  const stream = startStoreUpdates({
    url: "https://example.test/api/stream/store",
    EventSourceImpl: class {
      constructor() {
        source = this;
      }
      close() {
        this.closed = true;
      }
    },
    onMessage: message,
    onRefresh: refresh,
    onConnection: state,
    setIntervalImpl: (fn) => {
      tick = fn;
      return 1;
    },
    clearIntervalImpl: vi.fn(),
  });
  source.onopen();
  expect(state).toHaveBeenCalledWith("live");
  source.onmessage({ data: "hello" });
  expect(message).toHaveBeenCalledTimes(1);
  source.onerror();
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  source.onopen();
  stream.close();
  expect(source.closed).toBe(true);
});
it("handles a failed polling request without an unhandled rejection", async () => {
  let tick;
  const state = vi.fn();
  const stream = startStoreUpdates({
    url: "https://example.test",
    EventSourceImpl: null,
    onMessage: vi.fn(),
    onRefresh: () => Promise.reject(new Error("offline")),
    onConnection: state,
    setIntervalImpl: (fn) => {
      tick = fn;
    },
    clearIntervalImpl: vi.fn(),
  });
  await tick();
  expect(state).toHaveBeenCalledWith("offline");
  stream.close();
});

it('clears an offline warning when fallback refresh recovers',async()=>{let tick;let failed=true;const state=vi.fn();const stream=startStoreUpdates({url:'https://example.test',EventSourceImpl:null,onMessage:vi.fn(),onRefresh:async()=>{if(failed)throw new Error('offline')},onConnection:state,setIntervalImpl:fn=>{tick=fn},clearIntervalImpl:vi.fn()});await tick();expect(state).toHaveBeenLastCalledWith('offline');failed=false;await tick();expect(state).toHaveBeenLastCalledWith('polling');stream.close();});

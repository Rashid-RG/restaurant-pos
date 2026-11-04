import { AsyncLocalStorage } from 'node:async_hooks';

// A shared SQLite connection must not interleave transactions from HTTP requests.
// Other requests' reads and writes wait until the owning transaction finishes.
export function createDatabaseGate() {
  const context = new AsyncLocalStorage();
  let owner = null;
  let running = false;
  const queue = [];

  function drain() {
    if (running) return;
    const index = queue.findIndex(task => !owner || task.context === owner);
    if (index < 0) return;
    const task = queue.splice(index, 1)[0];
    running = true;
    Promise.resolve().then(async () => {
      const begin = /^\s*BEGIN\b/i.test(task.sql);
      const end = /^\s*(COMMIT|ROLLBACK)\b/i.test(task.sql);
      if (begin && owner === task.context) throw new Error('Nested database transaction is not supported.');
      if (begin && !task.context) throw new Error('A transaction requires a database context.');
      let result;
      try { result = await task.operation(); }
      catch (error) {
        if (/^\s*ROLLBACK\b/i.test(task.sql)) owner = null;
        throw error;
      }
      if (begin) owner = task.context;
      if (end) owner = null;
      return result;
    }).then(task.resolve, task.reject).finally(() => { running = false; drain(); });
  }

  return {
    context,
    run(sql, operation) {
      const current = context.getStore();
      return new Promise((resolve, reject) => {
        queue.push({ sql, operation, context: current, resolve, reject });
        drain();
      });
    },
    withContext(operation) { return context.run({}, operation); },
    async rollbackCurrent(operation) {
      if (owner && owner === context.getStore()) return this.run('ROLLBACK', operation);
    }
  };
}

import { createClient } from '@libsql/client';

// Keep SQLite SQL compatibility while storing data outside Render's ephemeral disk.
// Calls are serialized by database-gate.js. A transaction keeps one remote session
// until COMMIT/ROLLBACK, so invoices, stock and settlement remain atomic.
export function createLibsqlStore({ url, authToken }) {
  const client = createClient({ url, authToken, intMode: 'number' });
  let transaction = null;
  return {
    async execute(sql, args = []) {
      if (/^\s*BEGIN\b/i.test(sql)) {
        if (transaction) throw new Error('Nested libSQL transaction.');
        transaction = await client.transaction('write');
        return { changes: 0 };
      }
      if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)) {
        if (!transaction) throw new Error('No libSQL transaction.');
        const current = transaction;
        try {
          if (/^\s*COMMIT/i.test(sql)) await current.commit();
          else await current.rollback();
        } finally { current.close(); transaction = null; }
        return { changes: 0 };
      }
      const result = await (transaction || client).execute({ sql, args: args.map(value => value === undefined ? null : value) });
      return { rows: result.rows.map(row => ({ ...row })), changes: result.rowsAffected, lastID: Number(result.lastInsertRowid || 0) };
    },
    close() { transaction?.close(); client.close(); }
  };
}

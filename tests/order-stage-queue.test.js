import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initOrderStatusEmail, deliverPendingStageEmails } from '../lib/order-status-email.js';

it('captures committed stages, retries in order and excludes other orders', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE orders(id TEXT, tenant_id TEXT, status TEXT, source TEXT, customerEmail TEXT, orderType TEXT, diningType TEXT, total REAL);
      CREATE TABLE tenants(id TEXT,name TEXT);
      CREATE TABLE settings(tenant_id TEXT,key TEXT,value TEXT);
      INSERT INTO tenants VALUES ('a','Kitchen A');
      INSERT INTO orders VALUES ('1','a','pending','online','qa@example.test','takeaway','takeaway',500);
      INSERT INTO orders VALUES ('2','b','pending','pos','qa@example.test','takeaway','takeaway',500);`);
    const dbRun = (sql,params=[]) => db.prepare(sql).run(...params);
    const dbAll = (sql,params=[]) => db.prepare(sql).all(...params);
    const dbGet = (sql,params=[]) => db.prepare(sql).get(...params);
    await initOrderStatusEmail(dbRun);
    db.exec("BEGIN; UPDATE orders SET status='cancelled'; ROLLBACK; UPDATE orders SET status='preparing'; UPDATE orders SET status='ready'");
    const delivered=[];
    let available=false;
    const sweep = () => deliverPendingStageEmails({dbRun,dbAll,dbGet,customerAppUrl:'https://example.test',
      deliver:async message => {if (available) delivered.push(message.subject); return {success:available};}});
    await sweep();
    await sweep();
    expect(delivered).toEqual([]);
    expect(dbAll('SELECT status FROM order_stage_email_queue ORDER BY id').map(row=>row.status)).toEqual(['preparing','ready']);
    db.exec('UPDATE order_stage_email_queue SET availableAt=0');
    available=true;
    await sweep(); await sweep(); await sweep();
    expect(delivered).toEqual(['Kitchen A · Preparing your food · Order #1','Kitchen A · Ready for pickup · Order #1']);
  } finally { db.close(); }
});

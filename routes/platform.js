import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { planList } from '../lib/plans.js';

const plans = planList().map(plan => plan.id);
const provisionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
  plan: z.enum(plans).default('basic'),
  ownerUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,64}$/).optional(),
  ownerPassword: z.string().min(12).max(128).optional(),
  ownerPin: z.string().regex(/^\d{6}$/).optional(),
}).strict();
const updateSchema = z.object({
  plan: z.enum(plans).optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Choose a plan or status.');

export function createPlatformRouter({ authenticateToken, requirePlatformAdmin, dbGet, dbAll, dbRun, writeAuditLog, notifyPOS, notifyPublicStore }) {
  const router = express.Router();
  router.use('/saas/tenants', authenticateToken, requirePlatformAdmin);
  router.get('/saas/tenants', async (req, res, next) => {
    try {
      const rows = await dbAll(`SELECT t.id,t.name,t.subdomain,t.ownerEmail,t.plan,t.status,t.createdAt,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) AS staffCount,
        (SELECT COUNT(*) FROM orders o WHERE o.tenant_id=t.id) AS orderCount
        FROM tenants t ORDER BY t.createdAt DESC,t.id`);
      res.set('Cache-Control', 'no-store').json(rows.map(row => ({ ...row,
        posUrl: `/?tenant=${encodeURIComponent(row.id)}`,
        customerUrl: `/customer/?tenant=${encodeURIComponent(row.id)}`,
        driverUrl: `/driver-app/?tenant=${encodeURIComponent(row.id)}`,
      })));
    } catch (error) { next(error); }
  });
  router.post('/saas/tenants', async (req, res, next) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check restaurant details.', details: parsed.error.issues });
    const { name, subdomain, ownerEmail, plan, ownerUsername, ownerPassword, ownerPin } = parsed.data;
    if (['main', 'default', 'default-tenant', 'admin', 'platform'].includes(subdomain)) return res.status(409).json({ error: 'This restaurant address is reserved.' });
    const username = ownerUsername || `${subdomain}_owner`;
    const password = ownerPassword || crypto.randomBytes(24).toString('base64url');
    const pin = ownerPin || String(crypto.randomInt(100000, 1000000));
    const passwordHash = await bcrypt.hash(password, 12);
    const pinHash = await bcrypt.hash(pin, 12);
    const id = `tenant_${crypto.randomUUID()}`;
    let transactionOpen = false;
    try {
      await dbRun('BEGIN TRANSACTION'); transactionOpen = true;
      if (await dbGet('SELECT id FROM tenants WHERE subdomain = ?', [subdomain]) || await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username])) {
        await dbRun('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: 'That restaurant address or owner username is already in use.' });
      }
      await dbRun('INSERT INTO tenants (id,name,subdomain,ownerEmail,plan,status,createdAt) VALUES (?,?,?,?,?,?,?)', [id,name,subdomain,ownerEmail,plan,'active',Date.now()]);
      await dbRun('INSERT INTO users (id,username,passwordHash,role,pin,email,tenant_id) VALUES (?,?,?,?,?,?,?)', [`user_${crypto.randomUUID()}`,username,passwordHash,'owner',pinHash,ownerEmail,id]);
      for (const [key,value] of Object.entries({ businessName:name,restaurantName:name,currencySymbol:'Rs.',taxRate:'0',serviceChargeRate:'0',storeOpen:'false' })) {
        await dbRun('INSERT INTO settings (tenant_id,key,value) VALUES (?,?,?)', [id,key,value]);
      }
      await writeAuditLog(req.user.id,req.user.username,'provision_tenant',`Created restaurant ${id} with owner ${username}`);
      await dbRun('COMMIT'); transactionOpen = false;
      res.set('Cache-Control','no-store').status(201).json({ tenant: {
        id,name,subdomain,ownerEmail,plan,status:'active',staffUsername:username,
        temporaryPassword:password,temporaryPin:pin,
        posUrl:`/?tenant=${encodeURIComponent(id)}`,customerUrl:`/customer/?tenant=${encodeURIComponent(id)}`,driverUrl:`/driver-app/?tenant=${encodeURIComponent(id)}`,
      } });
    } catch (error) {
      if (transactionOpen) await dbRun('ROLLBACK');
      next(error);
    }
  });
  const update = async (req, res, next) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid plan or restaurant status.' });
    if (req.params.id === 'default_tenant' && parsed.data.status) return res.status(400).json({ error: 'The platform workspace cannot be changed here.' });
    let transactionOpen = false;
    try {
      await dbRun('BEGIN TRANSACTION'); transactionOpen = true;
      const tenant = await dbGet('SELECT id,name FROM tenants WHERE id = ?', [req.params.id]);
      if (!tenant) { await dbRun('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Restaurant not found.' }); }
      for (const [key,value] of Object.entries(parsed.data)) await dbRun(`UPDATE tenants SET ${key} = ? WHERE id = ?`, [value,tenant.id]);
      await writeAuditLog(req.user.id,req.user.username,'update_tenant',`Restaurant ${tenant.id}: ${JSON.stringify(parsed.data)}`);
      await dbRun('COMMIT'); transactionOpen = false;
      if (parsed.data.status) {
        const event = {type:'tenant_status_changed',status:parsed.data.status,tenantId:tenant.id,storeName:tenant.name};
        notifyPOS(event,tenant.id); notifyPublicStore(event,tenant.id);
      }
      const updated = await dbGet('SELECT id,name,subdomain,plan,status FROM tenants WHERE id = ?', [tenant.id]);
      res.json({ ...updated,success:true,message:'Restaurant updated.' });
    } catch (error) { if (transactionOpen) await dbRun('ROLLBACK'); next(error); }
  };
  router.patch('/saas/tenants/:id', update);
  router.patch('/saas/tenants/:id/status', update);
  // Suspending preserves invoices, evidence and customer records.
  router.delete('/saas/tenants/:id', (req,res) => res.status(409).json({ error:'Suspend this restaurant instead. Permanent removal requires a verified retention and backup workflow.' }));
  return router;
}

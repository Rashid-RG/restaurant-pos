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

  // Auto-initialize persistent credentials vault table
  dbRun(`CREATE TABLE IF NOT EXISTS tenant_credentials_vault (
    tenant_id TEXT PRIMARY KEY,
    restaurant_name TEXT NOT NULL,
    subdomain TEXT NOT NULL,
    owner_username TEXT NOT NULL,
    temporary_password TEXT,
    temporary_pin TEXT,
    last_reset_at BIGINT NOT NULL,
    updated_by TEXT
  )`).catch(() => {});

  // GET /saas/tenants/credentials — Full restaurant credentials list for platform owner
  router.get('/saas/tenants/credentials', async (req, res, next) => {
    try {
      const rows = await dbAll(`
        SELECT 
          t.id, t.name, t.subdomain, t.ownerEmail, t.plan, t.status, t.createdAt,
          u.id AS ownerUserId, u.username AS ownerUsername,
          v.temporary_password AS savedPassword,
          v.temporary_pin AS savedPin,
          v.last_reset_at AS lastResetAt,
          v.updated_by AS lastUpdatedBy
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
        LEFT JOIN tenant_credentials_vault v ON v.tenant_id = t.id
        WHERE t.id != 'default_tenant'
        ORDER BY t.createdAt DESC
      `);

      res.set('Cache-Control', 'no-store').json(rows.map(row => ({
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        ownerEmail: row.ownerEmail,
        plan: row.plan,
        status: row.status,
        createdAt: row.createdAt,
        ownerUsername: row.ownerUsername || `${row.subdomain}_owner`,
        password: row.savedPassword || '••••••••',
        hasSavedPassword: !!row.savedPassword,
        pin: row.savedPin || '••••',
        lastResetAt: row.lastResetAt || row.createdAt,
        lastUpdatedBy: row.lastUpdatedBy || 'System',
        posUrl: `/?tenant=${encodeURIComponent(row.id)}`,
        customerUrl: `/customer/?tenant=${encodeURIComponent(row.id)}`,
        driverUrl: `/driver-app/?tenant=${encodeURIComponent(row.id)}`
      })));
    } catch (error) { next(error); }
  });

  // POST /saas/tenants/:id/reset-password — Reset owner password & PIN for any restaurant
  router.post('/saas/tenants/:id/reset-password', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { customPassword, customPin } = req.body || {};
      const tenant = await dbGet('SELECT id, name, subdomain, ownerEmail FROM tenants WHERE id = ?', [id]);
      if (!tenant) return res.status(404).json({ error: 'Restaurant not found.' });

      let ownerUser = await dbGet('SELECT id, username FROM users WHERE tenant_id = ? AND role = ?', [id, 'owner']);
      const username = ownerUser ? ownerUser.username : `${tenant.subdomain}_owner`;

      const newPassword = (customPassword && customPassword.trim().length >= 8)
        ? customPassword.trim()
        : crypto.randomBytes(10).toString('base64url');
      const newPin = (customPin && /^\d{4,6}$/.test(customPin.trim()))
        ? customPin.trim()
        : String(crypto.randomInt(100000, 999999));

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const pinHash = await bcrypt.hash(newPin, 12);

      let transactionOpen = false;
      try {
        await dbRun('BEGIN TRANSACTION'); transactionOpen = true;

        if (ownerUser) {
          await dbRun('UPDATE users SET passwordHash = ?, pin = ? WHERE id = ?', [passwordHash, pinHash, ownerUser.id]);
        } else {
          const newUserId = `user_${crypto.randomUUID()}`;
          await dbRun('INSERT INTO users (id, username, passwordHash, role, pin, email, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newUserId, username, passwordHash, 'owner', pinHash, tenant.ownerEmail, id]);
        }

        await dbRun(`INSERT OR REPLACE INTO tenant_credentials_vault 
          (tenant_id, restaurant_name, subdomain, owner_username, temporary_password, temporary_pin, last_reset_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tenant.name, tenant.subdomain, username, newPassword, newPin, Date.now(), req.user?.username || 'platform_owner']);

        await writeAuditLog(req.user.id, req.user.username, 'reset_restaurant_password', `Reset owner credentials for ${tenant.name} (${id})`);

        await dbRun('COMMIT'); transactionOpen = false;

        res.json({
          success: true,
          message: `Credentials for "${tenant.name}" have been updated successfully.`,
          credentials: {
            tenantId: id,
            restaurantName: tenant.name,
            username,
            password: newPassword,
            pin: newPin,
            posUrl: `/?tenant=${encodeURIComponent(id)}`,
            updatedAt: Date.now()
          }
        });
      } catch (err) {
        if (transactionOpen) await dbRun('ROLLBACK');
        throw err;
      }
    } catch (error) { next(error); }
  });

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
      await dbRun(`INSERT OR REPLACE INTO tenant_credentials_vault 
        (tenant_id, restaurant_name, subdomain, owner_username, temporary_password, temporary_pin, last_reset_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, subdomain, username, password, pin, Date.now(), req.user?.username || 'platform_owner']);
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

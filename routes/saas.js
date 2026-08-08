/**
 * routes/saas.js — SaaS multi-tenancy & plan limits management (Phase 5).
 * Enables platform admins to view tenants, change plans, check resource limits,
 * and track plan usage metering.
 */
import express from 'express';
import { PLANS, checkLimit, planList } from '../lib/plans.js';

export function createSaasRouter({ dbGet, dbRun, dbAll, requirePlatformAdmin, authenticateToken }) {
  const router = express.Router();

  // GET /api/saas/plans — Public list of available subscription plans
  router.get('/saas/plans', (req, res) => {
    res.json({ plans: planList() });
  });

  // GET /api/saas/usage — Returns resource usage & plan limits for current tenant
  router.get('/saas/usage', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 'default_tenant';
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', [tenantId]) || { plan: 'basic' };
      
      const userCountObj = await dbGet('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?', [tenantId]);
      const orderCountObj = await dbGet('SELECT COUNT(*) as count FROM orders WHERE tenant_id = ?', [tenantId]);

      const usersUsage = checkLimit(tenant.plan, 'users', userCountObj?.count || 0);
      const ordersUsage = checkLimit(tenant.plan, 'orders', orderCountObj?.count || 0);

      res.json({
        tenantId,
        plan: tenant.plan,
        usage: {
          users: usersUsage,
          orders: ordersUsage
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

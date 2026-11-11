import express from 'express';
import crypto from 'node:crypto';
import { dateAtRestaurant, restaurantDayBounds, restaurantTimeZone } from '../src/utils/restaurant-time.js';

export const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'cat_meat_chicken', name: 'Meat, Chicken & Poultry', icon: '🍗', color: '#ef4444' },
  { id: 'cat_vegetables', name: 'Vegetables & Fresh Produce', icon: '🥕', color: '#10b981' },
  { id: 'cat_ingredients', name: 'Ingredients & Groceries', icon: '🥬', color: '#059669' },
  { id: 'cat_seafood', name: 'Fish & Seafood', icon: '🐟', color: '#06b6d4' },
  { id: 'cat_dairy', name: 'Dairy, Milk & Eggs', icon: '🧀', color: '#f59e0b' },
  { id: 'cat_beverages', name: 'Beverages & Syrups', icon: '🥤', color: '#3b82f6' },
  { id: 'cat_gas_fuel', name: 'Gas Cylinders & Kitchen Fuel', icon: '🔥', color: '#f97316' },
  { id: 'cat_utilities', name: 'Utilities (Electricity & Water)', icon: '⚡', color: '#eab308' },
  { id: 'cat_wages', name: 'Staff Daily Wages & Pay', icon: '👨‍🍳', color: '#6366f1' },
  { id: 'cat_packaging', name: 'Packaging, Boxes & Bags', icon: '📦', color: '#8b5cf6' },
  { id: 'cat_repairs', name: 'Repairs & Maintenance', icon: '🛠️', color: '#ec4899' },
  { id: 'cat_cleaning', name: 'Cleaning & Sanitation Supplies', icon: '🧹', color: '#14b8a6' },
  { id: 'cat_rent', name: 'Rent & Space Lease', icon: '🏠', color: '#a855f7' },
  { id: 'cat_transport', name: 'Transport & Logistics', icon: '🛵', color: '#0284c7' },
  { id: 'cat_marketing', name: 'Marketing & Promo', icon: '📣', color: '#d97706' },
  { id: 'cat_other', name: 'Other / Miscellaneous', icon: '📝', color: '#64748b' }
];

export async function initExpensesTable(dbRun) {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS daily_expenses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      vendor TEXT,
      receiptNumber TEXT,
      createdBy TEXT,
      createdAt BIGINT NOT NULL
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_daily_expenses_tenant_date ON daily_expenses(tenant_id, date)`);

  try {
    await dbRun(`ALTER TABLE daily_expenses ADD COLUMN vendor TEXT`);
  } catch (_) {}
  try {
    await dbRun(`ALTER TABLE daily_expenses ADD COLUMN receiptNumber TEXT`);
  } catch (_) {}

  await dbRun(`
    CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📦',
      color TEXT DEFAULT '#10b981',
      isDefault INTEGER DEFAULT 0,
      createdAt BIGINT NOT NULL
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant ON expense_categories(tenant_id)`);
}

export function createExpensesRouter({ dbGet, dbAll, dbRun, authenticateToken, requireRole, broadcastEvent }) {
  const router = express.Router();
  const tenantTimeZone = async tenantId => {
    const row = await dbGet('SELECT value FROM settings WHERE tenant_id = ? AND key = ?', [tenantId, 'timeZone']);
    return restaurantTimeZone({ timeZone: row?.value });
  };


  // All expense endpoints require authenticated staff
  router.use('/expenses', authenticateToken);

  // Helper to ensure default categories are seeded for tenant
  const ensureDefaultCategories = async (tenantId) => {
    const existing = await dbGet('SELECT COUNT(*) as count FROM expense_categories WHERE tenant_id = ?', [tenantId]);
    if (!existing || existing.count === 0) {
      const now = Date.now();
      for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
        await dbRun(
          `INSERT OR IGNORE INTO expense_categories (id, tenant_id, name, icon, color, isDefault, createdAt)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [cat.id, tenantId, cat.name, cat.icon, cat.color, now]
        );
      }
    }
  };

  // GET /api/expenses/categories — List categories for tenant
  router.get('/expenses/categories', async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      await ensureDefaultCategories(tenantId);
      const rows = await dbAll(
        'SELECT * FROM expense_categories WHERE tenant_id = ? ORDER BY isDefault DESC, name ASC',
        [tenantId]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/expenses/categories — Add custom category
  router.post('/expenses/categories', requireRole(['owner', 'manager']), async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const { name, icon, color } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Category name is required.' });
      }

      const cleanName = name.trim();
      const existing = await dbGet(
        'SELECT id FROM expense_categories WHERE tenant_id = ? AND LOWER(name) = LOWER(?)',
        [tenantId, cleanName]
      );
      if (existing) {
        return res.status(409).json({ error: 'A category with this name already exists.' });
      }

      const id = `cat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const cleanIcon = icon && typeof icon === 'string' && icon.trim() ? icon.trim() : '📦';
      const cleanColor = color && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim()) ? color.trim() : '#10b981';
      const now = Date.now();

      await dbRun(
        `INSERT INTO expense_categories (id, tenant_id, name, icon, color, isDefault, createdAt)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [id, tenantId, cleanName, cleanIcon, cleanColor, now]
      );

      const created = {
        id,
        tenant_id: tenantId,
        name: cleanName,
        icon: cleanIcon,
        color: cleanColor,
        isDefault: 0,
        createdAt: now
      };

      res.status(201).json({
        success: true,
        message: `Category "${cleanName}" created successfully.`,
        category: created
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/expenses/categories/:id — Delete custom category
  router.delete('/expenses/categories/:id', requireRole(['owner', 'manager']), async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const { id } = req.params;

      const category = await dbGet('SELECT * FROM expense_categories WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      // Check if expenses are assigned to this category
      const inUse = await dbGet('SELECT COUNT(*) as count FROM daily_expenses WHERE tenant_id = ? AND category = ?', [tenantId, category.name]);
      if (inUse && inUse.count > 0) {
        return res.status(409).json({
          error: `Cannot delete category "${category.name}" because it is used by ${inUse.count} recorded expense(s).`
        });
      }

      await dbRun('DELETE FROM expense_categories WHERE id = ? AND tenant_id = ?', [id, tenantId]);

      res.json({
        success: true,
        message: `Category "${category.name}" removed successfully.`
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/expenses — List daily expenses
  router.get('/expenses', async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const today = dateAtRestaurant(new Date(), await tenantTimeZone(tenantId));
      const { date, month, from, to } = req.query;

      let sql = 'SELECT * FROM daily_expenses WHERE tenant_id = ?';
      const params = [tenantId];

      if (date) {
        sql += ' AND date = ?';
        params.push(date);
      } else if (from && to) {
        sql += ' AND date >= ? AND date <= ?';
        params.push(from, to);
      } else if (month) {
        sql += ' AND date LIKE ?';
        params.push(`${month}%`);
      } else {
        sql += ' AND date = ?';
        params.push(today);
      }

      sql += ' ORDER BY createdAt DESC, id DESC';
      const rows = await dbAll(sql, params);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/expenses/summary — Daily calculation (Sales vs Expenses & Profit/Loss)
  router.get('/expenses/summary', async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const timeZone = await tenantTimeZone(tenantId);
      const targetDate = req.query.date || dateAtRestaurant(new Date(), timeZone);
      const targetMonth = targetDate.slice(0, 7);

      // 1. Total expenses for selected date
      const dayExpenseRow = await dbGet(
        'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM daily_expenses WHERE tenant_id = ? AND date = ?',
        [tenantId, targetDate]
      );
      const totalExpenses = Number(dayExpenseRow?.total || 0);
      const expenseCount = Number(dayExpenseRow?.count || 0);

      // 2. Total sales for selected date (orders with payment confirmed or completed)
      // Query the actual restaurant calendar day, not the UTC calendar day.
      const [dayStart, dayEnd] = restaurantDayBounds(targetDate, timeZone);

      const salesRow = await dbGet(
        `SELECT COALESCE(SUM(total), 0) AS totalSales, COUNT(*) AS orderCount
         FROM orders 
         WHERE tenant_id = ? 
           AND (paymentStatus = 'paid' OR status = 'paid' OR status = 'completed')
           AND timestamp >= ? AND timestamp < ?`,
        [tenantId, dayStart, dayEnd]
      );
      const totalSales = Number(salesRow?.totalSales || 0);
      const orderCount = Number(salesRow?.orderCount || 0);

      // 3. Category breakdown for selected date
      const categories = await dbAll(
        `SELECT category, SUM(amount) AS total, COUNT(*) AS count 
         FROM daily_expenses 
         WHERE tenant_id = ? AND date = ? 
         GROUP BY category 
         ORDER BY total DESC`,
        [tenantId, targetDate]
      );

      // 4. Month-to-date total expenses
      const monthExpenseRow = await dbGet(
        'SELECT COALESCE(SUM(amount), 0) AS monthTotal FROM daily_expenses WHERE tenant_id = ? AND date LIKE ?',
        [tenantId, `${targetMonth}%`]
      );
      const monthTotalExpenses = Number(monthExpenseRow?.monthTotal || 0);

      // 5. Net balance for the day (Sales - Expenses)
      const netDailyBalance = totalSales - totalExpenses;

      res.json({
        date: targetDate,
        month: targetMonth,
        totalExpenses,
        expenseCount,
        totalSales,
        orderCount,
        netDailyBalance,
        monthTotalExpenses,
        categoryBreakdown: categories.map(c => ({
          category: c.category,
          total: Number(c.total || 0),
          count: Number(c.count || 0)
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/expenses — Record a daily expense
  router.post('/expenses', requireRole(['owner', 'manager', 'cashier']), async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const { category, amount, paymentMethod, notes, date, vendor, receiptNumber } = req.body || {};

      const numAmount = parseFloat(amount);
      if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Please provide a valid expense amount greater than 0.' });
      }

      if (!category || typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({ error: 'Please choose or enter an expense category.' });
      }

      const cleanCategory = category.trim();
      const expenseDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateAtRestaurant(new Date(), await tenantTimeZone(tenantId));
      const id = `exp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const method = ['cash', 'bank', 'petty_cash', 'card'].includes(paymentMethod) ? paymentMethod : 'cash';
      const cleanNotes = notes ? String(notes).trim().slice(0, 500) : '';
      const cleanVendor = vendor ? String(vendor).trim().slice(0, 200) : '';
      const cleanReceiptNo = receiptNumber ? String(receiptNumber).trim().slice(0, 100) : '';
      const createdBy = req.user?.username || 'staff';
      const now = Date.now();

      // Auto-register category in expense_categories if it does not exist yet
      try {
        const catExists = await dbGet(
          'SELECT id FROM expense_categories WHERE tenant_id = ? AND LOWER(name) = LOWER(?)',
          [tenantId, cleanCategory]
        );
        if (!catExists) {
          const catId = `cat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await dbRun(
            `INSERT OR IGNORE INTO expense_categories (id, tenant_id, name, icon, color, isDefault, createdAt)
             VALUES (?, ?, ?, '📦', '#10b981', 0, ?)`,
            [catId, tenantId, cleanCategory, now]
          );
        }
      } catch (_) {}

      await dbRun(
        `INSERT INTO daily_expenses (id, tenant_id, date, category, amount, paymentMethod, notes, vendor, receiptNumber, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, expenseDate, cleanCategory, numAmount, method, cleanNotes, cleanVendor, cleanReceiptNo, createdBy, now]
      );

      const created = {
        id,
        tenant_id: tenantId,
        date: expenseDate,
        category: cleanCategory,
        amount: numAmount,
        paymentMethod: method,
        notes: cleanNotes,
        vendor: cleanVendor,
        receiptNumber: cleanReceiptNo,
        createdBy,
        createdAt: now
      };

      if (typeof broadcastEvent === 'function') {
        broadcastEvent('expense_added', created, tenantId);
      }

      res.status(201).json({
        success: true,
        message: `Expense of Rs. ${numAmount.toFixed(2)} recorded for ${expenseDate}.`,
        expense: created
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/expenses/:id — Delete an expense
  router.delete('/expenses/:id', requireRole(['owner', 'manager']), async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const { id } = req.params;

      const existing = await dbGet('SELECT id, amount, category FROM daily_expenses WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (!existing) {
        return res.status(404).json({ error: 'Expense record not found.' });
      }

      await dbRun('DELETE FROM daily_expenses WHERE id = ? AND tenant_id = ?', [id, tenantId]);

      if (typeof broadcastEvent === 'function') {
        broadcastEvent('expense_deleted', { id }, tenantId);
      }

      res.json({
        success: true,
        message: `Deleted expense (${existing.category} - Rs. ${existing.amount}).`
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}


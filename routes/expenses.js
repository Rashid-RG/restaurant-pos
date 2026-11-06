import express from 'express';
import crypto from 'node:crypto';

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
      createdBy TEXT,
      createdAt BIGINT NOT NULL
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_daily_expenses_tenant_date ON daily_expenses(tenant_id, date)`);
}

export function createExpensesRouter({ dbGet, dbAll, dbRun, authenticateToken, requireRole, broadcastEvent }) {
  const router = express.Router();

  // All expense endpoints require authenticated staff
  router.use('/expenses', authenticateToken);

  // GET /api/expenses — List daily expenses
  router.get('/expenses', async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const today = new Date().toISOString().slice(0, 10);
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
      const targetDate = req.query.date || new Date().toISOString().slice(0, 10);
      const targetMonth = targetDate.slice(0, 7);

      // 1. Total expenses for selected date
      const dayExpenseRow = await dbGet(
        'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM daily_expenses WHERE tenant_id = ? AND date = ?',
        [tenantId, targetDate]
      );
      const totalExpenses = Number(dayExpenseRow?.total || 0);
      const expenseCount = Number(dayExpenseRow?.count || 0);

      // 2. Total sales for selected date (orders with payment confirmed or completed)
      // Timestamp range for that date in local ISO time (00:00:00 to 23:59:59.999)
      const dayStart = new Date(`${targetDate}T00:00:00.000Z`).getTime();
      const dayEnd = dayStart + 86400000;

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
      const { category, amount, paymentMethod, notes, date } = req.body || {};

      const numAmount = parseFloat(amount);
      if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Please provide a valid expense amount greater than 0.' });
      }

      if (!category || typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({ error: 'Please choose or enter an expense category.' });
      }

      const expenseDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
      const id = `exp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const method = ['cash', 'bank', 'petty_cash', 'card'].includes(paymentMethod) ? paymentMethod : 'cash';
      const cleanNotes = notes ? String(notes).trim().slice(0, 500) : '';
      const createdBy = req.user?.username || 'staff';
      const now = Date.now();

      await dbRun(
        `INSERT INTO daily_expenses (id, tenant_id, date, category, amount, paymentMethod, notes, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, expenseDate, category.trim(), numAmount, method, cleanNotes, createdBy, now]
      );

      const created = {
        id,
        tenant_id: tenantId,
        date: expenseDate,
        category: category.trim(),
        amount: numAmount,
        paymentMethod: method,
        notes: cleanNotes,
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


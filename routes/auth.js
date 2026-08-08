/**
 * routes/auth.js — Authentication domain routes.
 * Handles staff JWT login, PIN verification, OTPs, customer auth, and driver auth.
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function createAuthRouter({ dbGet, dbRun, dbAll, JWT_SECRET, publicApiLimiter, authenticateToken }) {
  const router = express.Router();

  // POST /api/auth/login — Staff POS Login
  router.post('/auth/login', publicApiLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

      const user = await dbGet('SELECT * FROM users WHERE username = ?', [username.trim()]);
      if (!user) return res.status(401).json({ error: 'Invalid username or password' });

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) return res.status(401).json({ error: 'Invalid username or password' });

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id || 'default_tenant' },
        JWT_SECRET,
        { expiresIn: '12h' }
      );

      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/verify-pin — Manager PIN verification
  router.post('/auth/verify-pin', authenticateToken, async (req, res) => {
    try {
      const { pin } = req.body;
      if (!pin) return res.status(400).json({ error: 'PIN is required' });

      const managers = await dbAll("SELECT * FROM users WHERE role IN ('owner', 'manager')");
      let isValid = false;

      for (const mgr of managers) {
        if (mgr.pin && (mgr.pin.startsWith('$2a$') || mgr.pin.startsWith('$2b$'))) {
          if (await bcrypt.compare(pin, mgr.pin)) { isValid = true; break; }
        } else if (mgr.pin === pin) {
          isValid = true; break;
        }
      }

      if (!isValid) return res.status(401).json({ error: 'Invalid manager PIN' });
      res.json({ success: true, message: 'Manager PIN verified successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

import express from 'express';
import crypto from 'node:crypto';
import { previewPayroll, payrollPeriod } from '../lib/payroll.js';
import { restaurantTimeZone } from '../src/utils/restaurant-time.js';

export async function initStaffPayroll(dbRun) {
  // Additive-only tables. Never alter or delete existing staff, shifts, or sales.
  await dbRun(`CREATE TABLE IF NOT EXISTS staff_compensation (
    tenant_id TEXT NOT NULL,
    userId TEXT NOT NULL,
    payType TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 0,
    allowance REAL NOT NULL DEFAULT 0,
    deduction REAL NOT NULL DEFAULT 0,
    updatedAt BIGINT NOT NULL,
    PRIMARY KEY(tenant_id, userId)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS staff_payroll_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    userId TEXT NOT NULL,
    month TEXT NOT NULL,
    payType TEXT NOT NULL,
    rate REAL NOT NULL,
    hours REAL NOT NULL,
    basicPay REAL NOT NULL,
    allowance REAL NOT NULL,
    deduction REAL NOT NULL,
    totalPay REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    createdBy TEXT NOT NULL,
    createdAt BIGINT NOT NULL,
    paidBy TEXT,
    paidAt BIGINT,
    paymentReference TEXT,
    UNIQUE(tenant_id, userId, month)
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_staff_payroll_tenant_month ON staff_payroll_records(tenant_id, month)');
  await dbRun(`CREATE TABLE IF NOT EXISTS staff_profiles (
    tenant_id TEXT NOT NULL,
    userId TEXT NOT NULL,
    fullName TEXT NOT NULL DEFAULT '',
    jobTitle TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    employmentDate TEXT,
    updatedAt BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, userId)
  )`);
}

export function createStaffPayrollRouter({dbGet, dbAll, dbRun, authenticateToken, requireRole}) {
  const router = express.Router();
  router.use('/staff-management', authenticateToken, requireRole(['owner','manager']));

  const scope = async req => {
    const tenantId = req.tenantId;
    const setting = await dbGet('SELECT value FROM settings WHERE tenant_id=? AND key=?', [tenantId, 'timeZone']);
    return { tenantId, timeZone: restaurantTimeZone({timeZone: setting?.value}) };
  };
  const monthValue = value => {
    if (!/^\d{4}-\d{2}$/.test(String(value || ''))) throw Object.assign(new Error('Invalid month (YYYY-MM).'), {status:400});
    const [year, month] = String(value).split('-').map(Number);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) throw Object.assign(new Error('Invalid month.'), {status:400});
    return String(value);
  };
  const error = (res, err) => res.status(err.status || 500).json({error: err.status ? err.message : 'Unable to complete staff management request.'});

  const loadPreview = async (tenantId, timeZone, month) => {
    const users = await dbAll('SELECT id, username, role FROM users WHERE tenant_id=? ORDER BY username', [tenantId]);
    const compensation = await dbAll('SELECT userId, payType, rate, allowance, deduction FROM staff_compensation WHERE tenant_id=?', [tenantId]);
    const profiles = await dbAll('SELECT userId, fullName, jobTitle, department, phone, employmentDate FROM staff_profiles WHERE tenant_id=?', [tenantId]);
    const {start,end} = payrollPeriod(month,timeZone);
    // Entries remain in the existing attendance table, with tenant isolation via the user join.
    const entries = await dbAll(`SELECT e.userId, e.clockIn, e.clockOut
      FROM timeclock_entries e JOIN users u ON e.userId=u.id
      WHERE u.tenant_id=? AND e.clockIn < ? AND e.clockOut IS NOT NULL AND e.clockOut > ?`, [tenantId,end,start]);
    const profilesByUser = new Map(profiles.map(p => [p.userId, p]));
    return {users, compensation, entries, preview:previewPayroll({month,timeZone,users,entries,compensation}).map(p=>({...p, profile:profilesByUser.get(p.userId)||null}))};
  };

  router.get('/staff-management/overview', async(req,res) => {
    try {
      const {tenantId,timeZone} = await scope(req);
      const month = req.query.month ? monthValue(req.query.month) : new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric',month:'2-digit'}).formatToParts(new Date()).reduce((o,p)=>{if(p.type==='year'||p.type==='month')o[p.type]=p.value;return o;},{}); 
      const selectedMonth = typeof month === 'string' ? month : month.year+'-'+month.month;
      const data = await loadPreview(tenantId,timeZone,selectedMonth);
      const saved = await dbAll('SELECT * FROM staff_payroll_records WHERE tenant_id=? AND month=? ORDER BY createdAt DESC', [tenantId, selectedMonth]);
      const records = new Map(saved.map(row=>[row.userId,row]));
      res.json({month:selectedMonth,timeZone, staff:data.preview.map(row=>({...row, record: records.get(row.userId)||null})), activeClockIns:await dbAll(`SELECT e.id, e.userId, e.username, e.clockIn FROM timeclock_entries e JOIN users u ON e.userId=u.id WHERE u.tenant_id=? AND e.clockOut IS NULL ORDER BY e.clockIn DESC`, [tenantId])});
    } catch(e) {error(res,e);}
  });

  router.put('/staff-management/profile/:userId', async(req,res) => {
    try {
      const {tenantId} = await scope(req);
      const user = await dbGet('SELECT id FROM users WHERE id=? AND tenant_id=?',[req.params.userId, tenantId]);
      if (!user) return res.status(404).json({error:'Staff member not found.'});
      const {fullName='',jobTitle='',department='',phone='',employmentDate=''} = req.body || {};
      const fields=[fullName,jobTitle,department,phone,employmentDate];
      if (!fields.every(x=>typeof x==='string') || fullName.length>120 || jobTitle.length>100 ||
        department.length>100 || phone.length>40 || (employmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(employmentDate))) {
        return res.status(400).json({error:'Invalid staff profile details.'});
      }
      await dbRun(`INSERT INTO staff_profiles(tenant_id,userId,fullName,jobTitle,department,phone,employmentDate,updatedAt)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,userId) DO UPDATE SET fullName=excluded.fullName,jobTitle=excluded.jobTitle,
        department=excluded.department,phone=excluded.phone,employmentDate=excluded.employmentDate,updatedAt=excluded.updatedAt`,
        [tenantId,user.id,fullName.trim(),jobTitle.trim(),department.trim(),phone.trim(),employmentDate||null,Date.now()]);
      res.json({success:true});
    } catch(e) {error(res,e);}
  });

  router.get('/staff-management/attendance', async(req,res) => {
    try {
      const {tenantId,timeZone} = await scope(req);
      const localNow = new Intl.DateTimeFormat('en-GB', {timeZone, year:'numeric',month:'2-digit'}).formatToParts(new Date());
      const parts = Object.fromEntries(localNow.filter(p=>p.type==='year'||p.type==='month').map(p=>[p.type,p.value]));
      const month = req.query.month ? monthValue(req.query.month) : parts.year+'-'+parts.month;
      const {start,end} = payrollPeriod(month,timeZone);
      const entries = await dbAll(`SELECT e.id,e.userId,u.username,e.clockIn,e.clockOut,e.durationMinutes
        FROM timeclock_entries e JOIN users u ON e.userId=u.id
        WHERE u.tenant_id=? AND e.clockIn < ? AND (e.clockOut IS NULL OR e.clockOut > ?)
        ORDER BY e.clockIn DESC LIMIT 2000`,[tenantId,end,start]);
      res.json({month,timeZone,entries});
    } catch(e) {error(res,e);}
  });

  router.put('/staff-management/compensation/:userId', async(req,res) => {
    try {
      const {tenantId} = await scope(req);
      const user = await dbGet('SELECT id FROM users WHERE id=? AND tenant_id=?', [req.params.userId, tenantId]);
      if (!user) return res.status(404).json({error:'Staff member not found.'});
      const {payType,rate,allowance=0,deduction=0} = req.body || {};
      if (!['hourly','monthly'].includes(payType)) return res.status(400).json({error:'Choose hourly or monthly pay.'});
      if (![rate,allowance,deduction].every(v=>v!==''&&v!==null&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100000000)) return res.status(400).json({error:'Pay amounts must be valid positive numbers.'});
      const paidOrDraft = await dbGet("SELECT id FROM staff_payroll_records WHERE tenant_id=? AND userId=? AND status='paid' LIMIT 1", [tenantId,user.id]);
      // Configuration changes are future-facing: previously recorded payroll snapshots never mutate.
      await dbRun(`INSERT INTO staff_compensation(tenant_id,userId,payType,rate,allowance,deduction,updatedAt) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,userId) DO UPDATE SET payType=excluded.payType,rate=excluded.rate,allowance=excluded.allowance,deduction=excluded.deduction,updatedAt=excluded.updatedAt`,
        [tenantId,user.id,payType,Number(rate),Number(allowance),Number(deduction),Date.now()]);
      res.json({success:true, historicalPayrollUnchanged:!!paidOrDraft});
    } catch(e) {error(res,e);}
  });

  router.post('/staff-management/payroll/:userId/:month', async(req,res) => {
    try {
      const {tenantId,timeZone} = await scope(req);
      const month = monthValue(req.params.month);
      const existing = await dbGet('SELECT * FROM staff_payroll_records WHERE tenant_id=? AND userId=? AND month=?', [tenantId,req.params.userId,month]);
      if (existing) return res.status(409).json({error:'Payroll for this employee and month is already recorded. Existing records are never overwritten.'});
      const data = await loadPreview(tenantId,timeZone,month);
      const row = data.preview.find(x=>x.userId===req.params.userId);
      if (!row) return res.status(404).json({error:'Staff member not found.'});
      if (!row.configured) return res.status(400).json({error:'Set the employee pay rate before generating payroll.'});
      const id='pay_'+crypto.randomUUID();
      await dbRun(`INSERT INTO staff_payroll_records(id,tenant_id,userId,month,payType,rate,hours,basicPay,allowance,deduction,totalPay,status,createdBy,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
        [id,tenantId,row.userId,month,row.payType,row.rate,row.hours,row.basicPay,row.allowance,row.deduction,row.totalPay,req.user.id,Date.now()]);
      res.status(201).json({success:true,id,status:'draft'});
    } catch(e) {error(res,e);}
  });

  router.post('/staff-management/payroll-records/:id/mark-paid', requireRole(['owner']), async(req,res) => {
    try {
      const tenantId = req.tenantId;
      const reference=String(req.body?.reference||'').trim();
      if (!reference || reference.length>140) return res.status(400).json({error:'Enter a payment reference (this only records a payment, no money is transferred).'});
      const record=await dbGet('SELECT id,status FROM staff_payroll_records WHERE id=? AND tenant_id=?',[req.params.id,tenantId]);
      if(!record) return res.status(404).json({error:'Payroll record not found.'});
      if(record.status!=='draft')return res.status(409).json({error:'Payroll has already been marked paid.'});
      const changed=await dbRun("UPDATE staff_payroll_records SET status='paid',paidBy=?,paidAt=?,paymentReference=? WHERE id=? AND tenant_id=? AND status='draft'",[req.user.id,Date.now(),reference,record.id,tenantId]);
      res.json({success:true,recorded:true,note:'Payment recorded only; no transfer was initiated.'});
    } catch(e) {error(res,e);}
  });
  return router;
}

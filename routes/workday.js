import express from 'express';
import crypto from 'node:crypto';
import { restaurantTimeZone, dateAtRestaurant } from '../src/utils/restaurant-time.js';
import { dayWindow, shiftDrawerTotals } from '../lib/drawer-reconciliation.js';

export async function initWorkday(dbRun) {
  // Additive-only audit trail. Existing attendance, orders, shifts and cash movements are not replaced.
  await dbRun(`CREATE TABLE IF NOT EXISTS manual_attendance_audit (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, entryId TEXT NOT NULL,
    staffUserId TEXT NOT NULL, managerUserId TEXT NOT NULL,
    clockIn BIGINT NOT NULL, clockOut BIGINT NOT NULL,
    reason TEXT NOT NULL, createdAt BIGINT NOT NULL
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_manual_attendance_tenant ON manual_attendance_audit(tenant_id,createdAt)');
}

export function createWorkdayRouter({ dbGet, dbAll, dbRun, authenticateToken, requireRole }) {
  const router = express.Router();
  router.use('/workday',authenticateToken);
  const fail = (res,err) => res.status(err.status || 500).json({error:err.status ? err.message : 'Unable to complete request.'});
  const tz = async tenantId => {
    const setting = await dbGet("SELECT value FROM settings WHERE tenant_id=? AND key='timeZone'",[tenantId]);
    return restaurantTimeZone({timeZone:setting?.value});
  };

  // Owner/manager can create an explicitly disclosed missing shift, never silently edit existing records.
  router.post('/workday/manual-attendance',requireRole(['owner','manager']),async(req,res)=>{
    try {
      const {userId,clockIn,clockOut,reason} = req.body || {};
      const start=Number(clockIn),end=Number(clockOut);
      if(typeof userId!=='string' || !userId || typeof reason!=='string' || reason.trim().length<6 || reason.length>500)
        return res.status(400).json({error:'Choose an employee and enter a reason (at least 6 characters).'});
      if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end<=start || end-start>24*3600000 || end>Date.now()+60000 || start<Date.now()-366*86400000)
        return res.status(400).json({error:'Choose a completed shift of up to 24 hours from the past 366 days.'});
      const employee=await dbGet('SELECT id,username FROM users WHERE id=? AND tenant_id=?',[userId,req.tenantId]);
      if(!employee)return res.status(404).json({error:'Staff member not found.'});
      let transaction=false;
      try {
        await dbRun('BEGIN TRANSACTION');transaction=true;
        const overlaps=await dbGet(`SELECT id FROM timeclock_entries WHERE userId=?
          AND clockIn < ? AND (clockOut IS NULL OR clockOut > ?) LIMIT 1`,[userId,end,start]);
        if(overlaps) {
          await dbRun('ROLLBACK');transaction=false;
          return res.status(409).json({error:'This period overlaps an existing shift. No attendance was added.'});
        }
        const entryId='tc_manual_'+crypto.randomUUID(),auditId='att_audit_'+crypto.randomUUID();
        await dbRun('INSERT INTO timeclock_entries(id,userId,username,clockIn,clockOut,durationMinutes) VALUES(?,?,?,?,?,?)',
          [entryId,employee.id,employee.username,start,end,Math.round((end-start)/60000)]);
        await dbRun(`INSERT INTO manual_attendance_audit(id,tenant_id,entryId,staffUserId,managerUserId,clockIn,clockOut,reason,createdAt)
          VALUES(?,?,?,?,?,?,?,?,?)`,[auditId,req.tenantId,entryId,userId,req.user.id,start,end,reason.trim(),Date.now()]);
        await dbRun('COMMIT');transaction=false;
        res.status(201).json({success:true,entryId,manual:true});
      } catch(e) {if(transaction)await dbRun('ROLLBACK');throw e;}
    }catch(e){fail(res,e);}
  });

  router.get('/workday/manual-attendance',requireRole(['owner','manager']),async(req,res)=>{
    try {
      const rows=await dbAll(`SELECT a.entryId,a.staffUserId,a.clockIn,a.clockOut,a.reason,a.createdAt,
        u.username AS staffName,m.username AS enteredBy
        FROM manual_attendance_audit a JOIN users u ON u.id=a.staffUserId AND u.tenant_id=a.tenant_id
        LEFT JOIN users m ON m.id=a.managerUserId AND m.tenant_id=a.tenant_id
        WHERE a.tenant_id=? ORDER BY a.createdAt DESC LIMIT 100`,[req.tenantId]);
      res.json(rows);
    }catch(e){fail(res,e);}
  });

  router.get('/workday/drawer',async(req,res)=>{
    try {
      const zone=await tz(req.tenantId);
      const date=String(req.query.date || dateAtRestaurant(Date.now(),zone));
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Select a valid YYYY-MM-DD date.'});
      let start,end;
      try { [start,end]=dayWindow(date,zone); }catch{return res.status(400).json({error:'Select a valid calendar date.'});}
      const manager=['owner','manager'].includes(req.user.role);
      const shifts=await dbAll(`SELECT s.* FROM shifts s JOIN users u ON u.id=s.userId AND u.tenant_id=s.tenant_id
        WHERE s.tenant_id=? AND s.startTime>=? AND s.startTime<? ${manager?'':'AND s.userId=?'}
        ORDER BY s.startTime DESC LIMIT 150`,manager?[req.tenantId,start,end]:[req.tenantId,start,end,req.user.id]);
      const entries=[];
      for(const shift of shifts){
        const final=shift.endTime || Date.now();
        const legacySales=await dbAll(`SELECT o.total,o.paymentMethod,o.paymentSplit FROM orders o
          WHERE o.tenant_id=? AND o.cashierId=? AND (o.paymentStatus='paid' OR o.status='paid')
          AND COALESCE(o.paymentTimestamp,o.timestamp)>=? AND COALESCE(o.paymentTimestamp,o.timestamp)<=?
          AND NOT EXISTS(SELECT 1 FROM manual_payments mp WHERE mp.orderId=o.id AND mp.tenant_id=o.tenant_id)`,[req.tenantId,shift.userId,shift.startTime,final]);
        const receipts=await dbAll(`SELECT method,amountCents FROM manual_payments
          WHERE tenant_id=? AND actorId=? AND shiftId=?`,[req.tenantId,shift.userId,shift.id]);
        const refunds=await dbGet(`SELECT COALESCE(SUM(r.amountCents),0) AS cents FROM refund_transactions r
          WHERE r.actorId=? AND r.tenant_id=? AND r.createdAt>=? AND r.createdAt<=?
          AND NOT EXISTS(SELECT 1 FROM manual_refunds mr WHERE mr.id=r.id)`,[shift.userId,req.tenantId,shift.startTime,final]);
        const manualRefunds=await dbGet(`SELECT COALESCE(SUM(amountCents),0) AS cents FROM manual_refunds
          WHERE actorId=? AND tenant_id=? AND shiftId=? AND method='cash'`,[shift.userId,req.tenantId,shift.id]);
        const movements=await dbAll('SELECT type,amount FROM cash_movements WHERE shiftId=? AND tenant_id=?',[shift.id,req.tenantId]);
        const summary=shiftDrawerTotals({opening:shift.startFloat,legacySales,receipts,refundsCents:refunds?.cents,manualRefundsCents:manualRefunds?.cents,movements});
        const expected=shift.status==='closed' && shift.expectedCash!=null ? Number(shift.expectedCash) : summary.expectedCash;
        const actual=shift.actualCash==null?null:Number(shift.actualCash);
        entries.push({id:shift.id,cashier:shift.username,userId:shift.userId,startTime:shift.startTime,endTime:shift.endTime||null,status:shift.status,
          ...summary,expectedCash:expected,actualCash:actual,difference:actual===null?null:Math.round((actual-expected)*100)/100});
      }
      const totals=entries.reduce((out,row)=>{for(const key of ['opening','cashSales','nonCashReceipts','cashRefunds','cashMovements','expectedCash'])out[key]+=row[key];if(row.actualCash!==null){out.countedCash+=row.actualCash;out.countedShifts++;}return out;},
        {opening:0,cashSales:0,nonCashReceipts:0,cashRefunds:0,cashMovements:0,expectedCash:0,countedCash:0,countedShifts:0});
      for(const k of Object.keys(totals))if(k!=='countedShifts')totals[k]=Math.round(totals[k]*100)/100;
      res.json({date,timeZone:zone,shifts:entries,totals,
        note:'Cashier drawer receipts are not total restaurant revenue; unpaid orders and cash collected by delivery drivers are excluded. Closed shift expected amounts use the recorded close-of-shift snapshot.'});
    }catch(e){fail(res,e);}
  });
  return router;
}

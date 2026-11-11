import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, ArrowRight, CalendarDays, CheckCircle2, Clock3, LogIn, LogOut, RefreshCw, ShieldCheck, Timer, UserRound } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { dateAtRestaurant, formatRestaurantTime, restaurantTimeZone } from '../utils/restaurant-time';
import './my-attendance.css';

async function timeclock(path, options = {}) {
  const token = localStorage.getItem('gastroflow_token');
  const res = await fetch('/api/timeclock/' + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not update attendance. Please try again.');
  return data;
}

function readableDuration(milliseconds) {
  const minutes = Math.max(0, Math.floor(Math.max(0, milliseconds) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
}

export default function MyAttendance() {
  const { currentUser, settings, showToast } = usePOS();
  const zone = restaurantTimeZone(settings);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [confirmOut, setConfirmOut] = useState(false);
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [current, recent] = await Promise.all([timeclock('status'), timeclock('mine')]);
      setStatus(current);
      setHistory(Array.isArray(recent) ? recent : []);
      setError('');
      setNow(Date.now());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  const clockedIn = Boolean(status?.clockedIn);
  const clockStart = Number(status?.session?.clockIn || 0);
  const elapsed = clockedIn && clockStart ? readableDuration(now - clockStart) : '00m';
  const today = dateAtRestaurant(now, zone);
  const todayRows = useMemo(() => history.filter(row => dateAtRestaurant(row.clockIn, zone) === today), [history, today, zone]);
  const completedMinutes = todayRows.reduce((total,row) =>
    total + (row.clockOut && row.clockOut > row.clockIn ? Math.max(0, Number(row.durationMinutes) || Math.round((row.clockOut - row.clockIn)/60000)) : 0),0);

  const submit = async () => {
    if (busy || loading || !status) return;
    if (clockedIn && !confirmOut) { setConfirmOut(true); return; }
    setBusy(true);
    setConfirmOut(false);
    setError('');
    setSuccess('');
    try {
      const result = await timeclock(clockedIn ? 'clock-out' : 'clock-in', {method:'POST'});
      setSuccess(clockedIn
        ? `Shift finished. ${readableDuration((result.durationMinutes || 0) * 60000)} recorded.`
        : 'You are clocked in. Your shift has started.');
      showToast(clockedIn ? 'Clocked out successfully' : 'Clocked in successfully', 'success');
      await refresh();
    } catch (err) { setError(err.message); await refresh(); }
    finally { setBusy(false); }
  };

  return <main className="view-body my-attendance-view">
    <header className="attendance-hero">
      <div className="attendance-brand"><span className="attendance-icon"><AlarmClock size={25}/></span><div>
        <p className="attendance-eyebrow">YOUR WORKDAY</p><h1>My Attendance</h1>
        <p>Welcome, <strong>{currentUser?.username || 'team member'}</strong>. Record your shift with one simple action.</p>
      </div></div>
      <div className="attendance-local-date"><CalendarDays size={17}/><span>{new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(now)}</span><small>{zone}</small></div>
    </header>

    <div className="attendance-layout">
      <section className="attendance-main-card" aria-label="Clock in and out">
        <div className="attendance-status"><span className={`attendance-indicator ${clockedIn ? 'working' : 'off'}`}></span><span>{loading ? 'Checking status…' : clockedIn ? 'You are clocked in' : 'You are clocked out'}</span></div>
        <div className="attendance-timer"><Timer size={23}/><span>{loading ? '—' : elapsed}</span><small>{clockedIn ? 'Time on your current shift' : 'Ready for your next shift'}</small></div>
        {clockedIn && <div className="attendance-clockstart"><Clock3 size={16}/> Started at {formatRestaurantTime(clockStart,zone, {dateStyle: 'medium', timeStyle:'short'})}</div>}
        {confirmOut ? <div className="attendance-confirm">
          <strong>Finish your shift?</strong><p>Clocking out will stop tracking this session and save your attendance.</p>
          <div><button disabled={busy} className="attendance-cancel" onClick={()=>setConfirmOut(false)}>Keep working</button><button disabled={busy} className="attendance-primary stop" onClick={submit}><LogOut size={20}/> Confirm clock out</button></div>
        </div> : <button className={`attendance-primary ${clockedIn?'stop':'start'}`} onClick={submit} disabled={busy || loading || !status}>
          {clockedIn ? <LogOut size={24}/> : <LogIn size={24}/>}
          {busy ? 'Saving attendance…' : clockedIn ? 'Clock out' : 'Clock in'}
          <ArrowRight size={19}/>
        </button>}
        {error && <p className="attendance-alert" role="alert">{error}</p>}
        {success && <p className="attendance-success" role="status"><CheckCircle2 size={18}/>{success}</p>}
        <div className="attendance-confidence"><ShieldCheck size={17}/> Your times are recorded securely against your staff account.</div>
      </section>

      <aside className="attendance-side">
        <div className="attendance-summary-card"><div className="attendance-small-heading"><CalendarDays size={19}/> Today's activity</div>
          <div className="attendance-summary-number">{readableDuration(completedMinutes*60000)}</div><p>Completed shift time today</p>
          <div className="attendance-summary-divider"/>
          <div className="attendance-summary-line"><span>Completed sessions</span><strong>{todayRows.filter(x=>x.clockOut).length}</strong></div>
          <div className="attendance-summary-line"><span>Currently working</span><strong>{clockedIn?'Yes':'No'}</strong></div>
        </div>
        <div className="attendance-help"><UserRound size={20}/><div><strong>How it works</strong><p>Tap <b>Clock in</b> when you start work and <b>Clock out</b> when you finish. Owners and managers can review attendance in Staff & Payroll.</p></div></div>
      </aside>
    </div>

    <section className="attendance-history">
      <div className="attendance-history-header"><div><h2>Recent shifts</h2><p>Your latest 30 attendance sessions</p></div><button className="attendance-refresh" onClick={refresh} disabled={loading||busy}><RefreshCw size={17}/> Refresh</button></div>
      {loading ? <p className="attendance-empty">Loading your attendance…</p> : history.length ? <div className="attendance-history-table-wrap">
        <table><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Duration</th><th>Status</th></tr></thead>
        <tbody>{history.map(row=><tr key={row.id}><td>{dateAtRestaurant(row.clockIn,zone)}</td>
          <td>{formatRestaurantTime(row.clockIn,zone,{dateStyle:undefined,timeStyle:'short'})}</td>
          <td>{row.clockOut?formatRestaurantTime(row.clockOut,zone,{dateStyle:undefined,timeStyle:'short'}):'—'}</td>
          <td>{row.clockOut?readableDuration((row.durationMinutes ?? Math.round((row.clockOut-row.clockIn)/60000))*60000):'In progress'}</td>
          <td><span className={`attendance-pill ${row.clockOut?'finished':'active'}`}>{row.clockOut?'Completed':'Working'}</span></td></tr>)}</tbody></table></div>
      : <p className="attendance-empty">No attendance records yet. Clock in to start your first shift.</p>}
    </section>
  </main>;
}

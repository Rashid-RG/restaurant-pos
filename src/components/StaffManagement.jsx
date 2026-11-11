import React, { useEffect, useMemo, useState } from 'react';
import { Users, CalendarDays, Wallet, Clock3, RefreshCw, CheckCircle2, Save, FilePlus, Search } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import { dateAtRestaurant, formatRestaurantTime, restaurantTimeZone } from '../utils/restaurant-time';
import './staff-management.css';

async function payrollApi(path, options = {}) {
  const token = localStorage.getItem('gastroflow_token');
  const response = await fetch('/api/staff-management' + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Staff management request failed.');
  return result;
}

const finiteAmount = n => Number.isFinite(Number(n)) && Number(n) >= 0;

function CompensationEditor({ person, onSave, busy, currency }) {
  const [payType, setPayType] = useState(person.payType || 'monthly');
  const [rate, setRate] = useState(String(person.rate || 0));
  const [allowance, setAllowance] = useState(String(person.allowance || 0));
  const [deduction, setDeduction] = useState(String(person.deduction || 0));
  return <form className="staff-editor" onSubmit={event => {
    event.preventDefault();
    if (![rate, allowance, deduction].every(finiteAmount)) return;
    onSave({ payType, rate: Number(rate), allowance: Number(allowance), deduction: Number(deduction) });
  }}>
    <div><label>Pay basis<select value={payType} onChange={e=>setPayType(e.target.value)}><option value="monthly">Monthly salary</option><option value="hourly">Hourly wage</option></select></label></div>
    <div><label>{payType === 'monthly' ? 'Monthly salary' : 'Hourly rate'} ({currency})<input type="number" min="0" step="0.01" required value={rate} onChange={e=>setRate(e.target.value)}/></label></div>
    <div><label>Monthly allowances ({currency})<input type="number" min="0" step="0.01" required value={allowance} onChange={e=>setAllowance(e.target.value)}/></label></div>
    <div><label>Monthly deductions ({currency})<input type="number" min="0" step="0.01" required value={deduction} onChange={e=>setDeduction(e.target.value)}/></label></div>
    <button className="btn btn-primary" disabled={busy || ![rate,allowance,deduction].every(finiteAmount)}><Save size={16}/> Save pay settings</button>
  </form>;
}

function ProfileEditor({person, onSave, busy}) {
  const profile=person.profile || {};
  const [fullName,setFullName]=useState(profile.fullName || '');
  const [jobTitle,setJobTitle]=useState(profile.jobTitle || '');
  const [department,setDepartment]=useState(profile.department || '');
  const [phone,setPhone]=useState(profile.phone || '');
  const [employmentDate,setEmploymentDate]=useState(profile.employmentDate || '');
  return <form className="staff-editor" onSubmit={e=>{e.preventDefault();onSave({fullName,jobTitle,department,phone,employmentDate});}}>
    <label>Full name<input maxLength="120" value={fullName} onChange={e=>setFullName(e.target.value)}/></label>
    <label>Job title<input maxLength="100" placeholder="e.g. Chef, Cashier, Supervisor" value={jobTitle} onChange={e=>setJobTitle(e.target.value)}/></label>
    <label>Department<input maxLength="100" placeholder="e.g. Kitchen, Front of house" value={department} onChange={e=>setDepartment(e.target.value)}/></label>
    <label>Contact phone<input maxLength="40" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
    <label>Employment start date<input type="date" value={employmentDate} onChange={e=>setEmploymentDate(e.target.value)}/></label>
    <button className="btn btn-primary" disabled={busy}><Save size={16}/> Save employee profile</button>
  </form>;
}

export default function StaffManagement() {
  const { currentUser, settings, showToast } = usePOS();
  const timeZone = restaurantTimeZone(settings);
  const currency = settings?.currencySymbol || 'Rs.';
  const [month, setMonth] = useState(() => dateAtRestaurant(new Date(), timeZone).slice(0,7));
  const [tab, setTab] = useState('team');
  const [data, setData] = useState({ staff: [], activeClockIns: [] });
  const [attendance, setAttendance] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editSection, setEditSection] = useState('salary');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [overview, history] = await Promise.all([
        payrollApi('/overview?month=' + encodeURIComponent(month)),
        payrollApi('/attendance?month=' + encodeURIComponent(month))
      ]);
      setData(overview); setAttendance(history.entries || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [month]);

  const changePay = async (person, configuration) => {
    setBusy(true);
    try {
      await payrollApi('/compensation/' + encodeURIComponent(person.userId), {method:'PUT',body:JSON.stringify(configuration)});
      showToast('Pay settings saved for ' + person.username, 'success');
      setSelected(null); await refresh();
    } catch(e) {showToast(e.message,'error');} finally {setBusy(false);}
  };
  const changeProfile = async (person,profile) => {
    setBusy(true);
    try {
      await payrollApi('/profile/'+encodeURIComponent(person.userId),{method:'PUT',body:JSON.stringify(profile)});
      showToast('Employee profile saved.','success');
      setSelected(null);await refresh();
    } catch(e) {showToast(e.message,'error');} finally {setBusy(false);}
  };
  const createDraft = async person => {
    if (!window.confirm(`Create a payroll snapshot for ${person.username}, ${month}? This cannot be overwritten later.`)) return;
    setBusy(true);
    try {
      await payrollApi('/payroll/' + encodeURIComponent(person.userId) + '/' + encodeURIComponent(month), {method:'POST'});
      showToast('Draft payroll record created.', 'success'); await refresh();
    } catch(e){showToast(e.message,'error');}finally{setBusy(false);}
  };
  const markPaid = async person => {
    const reference = window.prompt('Enter a payment reference after making the payment outside GastroFlow. No funds will be transferred by this action.');
    if (reference === null) return;
    if (!reference.trim()) {showToast('A payment reference is required.','warning');return;}
    if (!window.confirm(`Confirm that ${person.username} has actually been paid ${currency} ${Number(person.record.totalPay).toFixed(2)}? This action is permanent.`)) return;
    setBusy(true);
    try {
      await payrollApi('/payroll-records/' + encodeURIComponent(person.record.id) + '/mark-paid', {method:'POST',body:JSON.stringify({reference})});
      showToast('Payment recorded (no transfer was made).','success'); await refresh();
    } catch(e){showToast(e.message,'error');}finally{setBusy(false);}
  };
  if (!['owner','manager'].includes(currentUser?.role)) return <div className="view-body"><p role="alert">Staff and payroll management requires restaurant owner or manager access.</p></div>;
  const money = amount => currency+' '+Number(amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const people = (data.staff||[]).filter(p=>p.username.toLowerCase().includes(search.toLowerCase()));
  const configured = (data.staff||[]).filter(p=>p.configured).length;
  const active = data.activeClockIns?.length || 0;
  const total = (data.staff||[]).reduce((sum,p)=>sum+(p.record?.totalPay ?? (p.configured ? p.totalPay : 0)),0);
  const selectedPerson = data.staff?.find(p=>p.userId===selected);
  const recordStatus = record => record?.status==='paid' ? 'Paid' : record?.status==='draft' ? 'Draft' : 'Not generated';

  return <main className="view-body staff-management-view">
    <header className="staff-head">
      <div><p className="staff-kicker"><Users size={16}/> RESTAURANT WORKFORCE</p><h1>Staff & Payroll</h1><p>Manage your team, clock-in attendance, pay settings and monthly payroll in {timeZone}.</p></div>
      <div className="staff-head-actions"><label>Pay month<input aria-label="Payroll month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button className="btn btn-secondary" onClick={refresh} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
    </header>
    <div className="staff-summary">
      <article><Users/><span>Staff accounts</span><strong>{data.staff.length}</strong></article>
      <article><Clock3/><span>Clocked in now</span><strong>{active}</strong></article>
      <article><CheckCircle2/><span>Pay settings configured</span><strong>{configured}</strong></article>
      <article><Wallet/><span>Monthly payroll estimate</span><strong>{money(total)}</strong></article>
    </div>
    {error && <p role="alert" className="staff-error">{error}</p>}
    <nav className="staff-tabs" aria-label="Staff management sections">
      {[['team','Employees'],['attendance','Attendance'],['payroll','Payroll']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>
    {loading ? <p className="staff-placeholder">Loading staff records…</p> : <>
      {tab==='team' && <section className="staff-panel">
        <div className="staff-panel-header"><div><h2>Employees</h2><p>Linked to your existing staff login accounts. To create new logins, use Settings → Team.</p></div><label className="staff-find"><Search size={17}/><input aria-label="Search staff" placeholder="Search employees" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
        <div className="staff-grid">{people.map(person=><article key={person.userId} className="staff-person">
          <div className="staff-person-top"><span className="staff-avatar">{person.username.slice(0,2).toUpperCase()}</span><div><strong>{person.profile?.fullName || person.username}</strong><small>{person.profile?.jobTitle || person.role}</small></div></div>
          <dl><div><dt>Pay type</dt><dd>{person.configured ? person.payType : 'Not set'}</dd></div><div><dt>Attendance hours</dt><dd>{person.hours}h</dd></div><div><dt>Estimated pay</dt><dd>{person.configured?money(person.totalPay):'—'}</dd></div></dl>
          <div className="staff-person-actions"><button className="btn btn-secondary" onClick={()=>{setEditSection("profile");setSelected(person.userId);}}>Edit profile</button><button className="btn btn-secondary" onClick={()=>{setEditSection("salary");setSelected(person.userId);}}>Manage salary</button></div>
        </article>)}</div>
        {!people.length && <p className="staff-placeholder">No staff accounts found.</p>}
      </section>}
      {tab==='attendance' && <section className="staff-panel">
        <div className="staff-panel-header"><div><h2>Attendance log</h2><p>Actual staff clock-in / clock-out sessions. Open sessions are excluded from completed paid hours.</p></div></div>
        <div className="staff-table-scroll"><table className="staff-table"><thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Duration</th><th>Status</th></tr></thead><tbody>{attendance.map(entry=><tr key={entry.id}>
          <td><strong>{entry.username}</strong></td><td>{formatRestaurantTime(entry.clockIn,timeZone)}</td><td>{entry.clockOut?formatRestaurantTime(entry.clockOut,timeZone):'—'}</td><td>{entry.clockOut?Math.round((Number(entry.clockOut)-Number(entry.clockIn))/60000)+' min':'In progress'}</td><td><span className={'staff-status '+(entry.clockOut?'closed':'open')}>{entry.clockOut?'Completed':'Clocked in'}</span></td>
        </tr>)}</tbody></table>{!attendance.length&&<p className="staff-placeholder">No clock-in records for this month.</p>}</div>
      </section>}
      {tab==='payroll' && <section className="staff-panel">
        <div className="staff-panel-header"><div><h2>Monthly payroll</h2><p>Draft calculations are estimates. Confirm attendance, benefits, statutory obligations and deductions before paying.</p></div></div>
        <div className="staff-table-scroll"><table className="staff-table"><thead><tr><th>Employee</th><th>Hours</th><th>Base pay</th><th>Allowance</th><th>Deductions</th><th>Estimated total</th><th>Status</th><th>Action</th></tr></thead><tbody>{(data.staff||[]).map(person=><tr key={person.userId}>
          <td><strong>{person.username}</strong></td><td>{person.hours}</td><td>{person.configured?money(person.record?.basicPay??person.basicPay):'—'}</td><td>{person.configured?money(person.record?.allowance??person.allowance):'—'}</td><td>{person.configured?money(person.record?.deduction??person.deduction):'—'}</td><td><strong>{person.configured?money(person.record?.totalPay??person.totalPay):'—'}</strong></td>
          <td><span className={'staff-status '+(person.record?.status||'unset')}>{recordStatus(person.record)}</span></td>
          <td>{person.record?.status==='paid' ? <span className="staff-paid">Recorded</span> : person.record?.status==='draft' ? (currentUser.role==='owner'?<button className="btn btn-secondary" disabled={busy} onClick={()=>markPaid(person)}>Mark paid</button>:<span>Awaiting owner</span>) : person.configured ? <button className="btn btn-primary" disabled={busy} onClick={()=>createDraft(person)}><FilePlus size={15}/> Create draft</button> : <button className="btn btn-secondary" onClick={()=>{setEditSection('salary');setSelected(person.userId);setTab('team');}}>Set salary</button>}</td>
        </tr>)}</tbody></table>{!data.staff.length&&<p className="staff-placeholder">No staff accounts available.</p>}</div>
        <p className="staff-disclaimer">GastroFlow only records the payroll calculation and payment acknowledgment; it does not send money, withhold tax, or file government payroll returns.</p>
      </section>}
    </>}
    {selectedPerson && <div className="staff-overlay" onClick={()=>setSelected(null)} role="presentation"><section className="staff-dialog" role="dialog" aria-modal="true" aria-label="Edit compensation" onClick={e=>e.stopPropagation()}><header><div><h2>{selectedPerson.profile?.fullName || selectedPerson.username}</h2><p>{editSection === 'salary' ? 'Configure hourly or monthly compensation' : 'Manage this employee profile'}</p></div><button aria-label="Close" onClick={()=>setSelected(null)}>✕</button></header>{editSection === 'salary' ? <CompensationEditor key={selectedPerson.userId} person={selectedPerson} currency={currency} onSave={c=>changePay(selectedPerson,c)} busy={busy}/> : <ProfileEditor key={selectedPerson.userId} person={selectedPerson} onSave={p=>changeProfile(selectedPerson,p)} busy={busy}/>}<p className="staff-disclaimer">Existing staff login accounts, historical attendance and paid payroll records remain unchanged.</p></section></div>}
  </main>;
}

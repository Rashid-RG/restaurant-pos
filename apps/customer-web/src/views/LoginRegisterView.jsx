import React, { useState, useEffect } from 'react';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';

const PHONE_RE = /^(?:\+94|0)7\d{8}$/;

export default function LoginRegisterView({ onSuccess, toast = () => {}, resetToken = null, onResetHandled }) {
  const { t, dict } = useLang();
  // tab: 'login' | 'register' | 'forgot' | 'reset'
  const [tab, setTab] = useState(resetToken ? 'reset' : 'login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, loginWithOtp, register } = useCustomerAuth();

  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  // Forgot / reset password
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetTokenVal, setResetTokenVal] = useState(resetToken || '');

  // Real OTP (register & login phone/email verification)
  const [otpVerified, setOtpVerified] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [activeOtpDestination, setActiveOtpDestination] = useState('');

  useEffect(() => {
    setError('');
    setOtpVerified(false);
    setShowOtpModal(false);
  }, [tab]);

  useEffect(() => {
    if (resetToken) { setResetTokenVal(resetToken); setTab('reset'); }
  }, [resetToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!loginPhone.trim()) { setError('Phone Number is required.'); return; }
    const cleanPhone = loginPhone.trim().replace(/[\s-]/g, '');
    if (!PHONE_RE.test(cleanPhone)) { setError('Please enter a valid Sri Lankan phone number (e.g. 0771234567).'); return; }
    setLoading(true);
    try {
      await login(loginPhone.trim(), loginPassword);
      onSuccess && onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!regName.trim()) { setError('Full Name is required.'); return; }
    if (!regPhone.trim()) { setError('Phone Number is required.'); return; }
    const cleanPhone = regPhone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(cleanPhone)) { setError('Please enter a valid Sri Lankan mobile number (e.g. 0771234567).'); return; }
    if (regPassword !== regConfirm) { setError('Passwords do not match.'); return; }
    if (regPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }

    // Real phone verification: the server sends the OTP (SMS gateway or dev console).
    if (!otpVerified) {
      setOtpBusy(true);
      try {
        const r = await apiFetch('/otp/send', {
          method: 'POST',
          body: JSON.stringify({ channel: 'sms', destination: cleanPhone, purpose: 'phone_verify' })
        });
        setActiveOtpDestination(cleanPhone);
        if (r.otpCode) {
          setEnteredOtp(r.otpCode);
          toast(`Verification code: ${r.otpCode} (Auto-filled)`, 'success', 8000);
        } else {
          toast(`Code sent to ${regPhone}.`, 'info', 8000);
        }
        setShowOtpModal(true);
      } catch (err) {
        setError(err.message || 'Could not send verification code.');
      } finally {
        setOtpBusy(false);
      }
      return;
    }

    await doRegister();
  };

  const doRegister = async (codeVal) => {
    setLoading(true);
    try {
      await register(regName, regEmail.trim(), regPhone, regPassword, codeVal);
      onSuccess && onSuccess();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    const dest = activeOtpDestination || (tab === 'otp_login' ? loginPhone.trim() : regPhone.replace(/[\s-]/g, ''));
    setOtpBusy(true);
    try {
      const codeVal = enteredOtp.trim();
      const r = await loginWithOtp(dest, codeVal);
      if (r.loggedIn) {
        setShowOtpModal(false);
        setEnteredOtp('');
        toast('Logged in successfully via OTP! 🎉', 'success');
        onSuccess && onSuccess();
      } else if (r.verified) {
        setOtpVerified(true);
        setShowOtpModal(false);
        setEnteredOtp('');
        if (tab === 'register') {
          await doRegister(codeVal);
        } else {
          toast('OTP verified! Complete your profile below.', 'info');
          setRegPhone(dest);
          setTab('register');
        }
      } else {
        toast('Invalid verification code. Please try again.', 'error');
      }
    } catch (err) {
      toast(err.message || 'Verification failed.', 'error');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    if (!forgotEmail.trim()) { setError('Please enter your account email.'); return; }
    setLoading(true);
    try {
      const r = await apiFetch('/customer/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim() })
      });
      toast(r.message || 'If that email is registered, a reset code was sent.', 'success', 8000);
      setTab('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    if (resetPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const body = resetTokenVal
        ? { token: resetTokenVal, newPassword: resetPassword }
        : { email: forgotEmail.trim(), code: resetCode.trim(), newPassword: resetPassword };
      const r = await apiFetch('/customer/auth/reset-password', { method: 'POST', body: JSON.stringify(body) });
      toast(r.message || 'Password updated. Please sign in.', 'success');
      onResetHandled && onResetHandled();
      setResetTokenVal('');
      setResetCode('');
      setResetPassword('');
      setTab('login');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const subtitle = {
    login: 'Welcome back! Sign in to continue.',
    register: 'Create your account to start ordering.',
    forgot: 'Reset your password — we’ll send a code to your email.',
    reset: 'Enter the code from your email and a new password.'
  }[tab];

  return (
    <div className="auth-page fade-in" style={{ padding: '24px 16px' }}>
      <div className="auth-logo" style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1>🍽️ GastroFlow</h1>
        <p>{subtitle}</p>
      </div>

      {(tab === 'login' || tab === 'register') && (
        <div className="auth-tabs" style={{ display: 'flex', marginBottom: 20 }}>
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('login')}>{t('signIn') || 'Sign In'}</button>
          <button className={`auth-tab ${tab === 'register' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('register')}>{t('createAccount') || 'Create Account'}</button>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 8, padding: '10px 14px', marginBottom: '12px', fontSize: '0.85rem', fontWeight: 600 }}>
          ⚠ {error}
        </div>
      )}

      {tab === 'login' && (
        <form onSubmit={handleLogin} noValidate>
          <div className="form-group">
            <label>Phone Number</label>
            <input className="form-control" type="text" inputMode="tel" required placeholder="e.g. 0771234567"
              value={loginPhone} onChange={e => setLoginPhone(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Password</label>
            <input className="form-control" type="password" required placeholder="••••••••"
              value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
          </div>
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button type="button" className="link-btn" onClick={() => setTab('forgot')}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              Forgot password?
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand" disabled={loading} style={{ width: '100%', padding: 12 }}>
              {loading ? t('loading') : t('signIn')}
            </button>
          </div>

          {/* Quick OTP Login Option */}
          <div style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>Or sign in without a password:</div>
            <button
              type="button"
              onClick={() => setTab('otp_login')}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 12,
                background: '#ff6b3515',
                border: '1px solid #ff6b3550',
                color: '#ff6b35',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <span>📲 Sign In via Phone SMS / Email OTP</span>
            </button>
          </div>
        </form>
      )}

      {tab === 'otp_login' && (
        <div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-1)' }}>Enter Phone Number or Email</label>
            <input
              className="form-control"
              type="text"
              placeholder="e.g. 0771234567 or customer@gmail.com"
              value={loginPhone}
              onChange={e => setLoginPhone(e.target.value)}
              style={{ height: 46, borderRadius: 12, fontSize: '16px' }}
            />
          </div>

          <button
            type="button"
            className="btn btn-brand"
            disabled={otpBusy}
            onClick={async () => {
              setError('');
              if (!loginPhone.trim()) { setError('Please enter your phone number or email.'); return; }
              const dest = loginPhone.trim();
              const channel = dest.includes('@') ? 'email' : 'sms';
              setOtpBusy(true);
              try {
                const r = await apiFetch('/otp/send', {
                  method: 'POST',
                  body: JSON.stringify({ channel, destination: dest, purpose: 'login' })
                });
                setActiveOtpDestination(dest);
                if (r.otpCode) {
                  setEnteredOtp(r.otpCode);
                  toast(`Verification code: ${r.otpCode} (Auto-filled)`, 'success', 8000);
                } else {
                  toast(`Verification code sent to ${dest}!`, 'info');
                }
                setShowOtpModal(true);
              } catch (err) {
                if (err.message && err.message.includes('No registered account')) {
                  toast('No registered account found with this phone/email. Let\'s create your account!', 'warning');
                  setRegEmail(dest.includes('@') ? dest : '');
                  setRegPhone(dest.includes('@') ? '' : dest);
                  setTab('register');
                } else {
                  setError(err.message || 'Could not send OTP code.');
                }
              } finally {
                setOtpBusy(false);
              }
            }}
            style={{ width: '100%', padding: 12, borderRadius: 12, fontWeight: 800 }}
          >
            {otpBusy ? 'Sending Code...' : '📩 Send OTP Verification Code'}
          </button>

          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => setTab('login')}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
            >
              ⬅ Back to Password Sign In
            </button>
          </div>
        </div>
      )}

      {tab === 'register' && (
        <form onSubmit={handleRegister} noValidate>
          <div className="form-group">
            <label>Full Name</label>
            <input className="form-control" required placeholder="John Doe" value={regName} onChange={e => setRegName(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Email Address <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(for receipts & reset)</span></label>
            <input className="form-control" type="email" placeholder="you@example.com" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Phone Number <span style={{ color: 'var(--brand)', fontWeight: 800 }}>*</span></label>
            <input className="form-control" type="text" inputMode="tel" placeholder="e.g. 0771234567" value={regPhone} onChange={e => setRegPhone(e.target.value)} required />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Password</label>
            <input className="form-control" type="password" required placeholder="Minimum 6 characters" value={regPassword} onChange={e => setRegPassword(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Confirm Password</label>
            <input className="form-control" type="password" required placeholder="Re-enter password" value={regConfirm} onChange={e => setRegConfirm(e.target.value)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand" disabled={loading || otpBusy} style={{ width: '100%', padding: 12 }}>
              {loading || otpBusy ? '⏳ …' : `🎉 ${dict.createAccount || 'Create Account'}`}
            </button>
          </div>
        </form>
      )}

      {tab === 'forgot' && (
        <form onSubmit={handleForgot} noValidate>
          <div className="form-group">
            <label>Account Email</label>
            <input className="form-control" type="email" required placeholder="you@example.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand" disabled={loading} style={{ width: '100%', padding: 12 }}>
              {loading ? '⏳ …' : 'Send reset code'}
            </button>
          </div>
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button type="button" className="link-btn" onClick={() => setTab('login')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}>← Back to sign in</button>
          </div>
        </form>
      )}

      {tab === 'reset' && (
        <form onSubmit={handleReset} noValidate>
          {!resetTokenVal && (
            <>
              <div className="form-group">
                <label>Account Email</label>
                <input className="form-control" type="email" required placeholder="you@example.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Reset Code</label>
                <input className="form-control" type="text" inputMode="numeric" maxLength={6} placeholder="6-digit code from email/SMS"
                  value={resetCode} onChange={e => setResetCode(e.target.value)}
                  style={{ textAlign: 'center', letterSpacing: '4px', fontWeight: 700 }} />
              </div>
            </>
          )}
          {resetTokenVal && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              ✓ Reset link verified. Choose a new password below.
            </p>
          )}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>New Password</label>
            <input className="form-control" type="password" required placeholder="Minimum 6 characters" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand" disabled={loading} style={{ width: '100%', padding: 12 }}>
              {loading ? '⏳ …' : 'Update password'}
            </button>
          </div>
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button type="button" className="link-btn" onClick={() => setTab('login')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}>← Back to sign in</button>
          </div>
        </form>
      )}

      {/* Real OTP Verification Modal (registration phone verify) */}
      {showOtpModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 16, maxWidth: 360, width: '100%', border: '1px solid var(--border-color)', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 800 }}>
              {tab === 'otp_login' ? '🔑 Verify & Sign In' : '📱 Verify Your Phone'}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Enter the 6-digit code sent to <strong style={{ color: 'var(--brand)' }}>{activeOtpDestination || regPhone || loginPhone}</strong>.
            </p>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <input className="form-control" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
                placeholder="Enter 6-digit OTP…" value={enteredOtp} onChange={e => setEnteredOtp(e.target.value)}
                style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px', fontWeight: 700 }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-brand" style={{ flex: 1 }} disabled={otpBusy} onClick={verifyOtp}>
                {otpBusy ? '⏳ …' : (tab === 'otp_login' ? 'Verify & Sign In' : 'Verify & Register')}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowOtpModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-muted mt-16" style={{ textAlign: 'center', marginTop: 20, fontSize: '0.75rem' }}>
        By continuing, you agree to our Terms of Service.
      </p>
    </div>
  );
}

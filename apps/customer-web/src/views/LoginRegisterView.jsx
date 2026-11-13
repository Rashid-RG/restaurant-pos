import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ShieldCheck, UtensilsCrossed, Bike, ShoppingBag, MapPin, LockKeyhole, Smartphone, ArrowRight, UserRoundPlus, ArrowLeft } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';
import { isSixDigitOtp, validRegistrationPassword } from '../utils/registration-validation.js';

const PHONE_RE = /^(?:\+94|0)7\d{8}$/;

export default function LoginRegisterView({ onSuccess, onBack, toast = () => {}, resetToken = null, onResetHandled }) {
  const { t, dict } = useLang();
  // tab: 'login' | 'register' | 'forgot' | 'reset'
  const [tab, setTab] = useState(resetToken ? 'reset' : 'login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, loginWithOtp, register } = useCustomerAuth();

  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Register form
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regOtpChannel, setRegOtpChannel] = useState('email');
  const [authCapabilities,setAuthCapabilities] = useState({ emailOtp:false,smsOtp:false });

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
    apiFetch('/public/customer-auth-capabilities', { cache:'no-store' })
      .then(c => {
        const available={emailOtp:c?.emailOtp===true,smsOtp:c?.smsOtp===true};
        setAuthCapabilities(available);
        setRegOtpChannel(available.emailOtp?'email':available.smsOtp?'sms':'email');
      }).catch(() => setAuthCapabilities({emailOtp:false,smsOtp:false}));
  }, []);

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
    if (!validRegistrationPassword(regPassword)) { setError('Password must be 10–72 characters.'); return; }
    if (regPassword !== regConfirm) { setError('Passwords do not match.'); return; }

    if (!authCapabilities.emailOtp && !authCapabilities.smsOtp) {
      setError('Registration verification is unavailable. Contact GastroFlow support.');
      return;
    }
    if (!authCapabilities[regOtpChannel==='email'?'emailOtp':'smsOtp']) {
      setError('Select an available verification method.');
      return;
    }
    // Registration consumes its code once during account creation.
    if (!otpVerified) {
      setOtpBusy(true);
      setEnteredOtp('');
      const isEmailChannel = regOtpChannel === 'email';
      const dest = isEmailChannel ? regEmail.trim().toLowerCase() : cleanPhone;
      if (isEmailChannel && (!regEmail.trim() || !regEmail.includes('@'))) {
        setError('Please enter a valid email address for Email OTP.');
        setOtpBusy(false);
        return;
      }

      try {
        const r = await apiFetch('/otp/send', {
          method: 'POST',
          body: JSON.stringify({ channel: isEmailChannel ? 'email' : 'sms', destination: dest, purpose: 'phone_verify' })
        });
        setActiveOtpDestination(dest);
        toast(`If delivery succeeds, enter the code sent to ${dest}.`, 'info', 8000);
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
      await register(regName.trim(), regEmail.trim(), regPhone.trim(), regPassword, codeVal);
      setError('');
      onSuccess && onSuccess();
      return true;
    } catch (err) {
      setError(err.message || 'Registration failed. Please check the code and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    const dest = activeOtpDestination || loginPhone.trim();
    const codeVal = enteredOtp.trim();
    if (!isSixDigitOtp(codeVal)) {
      setError('Enter the six-digit code from your email or SMS.');
      return;
    }
    setError('');
    setOtpBusy(true);
    try {
      if (tab === 'register') {
        // Registration consumes the code at /customer/auth/register.
        // Calling /otp/verify first would consume it prematurely and fail signup.
        const registered = await doRegister(codeVal);
        if (registered) {
          setShowOtpModal(false);
          setEnteredOtp('');
        }
        return;
      }
      const result = await loginWithOtp(dest, codeVal);
      if (result.loggedIn && result.token) {
        setShowOtpModal(false);
        setEnteredOtp('');
        onSuccess && onSuccess();
      } else {
        toast('No account found for this restaurant. Please register.', 'warning');
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
    if (resetPassword.length < 10) { setError('New password must be at least 10 characters.'); return; }
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
    <div className="auth-page fade-in auth-reference-page" style={{ padding: '24px 16px' }}>
      {onBack && <button className="auth-reference-browse" type="button" onClick={onBack}><ArrowLeft size={15}/> Browse stores</button>}
      <div className="auth-logo auth-brand-hero auth-reference-hero" style={{ textAlign: 'center', marginBottom: 24 }}>
        <div className="auth-hero-brand"><div className="auth-brand-symbol"><UtensilsCrossed size={25} strokeWidth={2.2}/></div><div><h1>GastroFlow</h1><span>FOOD · ORDER · TRACK</span></div></div>
        <div className="auth-hero-art auth-hero-image" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}login-delivery-scene.svg`} alt="" decoding="async" />
        </div>
        <div className="auth-hero-intro"><h2>{tab === 'register' ? 'Join GastroFlow' : tab === 'login' ? <>Welcome Back <span aria-hidden="true">👋</span></> : 'Welcome to GastroFlow'}</h2><p>{tab === 'login' ? 'Log in to your GastroFlow account and order your favorite meals.' : subtitle}</p><span className="auth-secure-note"><ShieldCheck size={14}/> Secure customer ordering</span></div>
      </div>

      {tab !== 'login' && tab !== 'register' && <button type="button" className="auth-reference-back" onClick={() => setTab('login')}><ArrowLeft size={17}/> Back to login</button>}
      {(tab === 'login' || tab === 'register') && (
        <div className="auth-tabs auth-reference-tabs" style={{ display: 'flex', marginBottom: 20 }}>
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
        <form onSubmit={handleLogin} noValidate className="auth-reference-login-form">
          <div className="form-group">
            <label htmlFor="gastro-login-phone">Phone number</label>
            <div className="auth-reference-field"><Smartphone size={21} aria-hidden="true"/>
              <input id="gastro-login-phone" className="form-control" type="tel" autoComplete="tel" inputMode="tel" required placeholder="Phone number · 0771234567"
                value={loginPhone} onChange={e => setLoginPhone(e.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label htmlFor="gastro-login-password">Password</label>
            <div className="auth-reference-field auth-reference-password">
              <LockKeyhole size={21} aria-hidden="true"/>
              <input id="gastro-login-password" className="form-control" type={showPassword ? "text" : "password"} required autoComplete="current-password" placeholder="Password"
                value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={{ paddingRight: 40 }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  opacity: 0.8,
                  padding: 2
                }}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
              </button>
            </div>
          </div>
          <div className="auth-reference-forgot" style={{ marginTop: 8, textAlign: 'right' }}>
            <span className="auth-reference-security"><ShieldCheck size={15}/> Secure sign in</span>
            <button type="button" className="link-btn" onClick={() => setTab('forgot')}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              Forgot password?
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand auth-reference-submit" disabled={loading} style={{ width: '100%', padding: 12 }}>
              <span>{loading ? t('loading') : 'Log in'}</span><ArrowRight size={21} aria-hidden="true"/>
            </button>
          </div>

          {/* Quick OTP Login Option */}
          <div className="auth-reference-alternate" style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
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

      {tab === 'login' && <button type="button" className="auth-reference-register" onClick={() => setTab('register')}>
        <UserRoundPlus size={25} aria-hidden="true"/>
        <span><small>Create a new account</small><strong>Register with GastroFlow</strong></span>
        <ArrowRight size={22} aria-hidden="true"/>
      </button>}
      {tab === 'login' && (authCapabilities.emailOtp || authCapabilities.smsOtp) && <button type="button" className="auth-reference-otp-link" onClick={() => setTab('otp_login')}>Sign in with a verification code instead</button>}

      {tab === 'otp_login' && (authCapabilities.emailOtp || authCapabilities.smsOtp) && (
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
               if (!authCapabilities[channel==='email'?'emailOtp':'smsOtp']) {
                 setError('This verification method is not available. Use password sign-in.');
                 return;
               }
              setOtpBusy(true);
              try {
                const r = await apiFetch('/otp/send', {
                  method: 'POST',
                  body: JSON.stringify({ channel, destination: dest, purpose: 'login' })
                });
                setActiveOtpDestination(dest);
                toast(`If delivery succeeds, enter the code sent to ${dest}.`, 'info');
                setShowOtpModal(true);
              } catch (err) {
                if (err.message && (err.message.includes('No registered account') || err.message.includes('register your account') || err.message.includes('not found'))) {
                  toast('No registered account found with this phone/email. Redirecting to sign up...', 'info');
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
            <input
              className="form-control"
              type="email"
              placeholder="you@example.com"
              value={regEmail}
              onChange={e => {
                const val = e.target.value;
                setRegEmail(val);
                if (val.includes('@') && val.includes('.')) {
                  setRegOtpChannel('email');
                }
              }}
            />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Phone Number <span style={{ color: 'var(--brand)', fontWeight: 800 }}>*</span></label>
            <input className="form-control" type="text" inputMode="tel" placeholder="e.g. 0771234567" value={regPhone} onChange={e => setRegPhone(e.target.value)} required />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input className="form-control" type={showPassword ? "text" : "password"} required minLength={10} maxLength={72} autoComplete="new-password" aria-describedby="gf-registration-password-help" placeholder="Create a strong password" value={regPassword} onChange={e => setRegPassword(e.target.value)} style={{ paddingRight: 48 }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  opacity: 0.8,
                  padding: 2
                }}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? '👁️' : '🙈'}
              </button>
            </div>
            <div id="gf-registration-password-help" className={`gf-auth-password-hint ${validRegistrationPassword(regPassword) ? 'valid' : ''}`} role="status">
              {validRegistrationPassword(regPassword) ? '✓ Password length meets the requirement' : `At least 10 characters · ${regPassword.length}/10`}
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input className="form-control" type={showPassword ? "text" : "password"} required minLength={10} maxLength={72} autoComplete="new-password" placeholder="Re-enter password" value={regConfirm} onChange={e => setRegConfirm(e.target.value)} style={{ paddingRight: 48 }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  opacity: 0.8,
                  padding: 2
                }}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? '👁️' : '🙈'}
              </button>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-1)' }}>Verification Method:</label>
            <div className="customer-auth-methods" style={{display:'flex',gap:8,marginTop:6}}>
              {authCapabilities.smsOtp && <button type="button" className={`customer-auth-method ${regOtpChannel==='sms'?'selected':''}`}
                onClick={() => setRegOtpChannel('sms')}>📱 SMS code</button>}
              {authCapabilities.emailOtp && <button type="button" className={`customer-auth-method ${regOtpChannel==='email'?'selected':''}`}
                onClick={() => setRegOtpChannel('email')}>✉️ Email code</button>}
              {!authCapabilities.smsOtp && !authCapabilities.emailOtp &&
                <p role="status" className="customer-auth-unavailable">Registration is unavailable: no verification provider has been configured.</p>}
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-brand" disabled={loading || otpBusy || !validRegistrationPassword(regPassword) || regPassword !== regConfirm || (!authCapabilities.emailOtp && !authCapabilities.smsOtp)} style={{ width: '100%', padding: 12 }}>
              {loading || otpBusy ? '⏳ Processing…' : `🎉 ${dict.createAccount || 'Create Account'} (${regOtpChannel === 'email' ? 'Email OTP' : 'SMS OTP'})`}
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
            <input className="form-control" type="password" required placeholder="Minimum 10 characters" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
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

      {/* Accessible verification sheet — no code reflected outside its input. */}
      {showOtpModal && (
        <div className="gf-auth-otp-backdrop">
          <section className="gf-auth-otp-sheet" role="dialog" aria-modal="true" aria-labelledby="gf-auth-otp-title" aria-describedby="gf-auth-otp-description">
            <div className="gf-auth-otp-mark" aria-hidden="true"><ShieldCheck size={26}/></div>
            <div className="gf-auth-otp-eyebrow">{tab === 'register' ? 'ACCOUNT SECURITY · STEP 2 OF 2' : 'SECURE SIGN IN'}</div>
            <h2 id="gf-auth-otp-title">{tab === 'otp_login' ? 'Verify your sign in' : 'Verify your email or phone'}</h2>
            <p id="gf-auth-otp-description" className="gf-auth-otp-description">
              Enter the six-digit code sent to <strong>{activeOtpDestination || regPhone || loginPhone}</strong>.
            </p>
            {error && <div className="gf-auth-otp-error" role="alert">{error}</div>}
            <label className="gf-auth-otp-label" htmlFor="gf-auth-otp-code">Verification code</label>
            <input
              id="gf-auth-otp-code"
              className="form-control gf-auth-otp-code"
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              pattern="[0-9]{6}" required
              placeholder="000000" value={enteredOtp}
              onChange={e => { setEnteredOtp(e.target.value.replace(/[^0-9]/g, '').slice(0,6)); if(error) setError(''); }}
              aria-invalid={Boolean(error)}
              autoFocus
            />
            <p className="gf-auth-otp-help">Codes expire after 10 minutes. Check your inbox or spam folder.</p>
            <div className="gf-auth-otp-actions">
              <button type="button" className="btn btn-brand gf-auth-otp-primary" disabled={otpBusy || loading || enteredOtp.length !== 6} onClick={verifyOtp}>
                {otpBusy || loading ? 'Verifying…' : (tab === 'otp_login' ? 'Verify & sign in' : 'Verify & create account')}
              </button>
              <button type="button" className="btn gf-auth-otp-secondary" disabled={otpBusy || loading} onClick={() => {setShowOtpModal(false);setError('');}}>Back to details</button>
            </div>
            <p className="gf-auth-otp-privacy"><LockKeyhole size={14} aria-hidden="true"/> Your verification code is private and can only be used once.</p>
          </section>
        </div>
      )}

      <p className="text-center text-muted mt-16" style={{ textAlign: 'center', marginTop: 20, fontSize: '0.75rem' }}>
        By continuing, you agree to our Terms of Service.
      </p>
    </div>
  );
}

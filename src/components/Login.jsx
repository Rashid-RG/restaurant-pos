import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function Login() {
  const { login } = usePOS();
  const [view, setView] = useState('login'); // 'login' | 'forgot' | 'reset'

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password state
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');

  // Reset password state
  const [resetToken, setResetToken] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetUsername, setResetUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');

  // Feedback states
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Check for URL query param `?reset=<token>` on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (token) {
      setResetToken(token);
      setView('reset');
    }
  }, []);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please fill in all fields.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await login(username, password);
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!forgotUsername) {
      setError('Please enter your staff username.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setForgotMessage('');
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process request.');
      setForgotMessage(data.message || 'If that account exists, a reset code/email has been sent.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setResetSuccessMsg('');
      const payload = { newPassword };
      if (resetToken) {
        payload.token = resetToken;
      } else {
        payload.username = resetUsername;
        payload.code = resetCode;
      }

      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed.');

      setResetSuccessMsg(data.message || 'Password updated successfully! You can now sign in.');
      setTimeout(() => {
        setView('login');
        setError('');
        setResetSuccessMsg('');
      }, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, var(--bg-app) 0%, var(--bg-surface) 100%)',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 9999
    }}>
      <div className="login-card glass" style={{
        width: '100%',
        maxWidth: '420px',
        padding: '40px',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            display: 'inline-flex',
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, var(--color-primary), hsl(265, 89%, 60%))',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            marginBottom: '16px',
            boxShadow: 'var(--shadow-glow)'
          }}>
            🍕
          </div>
          <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, fontSize: '24px', margin: 0 }}>
            {view === 'login' && 'GastroFlow Terminal'}
            {view === 'forgot' && 'Staff Password Recovery'}
            {view === 'reset' && 'Set New Password'}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '6px' }}>
            {view === 'login' && 'Sign in to access the POS terminal'}
            {view === 'forgot' && 'Request a reset code or email link'}
            {view === 'reset' && 'Enter your reset token/code and new password'}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: 'var(--color-danger-light, rgba(239, 68, 68, 0.1))',
            color: 'var(--color-danger, #ef4444)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 500,
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Success Alert */}
        {resetSuccessMsg && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            color: '#22c55e',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 500,
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            ✅ {resetSuccessMsg}
          </div>
        )}

        {/* VIEW 1: SIGN IN */}
        {view === 'login' && (
          <form onSubmit={handleLoginSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="form-input"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: '24px' }}>
              <button
                type="button"
                onClick={() => { setView('forgot'); setError(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary, #6366f1)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 16px', height: '48px', fontSize: '15px' }}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner" style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#fff', display: 'inline-block' }}></span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        )}

        {/* VIEW 2: FORGOT PASSWORD */}
        {view === 'forgot' && (
          <div>
            {forgotMessage ? (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{
                  background: 'rgba(99, 102, 241, 0.1)',
                  color: 'var(--color-primary, #6366f1)',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  marginBottom: '20px'
                }}>
                  📩 {forgotMessage}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', marginBottom: '12px' }}
                  onClick={() => { setView('reset'); setError(''); }}
                >
                  Enter Reset Code / New Password
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit}>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label htmlFor="forgotUsername">Staff Username</label>
                  <input
                    id="forgotUsername"
                    type="text"
                    className="form-input"
                    placeholder="Enter your username"
                    value={forgotUsername}
                    onChange={(e) => setForgotUsername(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px 16px', height: '48px', fontSize: '15px', marginBottom: '12px' }}
                  disabled={loading}
                >
                  {loading ? 'Sending Request...' : 'Send Reset Request'}
                </button>
              </form>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '12px' }}>
              <button
                type="button"
                onClick={() => { setView('login'); setError(''); setForgotMessage(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ← Back to Login
              </button>
              <button
                type="button"
                onClick={() => { setView('reset'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary, #6366f1)', fontWeight: 600, cursor: 'pointer' }}
              >
                I have a reset code →
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: RESET PASSWORD */}
        {view === 'reset' && (
          <form onSubmit={handleResetSubmit}>
            {resetToken ? (
              <div style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.05)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '16px'
              }}>
                🔑 Using Reset Token from Link
              </div>
            ) : (
              <>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label htmlFor="resetUsername">Staff Username</label>
                  <input
                    id="resetUsername"
                    type="text"
                    className="form-input"
                    placeholder="Enter username"
                    value={resetUsername}
                    onChange={(e) => setResetUsername(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label htmlFor="resetCode">6-Digit Reset Code</label>
                  <input
                    id="resetCode"
                    type="text"
                    className="form-input"
                    placeholder="e.g. 123456"
                    maxLength={6}
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </>
            )}

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                className="form-input"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                className="form-input"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 16px', height: '48px', fontSize: '15px', marginBottom: '12px' }}
              disabled={loading}
            >
              {loading ? 'Updating Password...' : 'Update Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '12px' }}>
              <button
                type="button"
                onClick={() => { setView('login'); setError(''); setResetToken(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ← Cancel & Return to Login
              </button>
            </div>
          </form>
        )}

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          Default Credentials: <strong>admin</strong> / <strong>admin123</strong>
        </div>
      </div>
    </div>
  );
}

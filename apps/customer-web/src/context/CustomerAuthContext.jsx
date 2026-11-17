import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { getActiveTenant } from '../utils/tenant.js';
import { shouldForgetCustomerSession } from '../utils/auth-recovery.js';
import { customerSessionKey, isCurrentCustomerAuthAttempt } from '../utils/customer-auth-scope.js';

const CustomerAuthContext = createContext(null);

export function CustomerAuthProvider({ children }) {
  // App keys this provider by restaurant. Capture the session scope on mount
  // instead of recomputing it after an old async request finishes.
  const scopeRef = useRef({ tenant: getActiveTenant(), epoch: 0, mounted: true });
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionKey = customerSessionKey(scopeRef.current.tenant);
  const isCurrent = (epoch) => isCurrentCustomerAuthAttempt({
    scope: scopeRef.current, activeTenant: getActiveTenant(), epoch
  });

  // Restore the saved login only for the restaurant that created this provider.
  useEffect(() => {
    scopeRef.current.mounted = true;
    const epoch = scopeRef.current.epoch;
    const token = localStorage.getItem(sessionKey);
    if (!token) { setLoading(false); return () => { scopeRef.current.mounted = false; }; }
    apiFetch('/customer/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(data => {
        if (!isCurrent(epoch)) return;
        if (data) setCustomer(data);
        else if (localStorage.getItem(sessionKey) === token) localStorage.removeItem(sessionKey);
      })
      .catch(error => {
        if (isCurrent(epoch) && shouldForgetCustomerSession(error) &&
            localStorage.getItem(sessionKey) === token) localStorage.removeItem(sessionKey);
      })
      .finally(() => { if (isCurrent(epoch)) setLoading(false); });
    return () => { scopeRef.current.mounted = false; scopeRef.current.epoch++; };
  }, [sessionKey]);

  const commitCustomerSession = (data,epoch) => {
    if (!isCurrent(epoch)) throw new Error('Restaurant changed. Please sign in again.');
    if (!data?.token || !data?.customer) throw new Error('Customer login response was incomplete.');
    localStorage.setItem(sessionKey, data.token);
    setCustomer(data.customer);
    return data.customer;
  };

  const login = useCallback(async (phone, password) => {
    const epoch = scopeRef.current.epoch;
    const data = await apiFetch('/customer/auth/login', {
      method: 'POST', body: JSON.stringify({ phone, password })
    });
    return commitCustomerSession(data,epoch);
  }, [sessionKey]);

  const register = useCallback(async (name, email, phone, password, otpCode) => {
    const epoch = scopeRef.current.epoch;
    const data = await apiFetch('/customer/auth/register', {
      method: 'POST', body: JSON.stringify({ name, email, phone, password, otpCode })
    });
    return commitCustomerSession(data,epoch);
  }, [sessionKey]);

  const loginWithOtp = useCallback(async (destination, code) => {
    const epoch = scopeRef.current.epoch;
    const data = await apiFetch('/otp/verify', {
      method: 'POST', body: JSON.stringify({ destination, code })
    });
    if (!isCurrent(epoch)) throw new Error('Restaurant changed. Please sign in again.');
    if (data.loggedIn && data.token) commitCustomerSession(data,epoch);
    return data;
  }, [sessionKey]);

  const logout = useCallback(() => {
    scopeRef.current.epoch++;
    localStorage.removeItem(sessionKey);
    setCustomer(null);
  }, [sessionKey]);

  const refreshProfile = useCallback(async () => {
    const epoch = scopeRef.current.epoch;
    const token = localStorage.getItem(sessionKey);
    if (!token) return;
    try {
      const data = await apiFetch('/customer/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (isCurrent(epoch) && localStorage.getItem(sessionKey) === token) setCustomer(data);
    } catch {}
  }, [sessionKey]);

  const getToken = () => localStorage.getItem(sessionKey);

  return (
    <CustomerAuthContext.Provider value={{ customer, loading, login, loginWithOtp, register, logout, refreshProfile, getToken }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(CustomerAuthContext);
}

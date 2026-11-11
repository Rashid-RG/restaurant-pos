import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';
import { getActiveTenant } from '../utils/tenant.js';

const CustomerAuthContext = createContext(null);
const tokenKey = () => 'gastroflow_customer_token:' + encodeURIComponent(getActiveTenant() || 'default_tenant');

export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(tokenKey());
    if (!token) { setLoading(false); return; }
    apiFetch('/customer/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(data => {
        if (data) setCustomer(data);
        else localStorage.removeItem(tokenKey());
      })
      .catch(() => localStorage.removeItem(tokenKey()))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone, password) => {
    const data = await apiFetch('/customer/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });
    localStorage.setItem(tokenKey(), data.token);
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const register = useCallback(async (name, email, phone, password, otpCode) => {
    const data = await apiFetch('/customer/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password, otpCode })
    });
    localStorage.setItem(tokenKey(), data.token);
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const loginWithOtp = useCallback(async (destination, code) => {
    const data = await apiFetch('/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ destination, code })
    });
    if (data.loggedIn && data.token) {
      localStorage.setItem(tokenKey(), data.token);
      setCustomer(data.customer);
    }
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(tokenKey());
    setCustomer(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem(tokenKey());
    if (!token) return;
    try {
      const data = await apiFetch('/customer/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCustomer(data);
    } catch {}
  }, []);

  const getToken = () => localStorage.getItem(tokenKey());

  return (
    <CustomerAuthContext.Provider value={{ customer, loading, login, loginWithOtp, register, logout, refreshProfile, getToken }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(CustomerAuthContext);
}

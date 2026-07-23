import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

const CustomerAuthContext = createContext(null);
const TOKEN_KEY = 'gastroflow_customer_token';

export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }
    apiFetch('/customer/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(data => {
        if (data) setCustomer(data);
        else localStorage.removeItem(TOKEN_KEY);
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone, password) => {
    const data = await apiFetch('/customer/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const register = useCallback(async (name, email, phone, password, otpCode) => {
    const data = await apiFetch('/customer/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password, otpCode })
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const loginWithOtp = useCallback(async (destination, code) => {
    const data = await apiFetch('/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ destination, code })
    });
    if (data.loggedIn && data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setCustomer(data.customer);
    }
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setCustomer(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const data = await apiFetch('/customer/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCustomer(data);
    } catch {}
  }, []);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  return (
    <CustomerAuthContext.Provider value={{ customer, loading, login, loginWithOtp, register, logout, refreshProfile, getToken }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(CustomerAuthContext);
}

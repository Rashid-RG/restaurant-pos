import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { getActiveTenant } from '../utils/tenant.js';
import { shouldForgetCustomerSession } from '../utils/auth-recovery.js';
import { customerSessionKey, isCurrentCustomerAuthAttempt } from '../utils/customer-auth-scope.js';
import { shouldRevalidateNativeCustomerSession, isCurrentNativeSessionCheck } from '../utils/native-session-revalidation.js';

const CustomerAuthContext = createContext(null);

export function CustomerAuthProvider({ children }) {
  // App keys this provider by restaurant. Capture the session scope on mount
  // instead of recomputing it after an old async request finishes.
  const scopeRef = useRef({ tenant: getActiveTenant(), epoch: 0, mounted: true });
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionCheckRef = useRef({lastCheckedAt:Date.now(),inFlight:false});
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

  // Packaged Android and iPhone WebViews can keep a screen suspended for
  // hours. Revalidate the original tenant-scoped session when foregrounded,
  // without logging out on a network outage or racing with a newer login.
  useEffect(() => {
    if (import.meta.env.MODE !== 'native') return;
    let disposed=false;
    const check=async()=>{
      const token=localStorage.getItem(sessionKey);
      const now=Date.now();
      const state=sessionCheckRef.current;
      if(!shouldRevalidateNativeCustomerSession({
        nativeBuild:true,token,
        visible:document.visibilityState!=='hidden',
        online:navigator.onLine!==false,now,
        lastCheckedAt:state.lastCheckedAt,inFlight:state.inFlight
      }))return;
      const epoch=scopeRef.current.epoch;
      state.inFlight=true;
      state.lastCheckedAt=now;
      try{
        const data=await apiFetch('/customer/auth/me',{
          headers:{Authorization:`Bearer ${token}`}
        });
        if(disposed || !isCurrentNativeSessionCheck({
          activeTenant:getActiveTenant(),tenant:scopeRef.current.tenant,
          token,savedToken:localStorage.getItem(sessionKey),epoch,
          currentEpoch:scopeRef.current.epoch,mounted:scopeRef.current.mounted
        }))return;
        if(data)setCustomer(data);
      }catch(error){
        if(disposed || !shouldForgetCustomerSession(error) ||
          !isCurrentNativeSessionCheck({
            activeTenant:getActiveTenant(),tenant:scopeRef.current.tenant,
            token,savedToken:localStorage.getItem(sessionKey),epoch,
            currentEpoch:scopeRef.current.epoch,mounted:scopeRef.current.mounted
          }))return;
        localStorage.removeItem(sessionKey);
        setCustomer(null);
      }finally{state.inFlight=false;}
    };
    document.addEventListener('visibilitychange',check);
    window.addEventListener('focus',check);
    window.addEventListener('pageshow',check);
    window.addEventListener('online',check);
    return()=>{
      disposed=true;
      document.removeEventListener('visibilitychange',check);
      window.removeEventListener('focus',check);
      window.removeEventListener('pageshow',check);
      window.removeEventListener('online',check);
    };
  },[sessionKey]);

  const commitCustomerSession = (data,epoch) => {
    if (!isCurrent(epoch)) throw new Error('Restaurant changed. Please sign in again.');
    if (!data?.token || !data?.customer) throw new Error('Customer login response was incomplete.');
    // Explicit login supersedes an earlier auto-restore or profile refresh.
    scopeRef.current.epoch++;
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

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { getActiveTenant } from '../utils/tenant.js';
import { shouldForgetCustomerSession } from '../utils/auth-recovery.js';
import { isCurrentCustomerAuthAttempt } from '../utils/customer-auth-scope.js';
import { readCustomerSessionToken, saveCustomerSessionToken, clearCustomerSessionToken, clearCustomerSessionTokenIfMatch } from '../utils/customer-session-store.js';
import { shouldRevalidateNativeCustomerSession, isCurrentNativeSessionCheck } from '../utils/native-session-revalidation.js';

const CustomerAuthContext = createContext(null);

export function CustomerAuthProvider({ children }) {
  // App keys this provider by restaurant. Capture the session scope on mount
  // instead of recomputing it after an old async request finishes.
  const scopeRef = useRef({ tenant: getActiveTenant(), epoch: 0, mounted: true });
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionCheckRef = useRef({lastCheckedAt:Date.now(),inFlight:false});
  const sessionTenant = scopeRef.current.tenant;
  const sessionKey = sessionTenant; // Stable tenant identifier for effect dependencies.
  const isCurrent = (epoch) => isCurrentCustomerAuthAttempt({
    scope: scopeRef.current, activeTenant: getActiveTenant(), epoch
  });

  // Restore the saved login only for the restaurant that created this provider.
  useEffect(() => {
    scopeRef.current.mounted = true;
    const epoch = scopeRef.current.epoch;
    const token = readCustomerSessionToken(sessionTenant);
    if (!token) { setLoading(false); return () => { scopeRef.current.mounted = false; }; }
    apiFetch('/customer/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(data => {
        if (!isCurrent(epoch)) return;
        if (data) setCustomer(data);
        else clearCustomerSessionTokenIfMatch(sessionTenant, token);
      })
      .catch(error => {
        if (isCurrent(epoch) && shouldForgetCustomerSession(error) &&
            readCustomerSessionToken(sessionTenant) === token) clearCustomerSessionTokenIfMatch(sessionTenant,token);
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
      const token=readCustomerSessionToken(sessionTenant);
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
          token,savedToken:readCustomerSessionToken(sessionTenant),epoch,
          currentEpoch:scopeRef.current.epoch,mounted:scopeRef.current.mounted
        }))return;
        if(data)setCustomer(data);
      }catch(error){
        if(disposed || !shouldForgetCustomerSession(error) ||
          !isCurrentNativeSessionCheck({
            activeTenant:getActiveTenant(),tenant:scopeRef.current.tenant,
            // apiFetch may already have removed this exact token on a verified
            // revoked-session response. Epoch still prevents a prior logout or
            // login from being overwritten, and a newer token never matches.
            token,savedToken:readCustomerSessionToken(sessionTenant) ?? token,epoch,
            currentEpoch:scopeRef.current.epoch,mounted:scopeRef.current.mounted
          }))return;
        if(!clearCustomerSessionTokenIfMatch(sessionTenant,token) && readCustomerSessionToken(sessionTenant)!==null)return;
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
    saveCustomerSessionToken(sessionTenant, data.token);
    setCustomer(data.customer);
    // A newer explicit login must finish bootstrap even when an older
    // restoration request is discarded by the epoch guard.
    setLoading(false);
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
    clearCustomerSessionToken(sessionTenant);
    setCustomer(null);
    // Logout also supersedes any in-flight restore; do not strand the shell
    // in its initial loading state when that stale request resolves.
    setLoading(false);
  }, [sessionKey]);

  const refreshProfile = useCallback(async () => {
    const epoch = scopeRef.current.epoch;
    const token = readCustomerSessionToken(sessionTenant);
    if (!token) return;
    try {
      const data = await apiFetch('/customer/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (isCurrent(epoch) && readCustomerSessionToken(sessionTenant) === token) setCustomer(data);
    } catch {}
  }, [sessionKey]);

  const getToken = () => readCustomerSessionToken(sessionTenant);

  return (
    <CustomerAuthContext.Provider value={{ customer, loading, login, loginWithOtp, register, logout, refreshProfile, getToken }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(CustomerAuthContext);
}

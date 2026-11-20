import React, {useEffect,useState} from 'react';
import {usePOS} from '../context/POSContext';
import {
  eligibleStagingOwner,enrollStagingOwnerPush,revokeStagingOwnerPush,syncRotatedStagingOwnerToken
} from '../utils/staging-fcm-enrollment';

/**
 * Explicit owner opt-in on the dedicated GastroFlow staging native wrapper.
 * Does not display or persist raw Firebase device registration tokens.
 * No notifications are sent by this component.
 */
export default function StagingPushSetup() {
  const {currentUser}=usePOS();
  const [pending,setPending]=useState(false);
  const [registered,setRegistered]=useState(false);
  const [status,setStatus]=useState('');
  const capacitor=typeof window!=='undefined'?window.Capacitor:null;
  const eligible=eligibleStagingOwner(currentUser,capacitor,
    typeof window==='undefined'?'':window.location.origin);
  const ownerId=currentUser?.id,tenantId=currentUser?.tenant_id;

  // The native plugin emits tokenReceived when Firebase rotates a token.
  // A handler never opts in a new owner; only existing registered devices sync.
  useEffect(()=>{
    if(!eligible)return undefined;
    const messaging=capacitor.Plugins.FirebaseMessaging;
    if(typeof messaging?.addListener!=='function')return undefined;
    let cancelled=false;
    const pending=Promise.resolve().then(()=>messaging.addListener('tokenReceived',event=>{
      if(cancelled)return;
      void syncRotatedStagingOwnerToken({
        user:currentUser,capacitor,origin:window.location.origin,
        storage:window.localStorage,fetcher:window.fetch.bind(window),
        token:event?.token
      }).then(result=>{
        if(!cancelled && result.status==='synced')
          setStatus('This staging device registration was securely refreshed.');
      }).catch(()=>{});
    })).catch(()=>null);
    return ()=>{
      cancelled=true;
      void pending.then(handle=>handle?.remove?.()).catch(()=>{});
    };
  },[eligible,ownerId,tenantId]);

  if(!eligibleStagingOwner(currentUser,capacitor,
    typeof window==='undefined'?'':window.location.origin))return null;

  async function registerDevice(){
    setPending(true);
    setStatus('');
    try{
      const result=await enrollStagingOwnerPush({
        user:currentUser,capacitor,origin:window.location.origin,
        storage:window.localStorage,fetcher:window.fetch.bind(window)
      });
      setRegistered(Boolean(result.registered));
      setStatus(result.registered
        ?'This staging device is registered for owner push testing. No notification has been sent.'
        :'Permission denied. Enable notifications in your device settings before registering.');
    }catch(e){
      setRegistered(false);
      setStatus(e?.message||'Staging push registration could not be completed.');
    }finally{setPending(false)}
  }
  async function disableNotifications(){
    setPending(true);
    setStatus('');
    try{
      await revokeStagingOwnerPush({
        user:currentUser,storage:window.localStorage,fetcher:window.fetch.bind(window)
      });
      setRegistered(false);
      setStatus('Push consent withdrawn. Server-side device registrations have been revoked.');
    }catch(e){
      setStatus(e?.message||'Could not withdraw staging notification consent.');
    }finally{setPending(false)}
  }

  return (
    <details style={{margin:'8px 12px',border:'1px solid var(--border-color,#ddd)',
      borderRadius:10,padding:'8px 12px'}}>
      <summary style={{cursor:'pointer',fontWeight:600}}>Staging notifications</summary>
      <p style={{fontSize:12,margin:'8px 0'}}>
        Restaurant-owner notifications on this test device only. Registration does not send a push.
      </p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" className="btn btn-outline" disabled={pending}
          onClick={registerDevice}>
          {pending?'Processing…':registered?'Refresh device registration':'Enable staging push'}
        </button>
        <button type="button" className="btn btn-outline" disabled={pending}
          onClick={disableNotifications}>Disable notifications</button>
      </div>
      {status&&<p role="status" style={{fontSize:12,margin:'8px 0 0'}}>{status}</p>}
      <small style={{display:'block',marginTop:8}}>
        Firebase token values are never displayed. Live sending and delivery verification remain off.
      </small>
    </details>
  );
}

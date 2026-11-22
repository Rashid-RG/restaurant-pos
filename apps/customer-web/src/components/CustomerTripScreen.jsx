import React, {useEffect, useRef, useState} from 'react';
import {Motorbike, CircleHelp, Phone, UserRound, X} from 'lucide-react';
import TrackingMap from './TrackingMap.jsx';
import './customer-trip-screen.css';

export default function CustomerTripScreen({store,dest,driver,route,gpsState,order,step,index,steps,
  assigned,riderName,contact,arrival,late,chatOpen,onDetails,onHelp,onMessage}) {
  const dialog=useRef(null);
  const [open,setOpen]=useState(true);
  useEffect(()=>{
    if(!open)return;
    const node=dialog.current;
    node.showModal();
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return ()=>{node.close();document.body.style.overflow=overflow;};
  },[open]);

  const returnFromChat=useRef(false);
  useEffect(()=>{
    if(!chatOpen && returnFromChat.current){
      returnFromChat.current=false;
      setOpen(true);
    }
  },[chatOpen]);
  const exit=action=>{setOpen(false);action?.();};
  const pickup=assigned && step.id==='ready';
  const title=pickup?'Picking up your order…':step.label;
  const vehicle=[order.driver?.vehicleType,order.driver?.plateNumber].filter(Boolean).join(' · ');
  const photoCandidate=order.driver?.profilePhotoUrl || order.driver?.avatarUrl || order.driver?.photoUrl || '';
  const riderPhoto=assigned && /^https:\/\//i.test(photoCandidate) ? photoCandidate : '';
  const [photoFailed,setPhotoFailed]=useState(false);
  return <>
    <button type="button" className="gf-journey-map-toggle" onClick={()=>setOpen(true)}>View live delivery map</button>
    {open && <dialog ref={dialog} className="gf-trip-screen" aria-label="Live delivery tracking"
      onCancel={event=>{event.preventDefault();setOpen(false);}}>
      <div className="gf-trip-layout">
        <div className="gf-trip-map">
          <TrackingMap store={store} dest={dest} driver={driver} route={route} gpsState={gpsState}/>
          <button type="button" className="gf-trip-close" aria-label="Close delivery map" onClick={()=>exit()}><X size={19}/></button>
          <button type="button" className="gf-trip-help" onClick={()=>exit(onHelp)}><CircleHelp size={15}/> Help</button>
        </div>
        <section className="gf-trip-panel">
          <h2>{title}</h2>
          <p className="gf-trip-eta">{arrival || (late?'Awaiting a revised arrival time':'Waiting for an arrival estimate')}</p>
          <div className="gf-trip-progress" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index+1}>
            {steps.map((s,i)=><span key={s.id} data-reached={i<=index} data-current={i===index && index<steps.length-1}/>)}
          </div>
          <p className="gf-trip-note">{late?'Your order is taking longer than estimated.':step.description+'.'} {' '}
            <button type="button" onClick={()=>exit(onDetails)}>Learn more</button>
          </p>
          <div className="gf-trip-rider">
            <span className="gf-trip-portrait" aria-hidden="true">{riderPhoto && !photoFailed ? <img src={riderPhoto} alt="" onError={()=>setPhotoFailed(true)}/> : <UserRound size={27}/>}</span>
            <span className="gf-trip-bike" aria-hidden="true"><Motorbike size={34}/></span>
            <div><strong>{assigned?riderName:'Finding your delivery rider'}</strong>{assigned && vehicle && <small>{vehicle}</small>}{!assigned && <small>Rider details appear after assignment</small>}{assigned && !vehicle && <small>Vehicle details not provided</small>}</div>
          </div>
          <div className="gf-trip-contacts">
            {contact?.tel?<a href={contact.tel} aria-label="Call rider"><Phone size={17}/></a>:<button disabled aria-label="Rider phone unavailable"><Phone size={17}/></button>}
            <button type="button" disabled={!assigned} onClick={()=>{returnFromChat.current=true;exit(onMessage);}}>Send a message</button>
          </div>
        </section>
      </div>
    </dialog>}
  </>;
}

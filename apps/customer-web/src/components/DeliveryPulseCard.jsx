import React from 'react';
import {deliveryPulseState} from '../utils/delivery-pulse.js';
import './DeliveryPulseCard.css';

// A compact status summary, not a fake moving-rider simulation.
// The parent supplies tenant-authorized order status and GPS freshness.
export default function DeliveryPulseCard({status,assigned=false,gpsState='waiting',etaMinutes=null,onMessage=null}) {
  const model=deliveryPulseState({status,assigned,gpsState,etaMinutes});
  const search=model.id==='searching';
  const stages=['Finding','Assigned','On the way','Arrived'];
  return <section className={`gf-delivery-pulse gf-delivery-pulse--${model.id}`}
    aria-label="Delivery partner status" data-testid="delivery-pulse">
    <div className="gf-delivery-pulse__icon" aria-hidden="true">
      {search?<span className="gf-delivery-pulse__search">⌖</span>:<span>{model.icon}</span>}
      <span className="gf-delivery-pulse__icon-orbit"/>
    </div>
    <div className="gf-delivery-pulse__main">
      <div className="gf-delivery-pulse__top">
        <span className="gf-delivery-pulse__eyebrow"><span className="gf-delivery-pulse__dot"/>{model.eyebrow}</span>
        {model.eta!==null&&<span className="gf-delivery-pulse__eta" aria-label={`Estimated overall delivery time ${model.eta} minutes`}>≈ {model.eta} min <small>estimate</small></span>}
      </div>
      <h3>{model.title}</h3>
      <p>{model.description}</p>
      <div className="gf-delivery-pulse__footer">
        <div className="gf-delivery-pulse__rail" role="img" aria-label={`Delivery phase: ${model.detail}`}>
          {stages.map((label,i)=><span key={label} title={label}
            className={i<model.step?'is-done':i===model.step?'is-current':''}/>)}
        </div>
        <span className="gf-delivery-pulse__detail">{model.detail}</span>
        {assigned && typeof onMessage==='function' && !['arrived','delivered'].includes(model.id) &&
          <button type="button" onClick={onMessage} className="gf-delivery-pulse__message">Message</button>}
      </div>
    </div>
  </section>;
}

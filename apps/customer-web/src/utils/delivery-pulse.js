// Presentation only: all stages derive from the authenticated order and
// dispatch response. Never infer a courier's movement from assignment alone.
export function deliveryPulseState({status='',assigned=false,gpsState='waiting',etaMinutes=null}={}) {
  const stage=String(status).toLowerCase();
  const minutes=Number(etaMinutes);
  const eta=etaMinutes!==null && etaMinutes!=='' && Number.isFinite(minutes) && minutes>0 && minutes<=1440
    ? Math.ceil(minutes) : null;
  const gpsFresh=gpsState==='fresh';
  if(stage==='delivered'||stage==='completed')return {
    id:'delivered',eyebrow:'DELIVERY COMPLETE',title:'Your order has arrived',
    description:'Delivery is confirmed. Thank you for ordering.',
    detail:'Delivered',icon:'✓',eta:null,step:4
  };
  if(stage==='arrived')return {
    id:'arrived',eyebrow:'RIDER ARRIVED',title:'Your rider has arrived',
    description:'Please meet your rider and verify the delivery handover.',
    detail:gpsFresh?'GPS recently updated':'Arrival reported by rider',icon:'📍',eta:null,step:3
  };
  if(stage==='out_for_delivery')return {
    id:'transit',eyebrow:'ON THE WAY',title:'Your food is heading to you',
    description:gpsFresh?'Follow the rider’s latest confirmed position on the map.':'Waiting for a fresh rider GPS update.',
    detail:gpsFresh?'Rider GPS available':'Rider location not live',icon:'🛵',eta,step:2
  };
  if(stage==='picked_up')return {
    id:'picked-up',eyebrow:'ORDER COLLECTED',title:'Your rider has picked up the food',
    description:'The restaurant confirmed pickup. Departure updates will appear here.',
    detail:gpsFresh?'Rider GPS available':'Waiting for rider GPS',icon:'📦',eta,step:2
  };
  if(assigned)return {
    id:'assigned',eyebrow:'RIDER ASSIGNED',title:'Your delivery partner is assigned',
    description:'Your rider will collect the food when it is ready.',
    detail:'Assignment confirmed',icon:'🛵',eta,step:1
  };
  return {
    id:'searching',eyebrow:'FINDING A RIDER',title:'Looking for a delivery partner',
    description:'We’ll show the assignment as soon as the restaurant confirms a rider.',
    detail:'Awaiting assignment',icon:'◌',eta,step:0
  };
}

// Scheduling is capacity-constrained per restaurant, order type and 15-minute slot.
// This is a reservation of kitchen capacity, not a restaurant table reservation.
export const SLOT_MS=15*60*1000;
export function validateSchedule(timestamp,now=Date.now(),prepMinutes=30) {
  if(timestamp===null || timestamp===undefined || timestamp==='')return {valid:true,scheduled:false};
  const when=Number(timestamp);
  if(!Number.isSafeInteger(when)||when%SLOT_MS!==0)return {valid:false,error:'Select a valid 15-minute scheduling slot.'};
  if(when<now+Math.max(15,Number(prepMinutes)||30)*60000)return {valid:false,error:'This time is too soon. Please choose a later slot.'};
  if(when>now+7*86400000)return {valid:false,error:'Orders may be scheduled up to seven days ahead.'};
  return {valid:true,scheduled:true,when};
}
export function scheduleCapacity(value) {
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=1&&n<=100 ? n : 6;
}
export function slotsFrom(start,count=32) {
  const first=Math.ceil(start/SLOT_MS)*SLOT_MS;
  return Array.from({length:count},(_,i)=>first+i*SLOT_MS);
}

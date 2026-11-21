import React, {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {readDeliveryZones} from '../../lib/delivery/zones.js';
import {restaurantPickupPin} from '../../lib/delivery/geo-distance.js';

export default function DeliveryZoneEditor({settings,updateSetting}) {
  const [open,setOpen]=useState(false),[zones,setZones]=useState([]),[corners,setCorners]=useState([]);
  const [kind,setKind]=useState('include'),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const el=useRef(null),map=useRef(null),layers=useRef(null),origin=restaurantPickupPin(settings);
  useEffect(()=>{
    if(!open)return;
    const view=L.map(el.current).setView(origin?[origin.lat,origin.lng]:[7.8,80.7],origin?14:7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(view);
    layers.current=L.layerGroup().addTo(view);map.current=view;
    view.on('click',e=>setCorners(prev=>prev.length<100?[...prev,[e.latlng.lng,e.latlng.lat]]:prev));
    return ()=>{view.remove();map.current=null;};
  },[open]);
  useEffect(()=>{
    if(!open || !map.current)return;
    const group=layers.current;group.clearLayers();
    if(origin)L.circleMarker([origin.lat,origin.lng],{radius:5,color:'#222'}).bindTooltip('Pickup').addTo(group);
    for(const z of zones)L.polygon(z.points.map(([x,y])=>[y,x]),{color:z.kind==='include'?'#07834f':'#bf3941',interactive:false}).addTo(group);
    const pts=corners.map(([x,y])=>[y,x]);
    if(pts.length)L.polyline(pts,{dashArray:'5 4',interactive:false}).addTo(group);
    for(const pt of pts)L.circleMarker(pt,{radius:3,interactive:false}).addTo(group);
  },[open,zones,corners,origin?.lat,origin?.lng]);

  function edit() {
    try {setZones(readDeliveryZones(settings.deliveryZones));setCorners([]);setMessage('');setOpen(true);}
    catch(error){setMessage(error.message);}
  }
  function add() {
    try {const updated=readDeliveryZones([...zones,{kind,points:corners}]);setZones(updated);setCorners([]);setMessage('');}
    catch(error){setMessage(error.message);}
  }
  async function save() {
    setSaving(true);
    try {await updateSetting('deliveryZones',JSON.stringify(zones));setOpen(false);setMessage('Delivery areas saved.');}
    catch(error){setMessage(error.message);}finally{setSaving(false);}
  }
  return <section style={{padding:16,border:'1px solid var(--border-color)',borderRadius:12}}>
    <h4>Delivery areas and exclusions</h4>
    {!open?<button type="button" className="btn btn-secondary" onClick={edit}>Edit delivery areas</button>:<>
      <p>Tap the corners of an area in order, then add it. Exclusions take priority. The distance limit still applies.</p>
      <div ref={el} aria-label="Draw delivery area" style={{height:260}} />
      <fieldset disabled={saving}><label>Area type <select value={kind} onChange={e=>setKind(e.target.value)}><option value="include">Delivery area</option><option value="exclude">Excluded area</option></select></label>
      <button type="button" disabled={!corners.length} onClick={()=>setCorners(c=>c.slice(0,-1))}>Undo corner</button>
      <button type="button" disabled={corners.length<3} onClick={add}>Add area ({corners.length} corners)</button>
      <ul>{zones.map((z,i)=><li key={i}>{z.kind==='include'?'Delivery':'Excluded'} area {i+1} · {z.points.length} corners <button type="button" onClick={()=>setZones(all=>all.filter((_,j)=>i!==j))}>Remove</button></li>)}</ul>
      <button type="button" className="btn btn-primary" disabled={!!corners.length} onClick={save}>Save areas</button>
      <button type="button" onClick={()=>{setOpen(false);setMessage('');}}>Cancel</button></fieldset></>}
    <p role="status">{message}</p>
  </section>;
}

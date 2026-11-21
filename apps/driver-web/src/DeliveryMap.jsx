import React,{useEffect,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function DeliveryMap({destination,fix,geometry}) {
  const container=useRef(null), map=useRef(null),rider=useRef(null),start=useRef(destination);
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let view;
    try {
      view=new maplibregl.Map({container:container.current,center:start.current,zoom:15,
        style:{version:8,sources:{streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}},
          layers:[{id:'streets',type:'raster',source:'streets'}]}});
      map.current=view;
      new maplibregl.Marker({color:'#a03d30'}).setLngLat(start.current).setPopup(new maplibregl.Popup().setText('Destination')).addTo(view);
      view.on('load',()=>setReady(true));
      view.addControl(new maplibregl.NavigationControl({showCompass:false}));
    }catch{setFailed(true);}
    return ()=>{view?.remove();map.current=null;rider.current=null;};
  },[]);
  useEffect(()=>{
    const view=map.current;
    if(!ready || !view)return;
    if(fix) {
      if(!rider.current)rider.current=new maplibregl.Marker({color:'#077755'}).setLngLat([fix.lng,fix.lat]).addTo(view);
      else rider.current.setLngLat([fix.lng,fix.lat]);
    }else {rider.current?.remove();rider.current=null;}
  },[ready,fix?.lat,fix?.lng]);
  useEffect(()=>{
    const view=map.current;if(!ready || !view)return;
    const source=view.getSource('road');
    const data={type:'FeatureCollection',features:geometry?[{type:'Feature',properties:{},geometry}]:[]};
    if(source)source.setData(data);
    else {view.addSource('road',{type:'geojson',data});view.addLayer({id:'road',type:'line',source:'road',paint:{'line-width':4,'line-color':'#1760af'}});}
    if(geometry){const bounds=new maplibregl.LngLatBounds();geometry.coordinates.forEach(c=>bounds.extend(c));view.fitBounds(bounds,{padding:45,maxZoom:16,duration:0});}
  },[ready,geometry]);
  return <div>{failed && <p>Map unavailable on this device. Use the navigation link.</p>}<div ref={container} aria-label="Delivery navigation map" style={{height:failed?0:260}}/></div>;
}

import React,{useEffect,useRef,useState} from 'react';
import {Camera} from 'lucide-react';
import './profile-photo.css';

async function thumbnail(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>12*1024*1024)
    throw Error('Choose a JPG, PNG or WebP photo under 12 MB.');
  const url=URL.createObjectURL(file);
  try {
    const img=new Image(); img.src=url; await img.decode();
    const side=Math.min(img.width,img.height);
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=320;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);
    ctx.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,320,320);
    return canvas.toDataURL('image/jpeg',.84);
  } finally {URL.revokeObjectURL(url);}
}

export default function ProfilePhoto({request,endpoint,name,token}){
  const input=useRef(null);
  const [photo,setPhoto]=useState(null),[busy,setBusy]=useState(true),[message,setMessage]=useState('');
  const headers=token?{Authorization:'Bearer '+token}:undefined;
  useEffect(()=>{
    let active=true;
    request(endpoint,{headers,cache:'no-store'}).then(data=>{if(active)setPhoto(data.photo);})
      .catch(()=>{if(active)setMessage('Could not load profile photo.');})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[request,endpoint,token]);
  const save=async(file)=>{
    setBusy(true);setMessage('');
    try {
      const photo=file?await thumbnail(file):null;
      await request(endpoint,{method:'PUT',headers,body:JSON.stringify({photo})});
      setPhoto(photo);setMessage(photo?'Photo saved':'Photo removed');
    }catch(error){setMessage(error.message || 'Could not save photo.');}
    finally{setBusy(false);}
  };
  return <div className="gf-profile-photo">
    <button type="button" aria-label={photo?'Change profile photo':'Add profile photo'} disabled={busy} onClick={()=>input.current.click()}>
      {photo?<img src={photo} alt="Your profile"/>:<span>{(name||'?').trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()}</span>}
      <i aria-hidden="true"><Camera size={15}/></i>
    </button>
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)save(file);}}/>
    {photo&&<button className="gf-photo-remove" type="button" disabled={busy} onClick={()=>save(null)}>Remove photo</button>}
    {message&&<small role="status">{message}</small>}
  </div>;
}

import React,{useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {MessageCircle,Send,X,Bike,ShieldCheck} from 'lucide-react';
import './RiderChatSheet.css';

// The customer rider chat is a true viewport-level dialog, not an element
// inside the long tracking-page scroll/transform container.
export default function RiderChatSheet({open,onClose,orderId,messages=[],message,onMessageChange,onSend,sending=false}){
  const dialogRef=useRef(null);
  const scrollRef=useRef(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const prior=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogRef.current?.focus();
    const onKey=event=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current?.();return;}
      if(event.key!=='Tab'||!dialogRef.current)return;
      const focusable=[...dialogRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled])')].filter(el=>el.getClientRects().length);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialogRef.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=previousOverflow;if(prior?.isConnected)prior.focus?.();};
  },[open]);
  useEffect(()=>{if(open&&scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[open,messages.length]);
  if(!open)return null;
  return createPortal(<div className="gf-rider-chat-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose?.();}}>
    <section ref={dialogRef} tabIndex={-1} className="gf-rider-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="gf-rider-chat-title">
      <div className="gf-rider-chat-handle" aria-hidden="true"/>
      <header className="gf-rider-chat-header">
        <div className="gf-rider-chat-avatar"><Bike size={24}/></div>
        <div className="gf-rider-chat-header-copy">
          <span className="gf-rider-chat-kicker"><span className="gf-rider-chat-status-dot"/> DELIVERY CHAT</span>
          <h2 id="gf-rider-chat-title">Message your rider</h2>
          <small>Order #{String(orderId||'').slice(-6).toUpperCase()} · In-app messages</small>
        </div>
        <button className="gf-rider-chat-close" type="button" aria-label="Close rider chat" onClick={onClose}><X size={21}/></button>
      </header>
      <div className="gf-rider-chat-privacy"><ShieldCheck size={15}/><span>Only share instructions relevant to your delivery.</span></div>
      <div className="gf-rider-chat-messages" ref={scrollRef} aria-label="Messages with delivery rider">
        {!messages.length?<div className="gf-rider-chat-empty"><MessageCircle size={35}/><strong>Start a conversation</strong><p>Ask your assigned rider a question or share a helpful delivery instruction.</p></div>:
          messages.map((msg,i)=><div className={`gf-rider-chat-message ${msg.senderType==='customer'?'is-mine':'is-rider'}`} key={msg.id||i}>
            <span className="gf-rider-chat-meta">{msg.senderType==='customer'?'You':msg.senderName||'Rider'} · {msg.createdAt?new Date(msg.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span>
            <div className="gf-rider-chat-bubble">{msg.message}</div>
          </div>)}
      </div>
      <form className="gf-rider-chat-compose" onSubmit={onSend}>
        <input aria-label="Message to rider" type="text" value={message} onChange={event=>onMessageChange(event.target.value)}
          placeholder="Write a message…" maxLength={1000} autoComplete="off"/>
        <button type="submit" disabled={sending||!String(message||'').trim()} aria-label={sending?'Sending message':'Send message'}><Send size={19}/></button>
      </form>
    </section>
  </div>,document.body);
}

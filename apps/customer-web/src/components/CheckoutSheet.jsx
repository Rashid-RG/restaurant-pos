import React,{useEffect,useId,useRef} from 'react';
import {createPortal} from 'react-dom';

/** Checkout-only modal bottom sheet. Does not submit its enclosing form. */
export default function CheckoutSheet({open,onClose,title,description,children}){
  const labelId=useId();
  const panelRef=useRef(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    if(!open||typeof document==='undefined')return;
    const previous=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    panelRef.current?.focus();
    const handleKey=event=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current?.();}
      if(event.key!=='Tab'||!panelRef.current)return;
      const focusable=[...panelRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(el=>el.getClientRects().length);
      if(!focusable.length){event.preventDefault();panelRef.current.focus();return;}
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panelRef.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handleKey);
    return ()=>{
      document.removeEventListener('keydown',handleKey);
      document.body.style.overflow=previousOverflow;
      if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();
    };
  },[open]);
  if(!open||typeof document==='undefined')return null;
  return createPortal(<div className="gf-checkout-sheet-backdrop"
    onMouseDown={event=>{if(event.target===event.currentTarget)onClose?.();}}>
    <section ref={panelRef} tabIndex={-1} className="gf-checkout-sheet" role="dialog" aria-modal="true" aria-labelledby={labelId}
      aria-describedby={description?labelId+'-description':undefined}>
      <div className="gf-checkout-sheet-handle" aria-hidden="true"/>
      <header className="gf-checkout-sheet-header">
        <div><h2 id={labelId}>{title}</h2>{description&&<p id={labelId+'-description'}>{description}</p>}</div>
        <button className="gf-checkout-sheet-close" type="button" onClick={onClose} aria-label={'Close '+title}>×</button>
      </header>
      <div className="gf-checkout-sheet-scroll">{children}</div>
      <footer className="gf-checkout-sheet-actions"><button type="button" className="gf-checkout-sheet-done" onClick={onClose}>Done</button></footer>
    </section>
  </div>,document.body);
}

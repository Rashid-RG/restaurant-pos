import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Bot, Mic, Send, Volume2, CircleHelp, Utensils, PackageCheck } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';
import { useCart } from '../context/CartContext.jsx';
import { isMenuItemAvailable, maxMenuItemQuantity } from '../utils/menu-selection.js';
import { getActiveTenant } from '../utils/tenant.js';
import { selectedDeliveryPin } from '../utils/restaurant-fulfilment.js';
import { prepareGastroBatch } from '../utils/gastromate-batch.js';
import { gastroVoiceLocale, gastroSpeechText, gastroVoiceForLocale } from '../utils/gastromate-voice.js';
import './gastromate-mascot.css';
import { isTrackingIntent, selectTrackableOrders, safeOrderChoice } from '../utils/gastromate-tracking.js';

function BurgerMascot({ small = false, active = false, speaking = false, celebrating = false }) {
  return <span className={`gastromate-burger ${small ? 'gastromate-burger-small' : ''} ${active ? 'gastromate-burger-active' : ''} ${speaking ? 'gastromate-burger-speaking' : ''} ${celebrating ? 'gastromate-burger-celebrate' : ''}`} aria-hidden="true">
    <span className="gastromate-burger-arm left">✦</span>
    <span className="gastromate-burger-body"><span className="gastromate-burger-face">•ᴗ•</span></span>
    <span className="gastromate-burger-arm right">✦</span>
    <span className="gastromate-burger-feet">⌣ ⌣</span>
    {!small && <span className="gastromate-hello">{speaking ? 'Speaking!' : celebrating ? 'Yay!' : active ? 'Thinking…' : 'Hi!'}</span>}
  </span>;
}

export default function GastroAiConcierge({ onNavigate, cartItems = [] }) {
  const { customer, getToken } = useCustomerAuth();
  const token = getToken?.();
  const { t, lang } = useLang();
  const { addItem, addVerifiedBatch, setCartOpen, items: liveCartItems } = useCart();
  
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'ai',
      text: "👋 **Hello & Welcome to GastroFlow!**\n\nI am **GastroMate AI**, your food discovery and order support companion.\n\nHow can I help you today?",
      suggestions: ['🍽️ Recommend Popular Meals', '🔍 Check Order Status', '🎧 Contact Human Support', '💡 Budget Combos']
    }
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [pendingBatch, setPendingBatch] = useState(null);
  const [addingItem, setAddingItem] = useState(false);
  const [pendingSupport, setPendingSupport] = useState(null);
  const [supportBusy, setSupportBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [trackingChoices, setTrackingChoices] = useState([]);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const trackRequestRef = useRef(0);
  const trackBusyRef = useRef(false);
  const [reveal, setReveal] = useState({ id: null, count: 0 });
  const latestMessage = messages[messages.length - 1];
  const isReplyAppearing = reveal.id === latestMessage?.id && reveal.count < String(latestMessage?.text || '').length;
  const isGastroAnimating = typing || trackingBusy || addingItem || isReplyAppearing;

  // Show a brief typewriter effect for new answers; never delay users who prefer reduced motion.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.sender !== 'ai' || last.id === 'welcome') return undefined;
    const answer = String(last.text || '');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReveal({ id: last.id, count: answer.length });
      return undefined;
    }
    let chars = 0;
    const step = Math.max(1, Math.ceil(answer.length / 75));
    setReveal({ id: last.id, count: 0 });
    const timer = window.setInterval(() => {
      chars = Math.min(answer.length, chars + step);
      setReveal({ id: last.id, count: chars });
      if (chars >= answer.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [messages]);

  // Guest Verification state for Human Support escalation
  const [verifyingGuest, setVerifyingGuest] = useState(false);
  const [guestContact, setGuestContact] = useState('');
  const [guestOtpCode, setGuestOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [pendingTicketText, setPendingTicketText] = useState('');

  const chatEndRef = useRef(null);
  const celebrationTimerRef = useRef(null);
  const speechRef = useRef(null);
  useEffect(() => () => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    window.speechSynthesis?.cancel?.();
  }, []);
  const celebrate = () => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    setCelebrating(true);
    celebrationTimerRef.current = window.setTimeout(() => setCelebrating(false), 1550);
  };

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typing, isOpen]);

  // Voice Input via Web Speech API
  const handleVoiceListen = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setMessages(prev => [...prev, {id: `voice_unavailable_${Date.now()}`,sender:'ai',text:'Voice recognition is not supported by this browser. Please type your question instead.'}]);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = gastroVoiceLocale(lang);

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setIsListening(false);
      setMessages(prev => [...prev, {id: `voice_error_${Date.now()}`,sender:'ai',text:'I could not hear that clearly. Please type your question or try again in a supported browser.'}]);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      sendMessage(transcript, true);
    };

    recognition.start();
  };

  // Text-to-Speech (TTS) Voice Readout Helper
  const speakText = (text) => {
    if (!('speechSynthesis' in window)) return;
    try {
      setSpeaking(false);
      window.speechSynthesis.cancel();
      const clean = gastroSpeechText(text);
      if (!clean) return;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      speechRef.current = utterance;
      utterance.lang = gastroVoiceLocale(lang, clean);
      const voice = gastroVoiceForLocale(window.speechSynthesis.getVoices(), utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (_) { setSpeaking(false); }
  };

  // Signed-in order discovery bypasses the LLM entirely. Never include
  // customer order IDs, location or status in AI chat prompts/history.
  const showMyOrders = async () => {
    if (trackBusyRef.current) return;
    const request = ++trackRequestRef.current;
    setPendingAdd(null);
    setPendingBatch(null);
    setPendingSupport(null);
    setTrackingChoices([]);
    if (!customer || !getToken?.()) {
      setMessages(prev => [...prev, { id: `track_signin_${Date.now()}`, sender: 'ai', text: 'Please sign in to securely see your orders. If you have a private order confirmation link, open its Track Order page instead.', suggestions: ['Sign In', 'Track Order Page'] }]);
      return;
    }
    const tenant = getActiveTenant();
    if (!tenant) {
      setMessages(prev => [...prev, { id: `track_store_${Date.now()}`, sender: 'ai', text: 'Please select the restaurant where you placed your order first.', suggestions: ['Browse Restaurants'] }]);
      return;
    }
    trackBusyRef.current = true;
    setTrackingBusy(true);
    try {
      const orders = await apiFetch('/customer/orders', { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      if (request !== trackRequestRef.current || tenant !== getActiveTenant()) return;
      const choices = selectTrackableOrders(orders);
      setTrackingChoices(choices);
      setMessages(prev => [...prev, { id: `track_list_${Date.now()}`, sender: 'ai', text: choices.length ? 'These are your recent orders for this restaurant. Select one below to open its secure tracking page.' : 'No recent orders found for your account at this restaurant. You can open a private tracking link from your order confirmation or contact support.', suggestions: choices.length ? [] : ['Track Order Page', 'Contact Human Support'] }]);
    } catch (error) {
      if (request !== trackRequestRef.current) return;
      setMessages(prev => [...prev, { id: `track_error_${Date.now()}`, sender:'ai', text:'I could not retrieve your orders securely. Please sign in again or try the order tracking page.', suggestions:['Sign In','Track Order Page'] }]);
    } finally {
      trackBusyRef.current = false;
      if (request === trackRequestRef.current) setTrackingBusy(false);
    }
  };

  const openMyOrder = order => {
    const choice = safeOrderChoice(order, trackingChoices);
    if (!choice) return;
    // Existing tracking route performs the real authorization and refreshes live status.
    setTrackingChoices([]);
    setIsOpen(false);
    onNavigate?.('track', { track: choice.id, tenant: getActiveTenant() });
  };

  // A logout/account switch invalidates any in-flight private order lookup.
  useEffect(() => {
    trackRequestRef.current += 1;
    setTrackingChoices([]);
  }, [customer?.id]);

  useEffect(() => () => { trackRequestRef.current += 1; }, []);

  // Send message to GastroAI server endpoint
  const sendMessage = async (textToSend, fromVoice = false) => {
    const queryText = (textToSend || input).trim();
    if (!queryText || typing) return;
    // Private order questions are fulfilled locally via authenticated APIs,
    // never forwarded into Gemini or stored in conversational model history.
    if (isTrackingIntent(queryText)) {
      setInput('');
      await showMyOrders();
      return;
    }
    setTrackingChoices([]);
    setPendingBatch(null);
    setPendingSupport(null);

    const tenantAtRequest = getActiveTenant();
    const userMsgId = `msg_${Date.now()}`;
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text: queryText }]);
    setInput('');
    setTyping(true);

    try {
      const orderType = sessionStorage.getItem('gastroflow_order_mode:' + tenantAtRequest);
      const pin = orderType === 'delivery' ? selectedDeliveryPin() : null;
      const res = await apiFetch('/ai/chat', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({
          message: queryText,
          language: lang,
          orderType,
          deliveryPin: pin ? {lat:pin.lat, lng:pin.lng} : null,
          cartItems,
          history: messages.filter(m => m.id !== 'welcome' && (m.sender === 'user' || m.sender === 'ai'))
            .slice(-8).map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: String(m.text || '').slice(0, 600) }))
        })
      });

      if (tenantAtRequest !== getActiveTenant()) throw new Error('Restaurant changed while generating the reply. Please ask again for your selected restaurant.');
      const aiMsgId = `ai_${Date.now()}`;
      setMessages(prev => [...prev, {
        id: aiMsgId,
        sender: 'ai',
        text: res.reply,
        recommendedItems: res.recommendedItems || [],
        suggestions: res.suggestions || [],
        action: res.action || null,
        tenantId: tenantAtRequest,
        plan: res.plan?.type === 'multi_item_preview' ? res.plan : null,
        clarification: res.clarification?.kind === 'choose_menu_item' ? res.clarification : null
      }]);

      if (res.action?.type === 'add_to_cart') setPendingAdd({...res.action, tenantId: tenantAtRequest});
      else setPendingAdd(null);
      if (fromVoice) speakText(res.reply);

      // An AI suggestion is never authorization to create a support ticket.
      if (res.action?.type === 'connect_support') {
        setPendingSupport({text:queryText.slice(0,500),tenantId:tenantAtRequest});
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        sender: 'ai',
        text: "I am having trouble connecting right now. Please call our hotline directly at **+94 76 013 0922** or email **gastroflowadmin@gmail.com**.",
        suggestions: ['📞 Call 0760130922', '✉️ Email Support']
      }]);
    } finally {
      setTyping(false);
    }
  };

  const confirmBatchToCart = async (plan) => {
    if (addingItem || !plan) return;
    setAddingItem(true);
    try {
      // Never trust old AI prices or client-constructed product ids.
      const tenantAtStart = getActiveTenant();
      const menu = await apiFetch('/public/menu', {cache:'no-store'});
      if (getActiveTenant() !== tenantAtStart) throw new Error('The restaurant changed. Please review your order again.');
      const prepared = prepareGastroBatch(plan, menu, liveCartItems, tenantAtStart);
      if (!prepared.ok) throw new Error(prepared.reason);
      addVerifiedBatch(prepared.items);
      celebrate();
      setPendingBatch(null);
      setMessages(prev => [...prev, {
        id: `multi_added_${Date.now()}`,sender:'ai',
        text: `Your ${prepared.items.length} menu selections have been submitted to the cart (base subtotal Rs. ${prepared.subtotal.toFixed(2)}). Review the cart and checkout total before placing an order.`
      }]);
      setCartOpen(true);
    } catch (error) {
      setMessages(prev => [...prev, {
        id:`multi_error_${Date.now()}`,sender:'ai',
        text:error.message || 'Unable to add these items. Please review them from the restaurant menu.'
      }]);
      setPendingBatch(null);
    } finally {
      setAddingItem(false);
    }
  };

  const confirmAddToCart = async (proposal) => {
    if (addingItem || !proposal?.itemId) return;
    setAddingItem(true);
    try {
      if (!proposal.tenantId || String(proposal.tenantId) !== String(getActiveTenant())) throw new Error('Restaurant changed. Please ask GastroMate again.');
      // Fetch live server data: AI response contents are never the source of truth.
      const menu = await apiFetch('/public/menu', { cache: 'no-store' });
      if (proposal.tenantId !== getActiveTenant()) throw new Error('Restaurant changed during confirmation. Please ask GastroMate again.');
      if (menu.offlineSnapshot) throw new Error('Please connect to the internet before adding items.');
      if (String(menu.tenantId) !== String(getActiveTenant())) throw new Error('Restaurant changed. Reopen GastroMate for this restaurant.');
      if (menu.storeOpen !== true) throw new Error('This restaurant is currently closed for online orders.');
      const item = (menu.items || []).find(i => String(i.id) === String(proposal.itemId));
      if (!isMenuItemAvailable(item)) throw new Error('This item is currently unavailable.');
      if ((item.modifiers || []).length) {
        // Reuse the actual restaurant customizer. No AI-generated modifier IDs or
        // prices are ever added to the cart without explicit user selection.
        setPendingAdd(null);
        setIsOpen(false);
        onNavigate?.('store-menu', {tenant: getActiveTenant(), customize: String(item.id), qty: Math.min(20, Math.max(1, Number(proposal.quantity) || 1))});
        return;
      }
      const already = liveCartItems.filter(i => String(i.id) === String(item.id)).reduce((sum, i) => sum + Number(i.qty || 0), 0);
      const quantity = Math.min(20, Math.max(1, Math.trunc(Number(proposal.quantity) || 1)));
      if (already + quantity > maxMenuItemQuantity(item)) throw new Error('Not enough stock available for this quantity.');
      addItem(item, quantity);
      celebrate();
      setPendingAdd(null);
      setMessages(prev => [...prev, { id: `cart_${Date.now()}`, sender: 'ai', text: `🛒 ${quantity} × ${item.name} selected for your cart. Review your cart before checkout.` }]);
      setCartOpen(true);
    } catch (err) {
      setMessages(prev => [...prev, { id: `cart_error_${Date.now()}`, sender: 'ai', text: err.message || 'Could not add this item.' }]);
    } finally { setAddingItem(false); }
  };

  // Explicit user consent for sharing an inquiry with restaurant support.
  const confirmSupportRequest = async () => {
    if (supportBusy || !pendingSupport) return;
    const proposal = pendingSupport;
    if (proposal.tenantId !== getActiveTenant()) {
      setPendingSupport(null);
      setMessages(prev => [...prev, {id:`support_store_${Date.now()}`,sender:'ai',text:'The restaurant changed. Please start a new support request.'}]);
      return;
    }
    setPendingSupport(null);
    if (!customer || !getToken?.()) {
      setPendingTicketText(proposal.text);
      setVerifyingGuest(true);
      return;
    }
    setSupportBusy(true);
    try {
      await createSupportTicket(proposal.text, customer.email || customer.phone || '', customer.name || 'Customer');
    } catch (_) {
      // createSupportTicket already reports a clear failure to the customer.
    } finally {
      setSupportBusy(false);
    }
  };

  // Trigger Guest OTP code sending (Email or SMS)
  const handleSendGuestOtp = async () => {
    if (!guestContact.trim()) return;
    setOtpBusy(true);
    const isEmail = guestContact.includes('@');
    try {
      const r = await apiFetch('/otp/send', {
        method: 'POST',
        body: JSON.stringify({
          channel: isEmail ? 'email' : 'sms',
          destination: guestContact.trim(),
          purpose: 'guest_support_verify'
        })
      });
      setOtpSent(true);
      if (r.otpCode) {
        setGuestOtpCode(r.otpCode);
      }
    } catch (err) {
      alert(err.message || 'Could not send verification code.');
    } finally {
      setOtpBusy(false);
    }
  };

  // Verify Guest OTP and submit support ticket
  const handleVerifyGuestOtpAndSubmit = async () => {
    if (!guestOtpCode.trim()) return;
    setOtpBusy(true);
    try {
      const vr = await apiFetch('/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          destination: guestContact.trim(),
          code: guestOtpCode.trim()
        })
      });
      if (vr.valid || vr.success) {
        const text = pendingTicketText;
        if (!text) throw new Error('Support request expired. Please start again.');
        await createSupportTicket(text, guestContact.trim(), 'Verified Guest Customer');
        setVerifyingGuest(false);
        setPendingTicketText('');
      } else {
        alert('Invalid or expired OTP code. Please try again.');
      }
    } catch (err) {
      alert(err.message || 'OTP verification failed.');
    } finally {
      setOtpBusy(false);
    }
  };

  // Create real support ticket in database & broadcast SSE to staff/admin
  const createSupportTicket = async (subjectText, contactInfo, name) => {
    try {
      const ticketRes = await apiFetch('/support/tickets', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({
          subject: `GastroMate AI Request: ${subjectText.slice(0, 50)}...`,
          category: 'General Support',
          message: `[Submitted via GastroMate AI]\nCustomer: ${name} (${contactInfo})\n\nIssue Details: ${subjectText}`,
          contact: contactInfo
        })
      });

      setMessages(prev => [...prev, {
        id: `tkt_confirm_${Date.now()}`,
        sender: 'ai',
        text: `✅ **Support Ticket Created!** (ID: #${ticketRes.ticketId || ticketRes.id || 'Active'})\n\nOur Store Manager has received your request. You can also track and reply to this ticket anytime under your Account Support menu!`,
        suggestions: ['📋 View Support History', '🍽️ Return to Menu']
      }]);
    } catch (err) {
      console.warn('Support ticket creation error:', err);
      setMessages(prev => [...prev, {id:`tkt_error_${Date.now()}`,sender:'ai',text:'Your support ticket could not be confirmed. Please retry or open the support desk.'}]);
      throw err;
    }
  };

  return (
    <>
      {/* ✨ Floating GastroAssist Widget Button */}
      <div className="gastro-ai-launcher gastro-mate-launcher">
        {!isOpen && (
          <div
            className="gastro-ai-pill gastro-mate-pill"
            onClick={() => setIsOpen(true)}
            style={{
              background: 'var(--bg-card, #1e293b)',
              color: 'var(--text-1, #f8fafc)',
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 700,
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              border: '1px solid var(--border-color, #334155)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <BurgerMascot small active={isGastroAnimating} speaking={speaking} celebrating={celebrating} />
            <span className="gastro-ai-pill-text">Ask GastroMate</span>
          </div>
        )}

        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close GastroMate AI' : 'Open GastroMate AI'}
          className="gastro-ai-btn gastro-mate-trigger"
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0d714c, #21885b)',
            color: '#ffffff',
            border: '2px solid rgba(255,255,255,0.85)',
            boxShadow: '0 9px 26px rgba(20, 115, 73, .26)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            flexShrink: 0
          }}
        >
          {isOpen ? <X size={22} /> : <BurgerMascot small active={isGastroAnimating} />}
          {!isOpen && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#10b981',
                border: '2px solid #ffffff'
              }}
            />
          )}
        </button>
      </div>

      {/* 💬 GastroMate AI Drawer Modal */}
      {isOpen && (
        <div className={`gastro-ai-modal gastro-mate-modal ${isGastroAnimating ? 'gastromate-chat-active' : ''}`} role="dialog" aria-modal="true" aria-label="GastroMate AI assistant">
          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(120deg, #086242, #167d55)',
              color: '#ffffff',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.2)', padding: '6px 8px', borderRadius: 14 }}>
                <BurgerMascot active={isGastroAnimating} speaking={speaking} celebrating={celebrating} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.2px' }}>
                  GastroMate AI
                </div>
                <div style={{ fontSize: '0.72rem', opacity: 0.95, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  Food suggestions · Order help · Support
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: '50%', fontSize: '1rem', cursor: 'pointer' }}
            >
              <X size={18}/>
            </button>
          </div>

          {/* AI suggested cart action requires an explicit customer confirmation. */}
          {pendingAdd && <div className="gastromate-confirm">
            <span>Would you like to add this menu item to your cart? The price and stock will be checked again before adding.</span>
            <button type="button" disabled={addingItem} onClick={() => confirmAddToCart(pendingAdd)}>{addingItem ? 'Checking…' : 'Add to Cart'}</button>
            <button type="button" onClick={() => setPendingAdd(null)}>Cancel</button>
          </div>}

          {pendingBatch && <div className="gastromate-confirm" role="group" aria-label="Confirm complete food selection">
            <span>Confirm these items at their current menu prices? Stock and restaurant will be checked before any cart change. Customizable items must be selected from the menu.</span>
            <button type="button" disabled={addingItem} onClick={() => confirmBatchToCart(pendingBatch)}>
              {addingItem ? 'Checking menu…' : 'Confirm complete selection'}
            </button>
            <button type="button" disabled={addingItem} onClick={() => setPendingBatch(null)}>Cancel</button>
          </div>}
          {pendingSupport && <div className="gastromate-confirm" role="group" aria-label="Confirm support ticket">
            <span>Send this inquiry to the selected restaurant support team? It may include your contact details. No ticket will be created unless you confirm.</span>
            <button type="button" disabled={supportBusy} onClick={confirmSupportRequest}>
              {supportBusy ? 'Sending…' : 'Confirm support request'}
            </button>
            <button type="button" disabled={supportBusy} onClick={() => setPendingSupport(null)}>Cancel</button>
          </div>}
          {/* Only account-owned, tenant-scoped orders can appear here. No private
               tracking data is sent to the AI provider or persisted in chat history. */}
          {trackingBusy && <div role="status" style={{padding:'8px 14px',fontSize:'.8rem'}}>Looking up your orders securely…</div>}
          {trackingChoices.length > 0 && <div className="gastromate-orders" aria-label="Your recent orders" style={{padding:'8px 14px',display:'grid',gap:8}}>
            {trackingChoices.map(order => <button key={order.id} type="button" onClick={() => openMyOrder(order)}
              style={{border:'1px solid #b7d6c5',borderRadius:12,background:'#f4f8f2',color:'#173c2d',padding:'10px 12px',textAlign:'left',cursor:'pointer'}}>
              <strong>Order #{order.label}</strong> · {order.statusLabel}
              <div style={{fontSize:'.76rem',opacity:.85}}>{order.dateLabel} · View live tracking</div>
            </button>)}
          </div>}
          {/* Chat Messages Body */}
          <div style={{ flex: 1, padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: msg.sender === 'user' ? '#146f4c' : '#f4f8f2',
                  color: msg.sender === 'user' ? '#ffffff' : '#1a4030',
                  padding: '10px 14px',
                  borderRadius: 16,
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  border: msg.sender === 'user' ? 'none' : '1px solid var(--border-color, #334155)'
                }}
              >
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.sender === 'ai' && reveal.id === msg.id ? msg.text.slice(0, reveal.count) : msg.text}
                  {msg.sender === 'ai' && reveal.id === msg.id && reveal.count < msg.text.length && <span className="gastromate-type-cursor" aria-hidden="true">▍</span>}
                </div>
                {msg.sender === 'ai' && <span className="sr-only" aria-live="polite">{msg.text}</span>}

                {/* Speaker Voice Icon */}
                {msg.sender === 'ai' && (
                  <button
                    onClick={() => speakText(msg.text)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}
                    title="Read response aloud" aria-label="Read response aloud"
                  >
                    🔊 Read Aloud
                  </button>
                )}

                {/* Food Recommendation Items */}
                {msg.recommendedItems && msg.recommendedItems.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {msg.recommendedItems.map(item => (
                      <div
                        key={item.id}
                        style={{
                          background: 'rgba(0,0,0,0.2)',
                          padding: 8,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.78rem'
                        }}
                      >
                        <span>{item.emoji || '🍽️'} <strong>{item.name}</strong> · Rs. {item.price}</span>
                        <button
                          onClick={() => {
                            setIsOpen(false);
                            onNavigate?.('store-menu', {tenant: getActiveTenant(), customize: String(item.id), qty: msg.clarification?.quantity || 1});
                          }}
                          style={{ background: '#176e4d', color: '#fff', border: 'none', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
                        >
                          View
                        </button>
                        <button type="button"
                          onClick={() => {setPendingBatch(null);setPendingAdd({type:'add_to_cart',itemId:String(item.id),quantity:msg.clarification?.quantity || 1,tenantId:msg.tenantId});}}
                          disabled={typing || addingItem}
                          aria-label={`Select ${item.name} for cart confirmation`}
                          style={{background:'#fff',color:'#176e4d',border:'1px solid #176e4d',borderRadius:6,padding:'3px 8px',fontSize:'0.7rem',fontWeight:700,cursor:'pointer'}}
                        >Select +</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Server-grounded multi-item draft. Never mutate the cart automatically. */}
                {msg.plan?.type === 'multi_item_preview' && Array.isArray(msg.plan.lines) && (
                  <div className="gastromate-plan" style={{marginTop:10,display:'grid',gap:7}}>
                    <strong style={{fontSize:'.85rem'}}>Your food selection (not yet added)</strong>
                    {msg.plan.lines.slice(0,6).map((line, index) => (
                      <div key={index} style={{padding:9,border:'1px solid #b9d5c8',borderRadius:10,background:'#fff'}}>
                        <div style={{fontSize:'.79rem',color:'#183d2b'}}>
                          {line.quantity} × {line.name || line.phrase}
                          {line.status === 'available' ? ` — Rs. ${Number(line.lineTotal).toFixed(2)}` : ' — Please choose an exact item'}
                        </div>
                        {line.status === 'available' ? (
                          <button type="button" disabled={typing || addingItem}
                            style={{marginTop:6,border:'1px solid #176e4d',borderRadius:7,padding:'5px 9px',color:'#176e4d',background:'#fff',cursor:'pointer'}}
                            onClick={() => {setPendingBatch(null);setPendingAdd({type:'add_to_cart',itemId:String(line.itemId),quantity:Number(line.quantity),tenantId:msg.plan.tenantId});}}>
                            Review and add this item
                          </button>
                        ) : (
                          <button type="button" style={{marginTop:6,border:'1px solid #176e4d',borderRadius:7,padding:'5px 9px',color:'#176e4d',background:'#fff',cursor:'pointer'}}
                            onClick={() => {setIsOpen(false);onNavigate?.('store-menu', {tenant:getActiveTenant()});}}>
                            Choose from restaurant menu
                          </button>
                        )}
                      </div>
                    ))}
                    <div style={{fontSize:'.81rem',fontWeight:700}}>
                      {msg.plan.totalKnown ? 'Base subtotal: ' : 'Known items subtotal: '}
                      Rs. {Number(msg.plan.subtotal || 0).toFixed(2)}
                      {msg.plan.budget != null && ` · Budget: Rs. ${Number(msg.plan.budget).toFixed(2)}`}
                    </div>
                    {msg.plan.withinBudget === false && <div role="status" style={{color:'#a23b23',fontSize:'.78rem'}}>Base subtotal exceeds the stated budget. Nothing has been added.</div>}
                    <small style={{lineHeight:1.4,color:'#52685c'}}>{msg.plan.note}</small>
                    {msg.plan.totalKnown && msg.plan.withinBudget !== false &&
                      <button type="button" disabled={typing || addingItem}
                        style={{border:0,borderRadius:9,padding:'9px 12px',fontWeight:700,background:'#176e4d',color:'#fff',cursor:'pointer'}}
                        onClick={() => {setPendingAdd(null);setPendingBatch(msg.plan);}}>
                        Review complete selection
                      </button>}
                  </div>
                )}

                {/* Quick Action Suggestion Chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {msg.suggestions.map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (/Support History|Human Support|Contact Human Support|Live Agent/i.test(chip)) {
                            onNavigate && onNavigate('support');
                            setIsOpen(false);
                          } else if (/Track Order Page/i.test(chip)) {
                            onNavigate?.('track', { track: null });
                            setIsOpen(false);
                          } else if (/Track Order|Order Status/i.test(chip)) {
                            showMyOrders();
                          } else if (/Sign In/i.test(chip)) {
                            onNavigate?.('account');
                            setIsOpen(false);
                          } else if (/Browse Restaurants/i.test(chip)) {
                            onNavigate?.('restaurants');
                            setIsOpen(false);
                          } else if (/Browse Menu|Return to Menu/i.test(chip)) {
                            onNavigate?.('store-menu');
                            setIsOpen(false);
                          } else if (/View Cart|Checkout/i.test(chip)) {
                            setCartOpen(true);
                            setIsOpen(false);
                          } else if (chip.includes('0760130922')) {
                            window.location.href = 'tel:0760130922';
                          } else {
                            sendMessage(chip);
                          }
                        }}
                        style={{
                          background: 'rgba(255, 107, 53, 0.12)',
                          color: '#ff6b35',
                          border: '1px solid rgba(255, 107, 53, 0.3)',
                          borderRadius: 14,
                          padding: '4px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Typing Indicator */}
            {typing && (
              <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.06)', padding: '8px 14px', borderRadius: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span className="gastromate-thinking-label">🍔 GastroMate is thinking <span className="typing-dots" aria-hidden="true"><span/><span/><span/></span></span>
              </div>
            )}

            {/* Guest Verification Box (if guest requesting human care) */}
            {verifyingGuest && (
              <div style={{ background: 'rgba(79, 70, 229, 0.15)', border: '1px solid #6366f1', padding: 12, borderRadius: 12, marginTop: 8 }}>
                <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#818cf8', marginBottom: 4 }}>
                  🔒 Verify Email or Phone to Submit Ticket
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  To prevent spam, please enter your real Email or Sri Lankan Phone Number for verification.
                </div>
                {!otpSent ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="form-control"
                      placeholder="Email or Phone (e.g. 0771234567)"
                      value={guestContact}
                      onChange={e => setGuestContact(e.target.value)}
                      style={{ fontSize: '0.78rem', height: 36 }}
                    />
                    <button
                      type="button"
                      onClick={handleSendGuestOtp}
                      disabled={otpBusy}
                      style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0 10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {otpBusy ? 'Sending...' : 'Send OTP'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      className="form-control"
                      placeholder="Enter 6-digit OTP Code"
                      value={guestOtpCode}
                      onChange={e => setGuestOtpCode(e.target.value)}
                      style={{ fontSize: '0.78rem', height: 36 }}
                    />
                    <button
                      type="button"
                      onClick={handleVerifyGuestOtpAndSubmit}
                      disabled={otpBusy}
                      style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, padding: '8px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {otpBusy ? 'Verifying...' : '✓ Verify & Connect Live Support'}
                    </button>
                  </div>
                )}
                <button type="button" disabled={otpBusy}
                  onClick={() => {setVerifyingGuest(false);setPendingTicketText('');setGuestOtpCode('');setOtpSent(false);}}
                  style={{marginTop:8,padding:'5px 10px',borderRadius:8,border:'1px solid #aaa',background:'transparent',color:'inherit'}}>
                  Cancel support request
                </button>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Footer Input Controls */}
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            style={{
              padding: 10,
              background: '#ffffff',
              borderTop: '1px solid var(--border-color, #334155)',
              display: 'flex',
              gap: 6
            }}
          >
            <button
              type="button"
              onClick={handleVoiceListen}
              style={{
                background: isListening ? '#ef4444' : 'rgba(255,255,255,0.08)',
                color: isListening ? '#fff' : 'var(--text-1)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                width: 38,
                height: 38,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Speak your question" aria-label="Speak your question"
            >
              <Mic size={19}/>
            </button>
            <input
              type="text"
              placeholder="Ask about food, orders or help…"
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{
                flex: 1,
                background: '#ffffff',
                color: '#173f2a',
                border: '1px solid var(--border-color, #334155)',
                borderRadius: 12,
                padding: '0 12px',
                fontSize: '0.82rem'
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || typing}
              style={{
                background: '#176e4d',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                padding: '0 14px',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: input.trim() ? 'pointer' : 'default',
                opacity: input.trim() && !typing ? 1 : 0.5
              }}
            >
              <Send size={19}/><span className="sr-only">Send question</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Bot, Mic, Send, Volume2, CircleHelp, Utensils, PackageCheck } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';

export default function GastroAiConcierge({ onNavigate, cartItems = [] }) {
  const { customer, token } = useCustomerAuth();
  const { t } = useLang();
  
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

  // Guest Verification state for Human Support escalation
  const [verifyingGuest, setVerifyingGuest] = useState(false);
  const [guestContact, setGuestContact] = useState('');
  const [guestOtpCode, setGuestOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [pendingTicketText, setPendingTicketText] = useState('');

  const chatEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typing, isOpen]);

  // Voice Input via Web Speech API
  const handleVoiceListen = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

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
      window.speechSynthesis.cancel();
      const clean = text.replace(/[*_#`~[\]()]/g, '');
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  };

  // Send message to GastroAI server endpoint
  const sendMessage = async (textToSend, fromVoice = false) => {
    const queryText = (textToSend || input).trim();
    if (!queryText) return;

    const userMsgId = `msg_${Date.now()}`;
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text: queryText }]);
    setInput('');
    setTyping(true);

    try {
      const res = await apiFetch('/ai/chat', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ message: queryText, cartItems })
      });

      const aiMsgId = `ai_${Date.now()}`;
      setMessages(prev => [...prev, {
        id: aiMsgId,
        sender: 'ai',
        text: res.reply,
        recommendedItems: res.recommendedItems || [],
        suggestions: res.suggestions || [],
        action: res.action || null
      }]);

      if (fromVoice) speakText(res.reply);

      // Support escalation trigger
      if (res.action && res.action.type === 'connect_support') {
        if (customer) {
          // Logged in customer: automatically create real support ticket
          await createSupportTicket(queryText, customer.email || customer.phone, customer.name);
        } else {
          // Guest user: prompt for OTP verification
          setPendingTicketText(queryText);
          setVerifyingGuest(true);
        }
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
        setVerifyingGuest(false);
        await createSupportTicket(pendingTicketText || 'Guest inquiry', guestContact.trim(), 'Verified Guest Customer');
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
            <Sparkles size={17} color="#17744c"/>
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
          {isOpen ? '✕' : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="currentColor" />
              <path d="M19 2L19.8 4.2L22 5L19.8 5.8L19 8L18.2 5.8L16 5L18.2 4.2L19 2Z" fill="rgba(255,255,255,0.85)" />
            </svg>
          )}
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
        <div className="gastro-ai-modal gastro-mate-modal" role="dialog" aria-modal="true" aria-label="GastroMate AI assistant">
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
                <Bot size={22}/>
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
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>

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
                            onNavigate && onNavigate('menu');
                          }}
                          style={{ background: '#176e4d', color: '#fff', border: 'none', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Action Suggestion Chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {msg.suggestions.map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (chip.includes('Support History') || chip.includes('Human Support')) {
                            onNavigate && onNavigate('support');
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
                ⏳ GastroAI is typing...
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

import React, { useState, useEffect, useRef } from 'react';
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
      text: "👋 **Welcome to GastroFlow!**\n\nI am **GastroAI**, your 24/7 Intelligent Dining Concierge & Support Assistant.\n\nHow can I help you today?",
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
          subject: `GastroAI Assistant Request: ${subjectText.slice(0, 50)}...`,
          category: 'General Support',
          message: `[Submitted via GastroAI Assistant]\nCustomer: ${name} (${contactInfo})\n\nIssue Details: ${subjectText}`,
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
      {/* 🤖 Floating GastroAI Assistant Widget Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: 76,
          right: 20,
          zIndex: 9990,
          background: 'linear-gradient(135deg, #ff6b35 0%, #d946ef 100%)',
          color: '#ffffff',
          border: 'none',
          borderRadius: 30,
          padding: '10px 18px',
          fontWeight: 800,
          fontSize: '0.88rem',
          boxShadow: '0 8px 24px rgba(255, 107, 53, 0.45)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'all 0.25s ease'
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>🤖</span>
        <span>{isOpen ? 'Close AI' : 'GastroAI'}</span>
      </button>

      {/* 💬 GastroAI Assistant Modal Drawer */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 130,
            right: 16,
            width: 'calc(100vw - 32px)',
            maxWidth: 420,
            height: 540,
            maxHeight: 'calc(100dvh - 160px)',
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border-color, #334155)',
            borderRadius: 20,
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            zIndex: 9995,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(135deg, #ff6b35 0%, #4f46e5 100%)',
              color: '#ffffff',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.2)', padding: 6, borderRadius: 12 }}>🤖</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>GastroAI Assistant</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.9 }}>24/7 Intelligent Concierge</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}
            >
              ✕
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
                  background: msg.sender === 'user' ? '#ff6b35' : 'var(--surface-1, rgba(255,255,255,0.06))',
                  color: msg.sender === 'user' ? '#ffffff' : 'var(--text-1, #f8fafc)',
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
                    title="Read Aloud"
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
                          style={{ background: '#ff6b35', color: '#fff', border: 'none', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
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
              background: 'var(--bg-main, #0f172a)',
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
              title="Voice Mic Input"
            >
              🎤
            </button>
            <input
              type="text"
              placeholder="Ask GastroAI anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{
                flex: 1,
                background: 'var(--surface-1, rgba(255,255,255,0.06))',
                color: 'var(--text-1, #ffffff)',
                border: '1px solid var(--border-color, #334155)',
                borderRadius: 12,
                padding: '0 12px',
                fontSize: '0.82rem'
              }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                background: '#ff6b35',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                padding: '0 14px',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: input.trim() ? 'pointer' : 'default',
                opacity: input.trim() ? 1 : 0.5
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

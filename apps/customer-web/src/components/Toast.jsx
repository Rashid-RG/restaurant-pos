import React, { useState, useCallback } from 'react';

export default function Toast({ messages }) {
  return (
    <div className="toast-container">
      {messages.map(m => (
        <div key={m.id} className={`toast ${m.type || ''}`}>
          {m.type === 'success' ? '✓' : m.type === 'error' ? '✕' : 'ℹ'} {m.text}
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const [messages, setMessages] = useState([]);

  const toast = useCallback((text, type = 'default', duration = 3000) => {
    const id = Date.now();
    setMessages(prev => [...prev, { id, text, type }]);
    setTimeout(() => setMessages(prev => prev.filter(m => m.id !== id)), duration);
  }, []);

  return { messages, toast };
}

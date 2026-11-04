import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AppErrorBoundary } from '../../../shared/ui/Resilience.jsx';
import '../../../shared/ui/resilience.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

import './modern.css';

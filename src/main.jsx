import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AppErrorBoundary } from '../shared/ui/Resilience.jsx';
import '../shared/ui/resilience.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>
);

import './modern.css';

import '../shared/ui/devices.css';

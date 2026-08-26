import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './store/store';
import { ToastProvider } from './components/ui';
import './styles.css';

// Offline shell. Registered after load so it never competes with first paint,
// and skipped in dev where Vite serves modules the cache would only get wrong.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unavailable service worker is not worth interrupting anyone over.
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AppProvider>
  </React.StrictMode>,
);

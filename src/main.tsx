import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexProvider } from 'convex/react';
import App from './App';
import { createConvexClient } from './net/convex';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');
const convex = createConvexClient(import.meta.env.VITE_CONVEX_URL);
createRoot(root).render(
  <StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);

// Only in production: a service worker in dev would serve stale modules over Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('Service worker registration failed', err));
  });
}

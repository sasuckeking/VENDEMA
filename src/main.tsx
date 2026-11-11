import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safely attach signed session token and HttpOnly cookie credentials to internal /api/* requests
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  try {
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('/api/') || urlStr.startsWith('/health') || urlStr.startsWith('/ready')) {
        const token = localStorage.getItem('vendema_auth_token');
        const headers = new Headers(init?.headers || {});
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        return originalFetch(input, {
          ...init,
          headers,
          credentials: init?.credentials || 'same-origin',
        });
      }
      return originalFetch(input, init);
    };
    Object.defineProperty(window, 'fetch', {
      value: wrappedFetch,
      configurable: true,
      writable: true,
    });
  } catch {
    // In environments where window.fetch is non-configurable, same-origin HttpOnly cookies and explicit headers are used
  }
}

createRoot(document.getElementById('root')!).render(<App />);


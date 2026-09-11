/**
 * Centralized API & WebSocket Configuration for SentryWing.
 * Supports Localhost Vite Proxy, Vercel Deployments, Cloud Tunnels (localtunnel/ngrok/Cloudflare),
 * and custom backend server URLs configured dynamically via the UI or .env.
 */

const STORAGE_KEY = 'sentrywing_backend_url';

export const getCustomBackendUrl = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

export const setCustomBackendUrl = (url) => {
  try {
    const cleanUrl = (url || '').trim().replace(/\/+$/, '');
    if (cleanUrl) {
      localStorage.setItem(STORAGE_KEY, cleanUrl);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('sentrywing_backend_changed', { detail: cleanUrl }));
  } catch (e) {
    console.warn('Failed to update backend URL in localStorage:', e);
  }
};

export const getApiBaseUrl = () => {
  const custom = getCustomBackendUrl();
  if (custom) return custom;
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  return '';
};

export const getWsBaseUrl = (path = '/ws/stream') => {
  const custom = getCustomBackendUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (custom) {
    const wsProto = custom.startsWith('https:') ? 'wss:' : 'ws:';
    const cleanHost = custom.replace(/^https?:\/\//i, '');
    return `${wsProto}//${cleanHost}${cleanPath}`;
  }

  if (import.meta.env.VITE_WS_URL) {
    const base = import.meta.env.VITE_WS_URL.replace(/\/+$/, '');
    return `${base}${cleanPath}`;
  }

  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'wss:' : 'ws:';

  // If running locally on Vite dev server (port 5173), proxy through Vite
  if (window.location.port === '5173' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (isHttps) {
      return `${protocol}//${window.location.host}${cleanPath}`;
    }
    return `ws://127.0.0.1:8000${cleanPath}`;
  }

  // Fallback for direct deployment
  return `${protocol}//${window.location.host}${cleanPath}`;
};

/**
 * Enhanced fetch wrapper that prepends the configured backend URL and provides
 * friendly explanations when running on static hosts like Vercel.
 */
export const apiFetch = async (endpoint, options = {}) => {
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = base ? `${base}${cleanEndpoint}` : cleanEndpoint;

  try {
    const resp = await fetch(fullUrl, options);

    // If 404 occurs on Vercel without a configured backend, give a clear helpful message
    if (resp.status === 404 && !base && window.location.hostname.includes('vercel.app')) {
      const err = new Error(
        'Backend AI server is not connected. Vercel only hosts the frontend UI. Click "Engine Connecting" in the top bar to connect your backend URL, or run locally on https://localhost:5173.'
      );
      err.status = 404;
      throw err;
    }

    return resp;
  } catch (err) {
    if (!base && window.location.hostname.includes('vercel.app') && err.name === 'TypeError') {
      const connErr = new Error(
        'Cannot reach AI Backend from Vercel. Please click "Engine Connecting" in the top navigation bar to configure your backend URL.'
      );
      connErr.status = 503;
      throw connErr;
    }
    throw err;
  }
};

/**
 * Test connectivity to a candidate backend URL
 */
export const testBackendPing = async (candidateUrl) => {
  const cleanUrl = (candidateUrl || '').trim().replace(/\/+$/, '');
  const testUrl = cleanUrl ? `${cleanUrl}/api/admin/stats` : '/api/admin/stats';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  const start = performance.now();
  try {
    const resp = await fetch(testUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    if (resp.ok) {
      return { success: true, latency };
    }
    return { success: false, error: `Server returned HTTP ${resp.status}` };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'Connection timed out (4s)' };
    }
    return { success: false, error: err.message || 'Network error' };
  }
};

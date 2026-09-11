/**
 * WebSocket Streaming Manager for Animal Detection & Target Locking.
 * Handles bi-directional transmission of binary video frames and JSON telemetry/commands.
 */

export class StreamWebSocket {
  constructor(customWsUrl = null) {
    this.customWsUrl = customWsUrl;
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.onTelemetryCallback = null;
    this.onStatusChangeCallback = null;
    this.isFrameInFlight = false;
  }

  getWsUrl() {
    if (this.customWsUrl) {
      return this.customWsUrl;
    }
    const isHttps = window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';

    // When served over HTTPS (e.g. Vite with basicSsl on port 5173), connect through
    // Vite's proxy on the same origin (window.location.host) which securely terminates TLS
    // and proxies ws:// to port 8000. Connecting wss:// directly to port 8000 causes ERR_SSL_PROTOCOL_ERROR.
    if (isHttps || window.location.port === '5173') {
      return `${protocol}//${window.location.host}/ws/stream`;
    }

    // Direct HTTP connection fallback
    const host = window.location.hostname || '127.0.0.1';
    return `ws://${host}:8000/ws/stream`;
  }

  connect(url = null) {
    if (url) this.customWsUrl = url;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this._updateStatus(false, true);

    const wsUrl = this.getWsUrl();
    console.log(`[WS] Connecting to ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[WS] Connected to stream endpoint');
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.isFrameInFlight = false;
        this._updateStatus(true, false);
      };

      this.ws.onmessage = (event) => {
        this.isFrameInFlight = false;
        if (typeof event.data === 'string') {
          try {
            const telemetry = JSON.parse(event.data);
            if (this.onTelemetryCallback) {
              this.onTelemetryCallback(telemetry);
            }
          } catch (e) {
            console.warn('[WS] Failed to parse message:', e);
          }
        }
      };

      this.ws.onclose = (e) => {
        console.warn('[WS] Connection closed:', e.code, e.reason);
        this.isConnected = false;
        this.isConnecting = false;
        this.isFrameInFlight = false;
        this._updateStatus(false, false);
        this._scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Socket error:', err);
        this.isConnected = false;
        this.isConnecting = false;
        this._updateStatus(false, false);
      };
    } catch (e) {
      console.error('[WS] Connection attempt failed:', e);
      this.isConnected = false;
      this.isConnecting = false;
      this._updateStatus(false, false);
      this._scheduleReconnect();
    }
  }

  _updateStatus(connected, connecting) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({
        connected,
        connecting,
        wsUrl: this.getWsUrl()
      });
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const delay = Math.min(5000, 1000 * Math.min(this.reconnectAttempts, 5));
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  sendFrameBlob(blob) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    // Prevent backlog if network is congested
    if (this.ws.bufferedAmount > 256 * 1024) {
      return false;
    }

    try {
      this.isFrameInFlight = true;
      this.ws.send(blob);
      return true;
    } catch (e) {
      console.error('[WS] Frame send error:', e);
      this.isFrameInFlight = false;
      return false;
    }
  }

  sendCommand(cmdObj) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(cmdObj));
      return true;
    } catch (e) {
      console.error('[WS] Command send error:', e);
      return false;
    }
  }

  lockCoordinate(normX, normY) {
    return this.sendCommand({
      type: 'lock_coord',
      x: normX,
      y: normY
    });
  }

  lockTargetId(id) {
    return this.sendCommand({
      type: 'lock_target',
      id: id
    });
  }

  unlock() {
    return this.sendCommand({
      type: 'unlock'
    });
  }

  setAutoLock(val) {
    return this.sendCommand({
      type: 'set_auto_lock',
      value: val
    });
  }

  initSession(sessionData) {
    return this.sendCommand({
      type: 'init_session',
      ...sessionData
    });
  }

  updateLocation(locationData) {
    return this.sendCommand({
      type: 'update_location',
      location: locationData
    });
  }

  setPublishMode(enabled, url = null) {
    return this.sendCommand({
      type: 'set_publish_mode',
      enabled: Boolean(enabled),
      url: url
    });
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this._updateStatus(false, false);
  }
}


/**
 * Feed Publisher Client (Frontend-to-External Secondary WebSocket Connection).
 * When enabled, pushes frames + device geolocation + lock/bbox data directly
 * to a configurable external endpoint (e.g. ws://external-dashboard:8000/ws/live-feed).
 */
export class FeedPublisherClient {
  constructor(customUrl = null) {
    this.customUrl = customUrl || (import.meta.env?.VITE_PUBLISH_TARGET_URL || '');
    this.ws = null;
    this.isConnected = false;
    this.enabled = true;
    this.onStatusCallback = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  setUrl(url) {
    this.customUrl = url ? url.trim() : '';
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  connect(url = null) {
    if (url) this.customUrl = url;
    if (!this.customUrl) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.customUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        if (this.onStatusCallback) this.onStatusCallback({ connected: true, url: this.customUrl });
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.onStatusCallback) this.onStatusCallback({ connected: false, url: this.customUrl });
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        if (this.onStatusCallback) this.onStatusCallback({ connected: false, url: this.customUrl });
      };
    } catch (e) {
      this.isConnected = false;
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (!this.customUrl || !this.enabled) return;
    this.reconnectAttempts++;
    const delay = Math.min(10000, 1000 * Math.min(this.reconnectAttempts, 5));
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  publishFrame({ frameB64, location, tracking = null, attributes = null, uploader = null }) {
    if (!this.enabled || !this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Include lock data ONLY when a target is actively locked
    let lockData = null;
    if (tracking && tracking.locked) {
      lockData = {
        locked: true,
        state: tracking.state || 'LOCKED',
        target_id: tracking.target_id,
        species: tracking.target_class,
        bbox: tracking.target_bbox,
        center: tracking.target_center,
        dx: tracking.dx || 0,
        dy: tracking.dy || 0,
        direction: tracking.direction || 'CENTERED',
        predicted: Boolean(tracking.predicted),
        lost_count: tracking.lost_count || 0,
        attributes: attributes
      };
    }

    const payload = {
      type: 'live_feed_frame',
      timestamp: new Date().toISOString(),
      unix_timestamp: Date.now() / 1000,
      location: {
        lat: location?.lat || 29.5312,
        lng: location?.lng || 78.7744,
        name: location?.name || location?.location_name || 'Corbett Sector 4 Patrol',
        accuracy: location?.accuracy
      },
      uploader: uploader || {
        id: 'scout_01',
        name: 'Patrol Ranger'
      },
      frame: frameB64,
      lock: lockData
    };

    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[FeedPublisherClient] Send error:', e);
      return false;
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}


/**
 * Live Feed Subscriber Client.
 * Connects to /ws/live-feed or an external published live feed WebSocket endpoint
 * to stream raw video frames + device geolocation + lock/bbox data.
 * Used by the Admin / Vet Live Feed Viewer.
 */
export class LiveFeedSubscriberClient {
  constructor(customUrl = null) {
    this.customUrl = customUrl;
    this.ws = null;
    this.isConnected = false;
    this.onFrameCallback = null;
    this.onStatusCallback = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  getUrl() {
    if (this.customUrl) return this.customUrl;
    const isHttps = window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/live-feed`;
  }

  connect(url = null) {
    if (url) this.customUrl = url;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const endpoint = this.getUrl();
    try {
      this.ws = new WebSocket(endpoint);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        if (this.onStatusCallback) this.onStatusCallback({ connected: true, url: endpoint });
      };

      this.ws.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (this.onFrameCallback) {
            this.onFrameCallback(payload);
          }
        } catch (err) {
          console.warn('[LiveFeedClient] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.onStatusCallback) this.onStatusCallback({ connected: false, url: endpoint });
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        if (this.onStatusCallback) this.onStatusCallback({ connected: false, url: endpoint });
      };
    } catch (e) {
      console.warn('[LiveFeedClient] Connect error:', e);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const delay = Math.min(6000, 1000 * Math.min(this.reconnectAttempts, 6));
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}


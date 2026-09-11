import React, { useState, useEffect } from 'react';
import './App.css';

import { AuthProvider, useAuth } from './context/AuthContext';
import { StreamWebSocket } from './utils/websocket';
import { soundFx } from './utils/audio';

import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { NormalUserDashboard } from './components/NormalUserDashboard';
import { VetDashboard } from './components/VetDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { BackendModal } from './components/BackendModal';
import { apiFetch, getWsBaseUrl } from './utils/api';
import { Bell, MapPin, X, ArrowRight, AlertTriangle, Crosshair, Scale } from 'lucide-react';
import {
  supabaseSaveNotification,
  supabaseDeleteNotification,
  supabaseClearNotifications
} from './utils/supabase';


class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#fff', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', margin: '20px auto', maxWidth: '600px' }}>
          <h3 style={{ marginBottom: '8px', letterSpacing: '0.05em' }}>SURVEILLANCE MODULE RECOVERED</h3>
          <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>{this.state.error?.message || 'An unexpected telemetry format was encountered.'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ background: '#fff', color: '#000', padding: '10px 18px', border: 'none', borderRadius: '4px', fontWeight: 800, cursor: 'pointer' }}
          >
            RELOAD MODULE
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SentryWingApp() {
  const { currentUser, isAuthModalOpen, setIsAuthModalOpen } = useAuth();

  // Stream WebSocket & Telemetry
  const [wsClient, setWsClient] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [detections, setDetections] = useState([]);
  const [tracking, setTracking] = useState({
    locked: false,
    state: 'SEARCHING',
    direction: 'CENTERED',
    dx: 0,
    dy: 0,
    lost_count: 0,
    max_lost_threshold: 15
  });
  const [attributes, setAttributes] = useState(null);

  // Notification state
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [isBackendModalOpen, setIsBackendModalOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Live Toast Notification Banner for Vet & Admin
  const [liveToast, setLiveToast] = useState(null);

  // Initialize Stream WebSocket
  useEffect(() => {
    const client = new StreamWebSocket();

    client.onStatusChangeCallback = ({ connected }) => {
      setIsConnected(connected);
    };

    client.onTelemetryCallback = (data) => {
      if (data.type === 'telemetry') {
        setDetections(data.detections || []);
        if (data.tracking) setTracking(data.tracking);
        setAttributes(data.attributes || null);
      }
    };

    client.connect();
    setWsClient(client);

    return () => {
      client.disconnect();
    };
  }, []);

  // Fetch notifications from database
  const fetchNotifications = async () => {
    try {
      const resp = await apiFetch('/api/notifications?limit=50');
      const data = await resp.json();
      if (data.notifications) {
        setNotifications(data.notifications);
        setUnreadCount(data.notifications.filter((n) => !n.read).length);
      }
    } catch (e) {
      console.warn('Notification fetch error:', e);
    }
  };

  // Push WebSocket for Real-time Wildlife Sighting Dispatches
  useEffect(() => {
    fetchNotifications();

    const notifWsUrl = getWsBaseUrl('/ws/notifications');

    let notifSocket = null;
    try {
      notifSocket = new WebSocket(notifWsUrl);
      notifSocket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // New alert incoming from fan-out
          if (msg.species) {
            soundFx.playLockLost(); // Audible tactical chime

            const newAlert = {
              id: msg.detection_id || Date.now().toString(),
              species: msg.species,
              thumbnail: msg.thumbnail,
              location_name: msg.location?.name || 'Reserve Sector',
              lat: msg.location?.lat || 29.5312,
              lng: msg.location?.lng || 78.7744,
              timestamp: msg.timestamp || new Date().toISOString(),
              source_type: msg.source_type || 'upload',
              uploader: msg.uploader || 'Scout',
              confidence: msg.confidence || 0.85,
              attributes: msg.attributes || {},
              read: 0
            };

            setNotifications((prev) => [newAlert, ...prev]);
            setUnreadCount((c) => c + 1);

            // Sync with Supabase Cloud if configured
            supabaseSaveNotification(newAlert).catch(() => {});

            // Trigger floating Toast for Vet and Admin
            setLiveToast(newAlert);
            // Auto dismiss toast after 8 seconds
            setTimeout(() => {
              setLiveToast((curr) => (curr?.id === newAlert.id ? null : curr));
            }, 8000);
          }
        } catch (err) {
          console.warn('Notif parse error:', err);
        }
      };
    } catch (err) {
      console.warn('Notif socket error:', err);
    }

    return () => {
      if (notifSocket) {
        try { notifSocket.close(); } catch (e) {}
      }
    };
  }, []);

  const handleMarkNotificationRead = async (id) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: 1 } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) {}
  };

  const handleDeleteNotification = async (id) => {
    try {
      await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadCount((c) => Math.max(0, c - 1));
      supabaseDeleteNotification(id).catch(() => {});
    } catch (e) {
      console.warn('Delete notification error:', e);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      await apiFetch('/api/notifications', { method: 'DELETE' });
      setNotifications([]);
      setUnreadCount(0);
      supabaseClearNotifications().catch(() => {});
    } catch (e) {
      console.warn('Clear all notifications error:', e);
    }
  };

  return (
    <div className="sentrywing-app-shell">
      <div className="hud-scanlines" />
      <div className="hud-corner tl" />
      <div className="hud-corner tr" />
      <div className="hud-corner bl" />
      <div className="hud-corner br" />

      {/* Floating High-Priority Notification Toast for Vet & Admin */}
      {liveToast && (currentUser?.role === 'vet' || currentUser?.role === 'admin' || !currentUser) && (
        <div className="realtime-alert-toast" onClick={() => setIsNotifDrawerOpen(true)}>
          <div className="toast-icon-box">
            <Bell size={18} />
          </div>
          <div className="toast-content">
            <div className="toast-title-row">
              <strong>WILDLIFE DETECTED: {liveToast.species.toUpperCase()}</strong>
              <span className="toast-conf-pill">{Math.round((liveToast.confidence || 0.85) * 100)}% MATCH</span>
            </div>
            <div className="toast-location-row">
              <MapPin size={12} />
              <span>{liveToast.location_name} ({liveToast.lat}° N, {liveToast.lng}° E)</span>
            </div>
            <div className="toast-sub-row">
              <span>Source: {liveToast.source_type?.toUpperCase()} &bull; {liveToast.uploader}</span>
            </div>
            {(liveToast.attributes?.estimated_weight_kg || liveToast.attributes?.weight_range) && (
              <div className="toast-weight-row">
                <span className="toast-weight-pill">
                  <Scale size={11} />
                  Est. Weight: <strong>{liveToast.attributes.estimated_weight_kg ? `${liveToast.attributes.estimated_weight_kg} kg` : liveToast.attributes.weight_range}</strong>
                </span>
              </div>
            )}
            {liveToast.dosage && (
              <div className="toast-dosage-row">
                <span className="toast-dosage-pill">
                  <Crosshair size={11} />
                  Dart: <strong>{(liveToast.dosage.drug || liveToast.dosage.drug_recommendation || 'Tranquilizer').split(' ')[0]}</strong> ({liveToast.dosage.dosage_mg} mg)
                </span>
                <span className="toast-dosage-disclaimer">AI-estimated dosage — verify before administering</span>
              </div>
            )}
          </div>
          <div className="toast-actions">
            <button
              className="btn-toast-view"
              onClick={(e) => {
                e.stopPropagation();
                setIsNotifDrawerOpen(true);
                setLiveToast(null);
              }}
            >
              VIEW
            </button>
            <button
              className="btn-toast-close"
              onClick={(e) => {
                e.stopPropagation();
                setLiveToast(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <Navbar
        isConnected={isConnected}
        unreadCount={unreadCount}
        onOpenNotifications={() => setIsNotifDrawerOpen(true)}
        onOpenBackendModal={() => setIsBackendModalOpen(true)}
      />

      {/* Main View Port gated by role */}
      <main className="dashboard-main-viewport">
        <ErrorBoundary>
        {currentUser?.role === 'user' && (
          <NormalUserDashboard
            wsClient={wsClient}
            isConnected={isConnected}
            detections={detections}
            tracking={tracking}
            attributes={attributes}
          />
        )}

        {currentUser?.role === 'vet' && (
          <VetDashboard />
        )}

        {currentUser?.role === 'admin' && (
          <AdminDashboard />
        )}
      </ErrorBoundary>
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen || !currentUser}
        onClose={currentUser ? () => setIsAuthModalOpen(false) : null}
      />

      {/* Slide-over Notifications */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        notifications={notifications}
        onMarkRead={handleMarkNotificationRead}
        onDeleteNotification={handleDeleteNotification}
        onClearAllNotifications={handleClearAllNotifications}
      />

      <BackendModal
        isOpen={isBackendModalOpen}
        onClose={() => setIsBackendModalOpen(false)}
        isConnected={isConnected}
      />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <SentryWingApp />
    </AuthProvider>
  );
}

export default App;

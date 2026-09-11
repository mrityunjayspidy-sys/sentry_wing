import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  MapPin,
  Clock,
  User,
  Crosshair,
  Shield,
  Activity,
  Maximize2,
  RefreshCw,
  Eye,
  AlertCircle,
  Wifi,
  WifiOff
} from 'lucide-react';
import { LiveFeedSubscriberClient } from '../utils/websocket';
import { soundFx } from '../utils/audio';

export const LiveFeedViewer = ({ initialEndpoint = null, title = "LIVE FIELD PATROL FEED" }) => {
  const [endpointUrl, setEndpointUrl] = useState(initialEndpoint || '');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastPayload, setLastPayload] = useState(null);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [feedError, setFeedError] = useState(null);

  const canvasRef = useRef(null);
  const subscriberRef = useRef(null);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const imgCacheRef = useRef(new Image());

  // Handle incoming live feed frame payload
  const handleFeedFrame = useCallback((payload) => {
    if (!payload || payload.type !== 'live_feed_frame') return;

    setLastPayload(payload);
    frameCountRef.current++;

    const now = Date.now();
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }

    if (payload.unix_timestamp) {
      const lat = Math.max(0, Math.round((now / 1000 - payload.unix_timestamp) * 1000));
      setLatencyMs(lat);
    }

    // Render frame to canvas with lock reticle overlay
    if (payload.frame) {
      const img = imgCacheRef.current;
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const w = img.naturalWidth || 640;
        const h = img.naturalHeight || 480;

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        // Draw raw video frame
        ctx.drawImage(img, 0, 0, w, h);

        // Draw HUD overlay if lock is active
        const lock = payload.lock;
        if (lock && lock.locked && lock.bbox && lock.bbox.length === 4) {
          const [nx1, ny1, nx2, ny2] = lock.bbox;
          const bx1 = nx1 * w;
          const by1 = ny1 * h;
          const bw = (nx2 - nx1) * w;
          const bh = (ny2 - ny1) * h;
          const tcx = bx1 + bw / 2;
          const tcy = by1 + bh / 2;

          ctx.save();
          if (lock.predicted) {
            // Dashed predicted bounding box
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([8, 6]);
            ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
            ctx.shadowBlur = 12;
            ctx.strokeRect(bx1, by1, bw, bh);

            // Center ring
            ctx.beginPath();
            ctx.arc(tcx, tcy, 8, 0, Math.PI * 2);
            ctx.stroke();

            // Label tag
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
            const label = `[PREDICTED HOLD ${lock.lost_count || 1}] ${(lock.species || 'TARGET').toUpperCase()}`;
            ctx.font = 'bold 12px Orbitron, sans-serif';
            const tw = ctx.measureText(label).width;
            ctx.fillRect(bx1, Math.max(0, by1 - 24), tw + 14, 22);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, bx1 + 7, Math.max(15, by1 - 8));
          } else {
            // Solid locked tactical brackets
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
            ctx.shadowBlur = 16;

            const cLen = Math.min(24, bw * 0.25, bh * 0.25);
            // Corners
            ctx.beginPath();
            ctx.moveTo(bx1, by1 + cLen); ctx.lineTo(bx1, by1); ctx.lineTo(bx1 + cLen, by1);
            ctx.moveTo(bx1 + bw - cLen, by1); ctx.lineTo(bx1 + bw, by1); ctx.lineTo(bx1 + bw, by1 + cLen);
            ctx.moveTo(bx1, by1 + bh - cLen); ctx.lineTo(bx1, by1 + bh); ctx.lineTo(bx1 + cLen, by1 + bh);
            ctx.moveTo(bx1 + bw - cLen, by1 + bh); ctx.lineTo(bx1 + bw, by1 + bh); ctx.lineTo(bx1 + bw, by1 + bh - cLen);
            ctx.stroke();

            // Center dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(tcx, tcy, 5, 0, Math.PI * 2);
            ctx.fill();

            // Label tag
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            const label = `[LOCKED] ${(lock.species || 'TARGET').toUpperCase()}`;
            ctx.font = 'bold 12px Orbitron, sans-serif';
            const tw = ctx.measureText(label).width;
            ctx.fillRect(bx1, Math.max(0, by1 - 24), tw + 14, 22);
            ctx.fillStyle = '#000000';
            ctx.fillText(label, bx1 + 7, Math.max(15, by1 - 8));

            // Stage 3 Dart Dosage HUD badge under bounding box
            if (lock.dosage && lock.dosage.dosage_mg) {
              const dartLabel = `[DART: ${(lock.dosage.drug_recommendation || 'TRANQ').split(' ')[0]} ${lock.dosage.dosage_mg}mg]`;
              ctx.font = 'bold 11px Orbitron, sans-serif';
              const dtw = ctx.measureText(dartLabel).width;
              ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
              ctx.fillRect(bx1, by1 + bh + 4, dtw + 12, 20);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1;
              ctx.strokeRect(bx1, by1 + bh + 4, dtw + 12, 20);
              ctx.fillStyle = '#ffffff';
              ctx.fillText(dartLabel, bx1 + 6, by1 + bh + 18);
            }
          }
          ctx.restore();
        }
      };
      img.src = payload.frame;
    }
  }, []);

  // Connect to live feed subscriber endpoint
  const connectSubscriber = useCallback(() => {
    if (subscriberRef.current) {
      subscriberRef.current.disconnect();
    }

    const client = new LiveFeedSubscriberClient(endpointUrl || null);
    setIsConnecting(true);
    setFeedError(null);

    client.onStatusCallback = ({ connected, url }) => {
      setIsConnected(connected);
      setIsConnecting(false);
      if (!connected) {
        setFeedError('Disconnected from live feed relay. Retrying...');
      } else {
        setFeedError(null);
      }
    };

    client.onFrameCallback = handleFeedFrame;
    client.connect();
    subscriberRef.current = client;
  }, [endpointUrl, handleFeedFrame]);

  useEffect(() => {
    connectSubscriber();
    return () => {
      if (subscriberRef.current) {
        subscriberRef.current.disconnect();
      }
    };
  }, [connectSubscriber]);

  const lockInfo = lastPayload?.lock;
  const locationInfo = lastPayload?.location;
  const uploaderInfo = lastPayload?.uploader;

  return (
    <div className="live-feed-viewer-card" style={{ background: '#0a0a0c', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Radio size={16} color="#ffffff" className={isConnected ? 'pulse-icon' : ''} />
          <h3 style={{ margin: 0, fontSize: '13px', letterSpacing: '0.08em', color: '#fff' }}>
            {title.toUpperCase()}
          </h3>
          <span style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: 3,
            fontWeight: 800,
            background: isConnected ? '#ffffff' : 'rgba(255,255,255,0.1)',
            color: isConnected ? '#000000' : '#888888',
            letterSpacing: '0.05em'
          }}>
            {isConnected ? 'FEED ONLINE' : isConnecting ? 'CONNECTING...' : 'DISCONNECTED'}
          </span>
        </div>

        {/* Connection endpoint control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder="ws://... (default: /ws/live-feed)"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            style={{
              background: '#121216',
              border: '1px solid #333',
              color: '#eee',
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: 4,
              width: '240px',
              fontFamily: 'monospace'
            }}
          />
          <button
            onClick={() => { soundFx.playTapClick(); connectSubscriber(); }}
            style={{
              background: '#222',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <RefreshCw size={12} /> RECONNECT
          </button>
        </div>
      </div>

      {/* Main Viewport & Telemetry Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: '440px' }}>
        {/* Canvas Video Viewport */}
        <div style={{ position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', maxHeight: '520px', objectFit: 'contain', display: lastPayload?.frame ? 'block' : 'none' }}
          />

          {/* Standby / Loading Placeholder */}
          {!lastPayload?.frame && (
            <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>
              <div className="radar-spinner" style={{ margin: '0 auto 16px' }} />
              <div style={{ fontFamily: 'var(--font-hud)', fontSize: '13px', color: '#fff', marginBottom: 6 }}>
                AWAITING LIVE PATROL TRANSMISSION
              </div>
              <p style={{ fontSize: '11px', color: '#888', maxWidth: '300px', margin: '0 auto' }}>
                Listening on {subscriberRef.current?.getUrl() || '/ws/live-feed'} for continuous frames from field scouts.
              </p>
            </div>
          )}

          {/* Top-left Telemetry HUD Strip */}
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 10 }}>
            <span style={{ background: 'rgba(0,0,0,0.85)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '10px', padding: '3px 8px', borderRadius: 3, fontFamily: 'monospace' }}>
              {fps} FPS
            </span>
            <span style={{ background: 'rgba(0,0,0,0.85)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '10px', padding: '3px 8px', borderRadius: 3, fontFamily: 'monospace' }}>
              {latencyMs}ms LATENCY
            </span>
            <span style={{
              background: lockInfo?.locked ? '#ffffff' : 'rgba(0,0,0,0.85)',
              color: lockInfo?.locked ? '#000000' : '#888',
              border: '1px solid rgba(255,255,255,0.2)',
              fontSize: '10px',
              padding: '3px 8px',
              borderRadius: 3,
              fontWeight: 800,
              fontFamily: 'monospace'
            }}>
              {lockInfo?.locked ? `TARGET: ${lockInfo.species?.toUpperCase()}` : 'MONITORING RAW FEED (NO LOCK)'}
            </span>
          </div>
        </div>

        {/* Right Telemetry & Scout Geolocation Column */}
        <div style={{ background: '#0e0e12', borderLeft: '1px solid rgba(255,255,255,0.1)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Geolocation Card */}
          <div style={{ background: '#141418', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: '#fff', fontSize: '11px', letterSpacing: '0.08em' }}>
              <MapPin size={13} /> PATROL GEOLOCATION
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginBottom: 4 }}>
              {locationInfo?.name || 'Corbett Sector 4 Patrol'}
            </div>
            <div style={{ fontSize: '11px', color: '#aaa', fontFamily: 'monospace', marginBottom: 8 }}>
              {locationInfo?.lat ? `${locationInfo.lat}° N, ${locationInfo.lng}° E` : '29.5312° N, 78.7744° E'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#777', borderTop: '1px solid #222', paddingTop: 8 }}>
              <span>SCOUT:</span>
              <strong style={{ color: '#ccc' }}>{uploaderInfo?.name || 'Patrol Ranger'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#777', marginTop: 4 }}>
              <span>ACCURACY:</span>
              <strong style={{ color: '#ccc' }}>&plusmn;{locationInfo?.accuracy || 10}m</strong>
            </div>
          </div>

          {/* Active Target Lock Telemetry */}
          <div style={{ background: '#141418', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 14, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: '#fff', fontSize: '11px', letterSpacing: '0.08em' }}>
              <Crosshair size={13} /> LOCK TELEMETRY
            </div>

            {lockInfo?.locked ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: '14px', fontWeight: 900, color: '#fff' }}>
                    {lockInfo.species?.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: lockInfo.predicted ? 'rgba(255,255,255,0.2)' : '#ffffff',
                    color: lockInfo.predicted ? '#fff' : '#000',
                    fontWeight: 800
                  }}>
                    {lockInfo.predicted ? 'PREDICTED HOLD' : 'LOCKED'}
                  </span>
                </div>

                <div style={{ fontSize: '11px', color: '#bbb', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #222', paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Vector:</span>
                    <strong style={{ color: '#fff', fontFamily: 'monospace' }}>{lockInfo.direction || 'CENTERED'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Offset dx/dy:</span>
                    <strong style={{ color: '#fff', fontFamily: 'monospace' }}>
                      dx: {typeof lockInfo.dx === 'number' ? lockInfo.dx.toFixed(3) : '0.000'} | dy: {typeof lockInfo.dy === 'number' ? lockInfo.dy.toFixed(3) : '0.000'}
                    </strong>
                  </div>
                  {lockInfo.predicted && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Grace Frames:</span>
                      <strong style={{ color: '#fff', fontFamily: 'monospace' }}>{lockInfo.lost_count || 1} / 10</strong>
                    </div>
                  )}
                </div>

                {/* Biometrics if present */}
                {lockInfo.attributes && (
                  <div style={{ marginTop: 12, borderTop: '1px solid #222', paddingTop: 8 }}>
                    <div style={{ fontSize: '10px', color: '#888', marginBottom: 6, letterSpacing: '0.05em' }}>
                      AUTOMATED BIOMETRICS
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {lockInfo.attributes.vitality_status && (
                        <div style={{ background: '#1c1c22', padding: '6px 8px', borderRadius: 4 }}>
                          <span style={{ fontSize: '9px', color: '#777', display: 'block' }}>VITALITY</span>
                          <strong style={{ fontSize: '11px', color: '#fff' }}>{lockInfo.attributes.vitality_status}</strong>
                        </div>
                      )}
                      {lockInfo.attributes.estimated_weight_kg && (
                        <div style={{ background: '#1c1c22', padding: '6px 8px', borderRadius: 4 }}>
                          <span style={{ fontSize: '9px', color: '#777', display: 'block' }}>WEIGHT</span>
                          <strong style={{ fontSize: '11px', color: '#fff' }}>{lockInfo.attributes.estimated_weight_kg} kg</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Stage 3 Recommended Dart Dosage */}
                {lockInfo.dosage && (
                  <div style={{ marginTop: 12, borderTop: '1px solid #222', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: '10px', color: '#fff', letterSpacing: '0.05em', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Crosshair size={11} /> STAGE 3 DART DOSAGE
                      </span>
                      {lockInfo.dosage.confidence !== undefined && (
                        <span style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(255,255,255,0.15)', borderRadius: 2, color: '#fff' }}>
                          {Math.round((lockInfo.dosage.confidence || 0.9) * 100)}% CONF
                        </span>
                      )}
                    </div>

                    <div style={{ background: '#1c1c22', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '8px 10px', marginBottom: 6 }}>
                      <div style={{ fontSize: '9px', color: '#888', marginBottom: 2 }}>PRIMARY DRUG:</div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                        {lockInfo.dosage.drug_recommendation || 'Wildlife Formulation'}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: 2 }}>
                        <span style={{ color: '#aaa' }}>Total Mass:</span>
                        <strong style={{ color: '#fff' }}>{lockInfo.dosage.dosage_mg} mg</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: '#aaa' }}>Unit Dose:</span>
                        <strong style={{ color: '#ccc' }}>{lockInfo.dosage.dosage_per_kg} mg/kg</strong>
                      </div>
                    </div>

                    {lockInfo.dosage.notes && (
                      <div style={{ fontSize: '10px', color: '#888', lineHeight: 1.3, marginBottom: 6 }}>
                        {lockInfo.dosage.notes}
                      </div>
                    )}

                    {/* Persistent Disclaimer */}
                    <div style={{ fontSize: '9px', color: '#ffb020', background: 'rgba(255,176,32,0.08)', border: '1px solid rgba(255,176,32,0.25)', borderRadius: 3, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertCircle size={10} color="#ffb020" />
                      <span>{lockInfo.dosage.disclaimer || "AI-estimated dosage — verify before administering"}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: '#777', fontSize: '11px', textAlign: 'center', padding: '30px 10px' }}>
                <Eye size={24} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <div>RAW VIDEO ONLY</div>
                <div style={{ fontSize: '10px', color: '#555', marginTop: 4 }}>
                  Continuous feed publishing is active. Lock metadata will appear when scout locks target.
                </div>
              </div>
            )}
          </div>

          {/* Time and Relay Status */}
          <div style={{ fontSize: '10px', color: '#666', borderTop: '1px solid #222', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={11} /> {lastPayload?.timestamp ? new Date(lastPayload.timestamp).toLocaleTimeString() : '--:--:--'}
            </span>
            <span>EXTERNAL RELAY ACTIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveFeedViewer;

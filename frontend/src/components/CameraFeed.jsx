import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera,
  SwitchCamera,
  Zap,
  ZapOff,
  AlertCircle,
  Film,
  Play,
  Pause,
  Upload,
  Radio,
  Share2,
  Cpu,
  X,
  Check,
  RefreshCw
} from 'lucide-react';
import { soundFx } from '../utils/audio';
import {
  UserMediaFrameSource,
  VideoFileFrameSource,
  ESP32MjpegFrameSource
} from '../utils/frameSource';

export const CameraFeed = ({
  wsClient,
  detections = [],
  tracking = null,
  targetFps = 12,
  onManualTapLock,
  facingMode = 'environment',
  onToggleFacingMode,
  initialSourceType = 'camera',
  initialEsp32Url = 'http://172.16.4.122:81/stream'
}) => {
  const videoRef = useRef(null);
  const imgRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Frame Source Abstraction Instance
  const frameSourceRef = useRef(null);

  const [feedSourceType, setFeedSourceType] = useState(initialSourceType); // 'camera' | 'video' | 'esp32'
  const [videoFileName, setVideoFileName] = useState('');
  const [isVideoPaused, setIsVideoPaused] = useState(false);

  // ESP32 Stream config (persisted in localStorage)
  const [esp32StreamUrl, setEsp32StreamUrl] = useState(() => {
    return localStorage.getItem('sentrywing_esp32_url') || initialEsp32Url;
  });
  const [showEsp32Modal, setShowEsp32Modal] = useState(false);
  const [tempEsp32Url, setTempEsp32Url] = useState(() => {
    return localStorage.getItem('sentrywing_esp32_url') || initialEsp32Url;
  });
  const [esp32Testing, setEsp32Testing] = useState(false);
  const [esp32TestResult, setEsp32TestResult] = useState(null);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Available camera hardware enumeration
  const isMobileClient = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [availableVideoDevices, setAvailableVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const captureTimerRef = useRef(null);
  const currentFacingModeRef = useRef(facingMode);
  currentFacingModeRef.current = facingMode;

  // Enumerate hardware cameras
  useEffect(() => {
    let isMounted = true;
    const enumerateInputs = async () => {
      if (navigator?.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const vDevs = devices.filter((d) => d.kind === 'videoinput');
          if (isMounted) {
            setAvailableVideoDevices(vDevs);
          }
        } catch (_) {}
      }
    };
    enumerateInputs();
    return () => { isMounted = false; };
  }, [streamActive]);

  // =========================================================================
  // FRAME SOURCE INITIALIZATION VIA UNIFIED ABSTRACTION
  // =========================================================================

  const initCameraSource = useCallback(async (options = {}) => {
    setCameraError(null);
    setStreamActive(false);

    if (frameSourceRef.current) {
      frameSourceRef.current.destroy();
      frameSourceRef.current = null;
    }

    const deviceIdToUse = options.deviceId !== undefined ? options.deviceId : selectedDeviceId;
    const facingToUse = options.facingMode || currentFacingModeRef.current || (isMobileClient ? 'environment' : 'user');

    try {
      const source = new UserMediaFrameSource();
      await source.init({
        facingMode: facingToUse,
        deviceId: deviceIdToUse || undefined,
        videoElement: videoRef.current
      });

      frameSourceRef.current = source;
      setStreamActive(true);
      setFeedSourceType('camera');
      setVideoFileName('');

      const caps = source.getCapabilities();
      setTorchAvailable(caps.torchAvailable);
      setTorchOn(caps.torchOn);
    } catch (err) {
      console.error('FrameSource camera error:', err);
      let cat = 'unknown';
      let title = 'FRAME SOURCE SENSOR OFFLINE';
      let guidance = 'Camera hardware access could not be initialized.';

      const errName = err?.name || '';
      const errMsg = err?.message || String(err || '');

      const isPermissionDenied =
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errMsg.toLowerCase().includes('permission denied') ||
        errMsg.toLowerCase().includes('not allowed');

      const isInsecure =
        errName === 'InsecureContextError' ||
        (typeof window !== 'undefined' && !window.isSecureContext);

      const isNotFound =
        errName === 'NotFoundError' ||
        errName === 'DevicesNotFoundError';

      const isInUse =
        errName === 'NotReadableError' ||
        errName === 'TrackStartError';

      if (isPermissionDenied) {
        cat = 'permission_denied';
        title = 'CAMERA PERMISSION BLOCKED';
        guidance = 'Browser or operating system denied access to the camera.';
      } else if (isInsecure) {
        cat = 'insecure_context';
        title = 'HTTPS SECURE CONTEXT REQUIRED';
        guidance = 'Modern browsers strictly require HTTPS or http://localhost for camera access.';
      } else if (isNotFound) {
        cat = 'not_found';
        title = 'NO CAMERA HARDWARE DETECTED';
        guidance = 'No video capture sensor was detected on this device.';
      } else if (isInUse) {
        cat = 'in_use';
        title = 'CAMERA IN USE BY ANOTHER APPLICATION';
        guidance = 'The webcam is currently locked by another program (e.g. Zoom, Teams, Camera app).';
      }

      setCameraError({
        category: cat,
        title,
        guidance,
        message: errMsg || 'Permission denied'
      });
    }
  }, [selectedDeviceId, isMobileClient]);

  const handleTestEsp32 = async () => {
    setEsp32Testing(true);
    setEsp32TestResult(null);
    try {
      const resp = await fetch(`/api/esp32/status?url=${encodeURIComponent(tempEsp32Url)}`);
      const data = await resp.json();
      setEsp32TestResult(data);
    } catch (e) {
      setEsp32TestResult({ online: false, error: 'Failed to contact backend status probe' });
    } finally {
      setEsp32Testing(false);
    }
  };

  const initEsp32Source = useCallback(async (url) => {
    const streamUrl = (url || esp32StreamUrl).trim();
    setCameraError(null);
    setStreamActive(false);
    try {
      localStorage.setItem('sentrywing_esp32_url', streamUrl);
    } catch (_) {}

    if (imgRef.current) {
      imgRef.current.style.display = 'none';
      try {
        imgRef.current.removeAttribute('src');
        imgRef.current.src = '';
      } catch (_) {}
    }

    if (frameSourceRef.current) {
      frameSourceRef.current.destroy();
      frameSourceRef.current = null;
    }

    try {
      const source = new ESP32MjpegFrameSource();
      await source.init({
        streamUrl: streamUrl,
        imgElement: imgRef.current
      });

      frameSourceRef.current = source;
      setFeedSourceType('esp32');
      setEsp32StreamUrl(streamUrl);
      setStreamActive(true);
      setTorchAvailable(false);
      setTorchOn(false);
      if (imgRef.current) {
        imgRef.current.style.display = 'block';
      }
      soundFx.playTapClick();
    } catch (err) {
      console.error('FrameSource ESP32 error:', err);
      if (imgRef.current) {
        imgRef.current.style.display = 'none';
        try {
          imgRef.current.removeAttribute('src');
          imgRef.current.src = '';
        } catch (_) {}
      }
      setFeedSourceType('esp32');
      setStreamActive(false);
      setCameraError({
        category: 'esp32_offline',
        title: 'ESP32 STREAM OFFLINE',
        guidance: 'Unable to connect to the MJPEG network stream.',
        message: `Connection failed to ${streamUrl}. Please verify ESP32 Wi-Fi and IP address.`
      });
    }
  }, [esp32StreamUrl]);

  useEffect(() => {
    if (feedSourceType === 'camera') {
      initCameraSource();
    } else if (feedSourceType === 'esp32') {
      initEsp32Source(esp32StreamUrl);
    }
    return () => {
      if (frameSourceRef.current) {
        frameSourceRef.current.destroy();
      }
    };
  }, [initCameraSource, facingMode, feedSourceType]);

  // Video File Selection through FrameSource
  const handleVideoFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (frameSourceRef.current) {
      frameSourceRef.current.destroy();
      frameSourceRef.current = null;
    }

    setCameraError(null);
    setTorchAvailable(false);
    setTorchOn(false);

    try {
      const source = new VideoFileFrameSource();
      await source.init({
        file,
        videoElement: videoRef.current
      });

      frameSourceRef.current = source;
      setFeedSourceType('video');
      setVideoFileName(file.name);
      setStreamActive(true);
      setIsVideoPaused(false);
      soundFx.playTapClick();
    } catch (err) {
      console.error('FrameSource video error:', err);
      setCameraError(`Could not play video file: ${err.message}`);
    }
  };

  const handleSwitchToCamera = () => {
    soundFx.playTapClick();
    setFeedSourceType('camera');
    setVideoFileName('');
    initCameraSource();
  };

  const handleTogglePlayPause = () => {
    if (!frameSourceRef.current || feedSourceType !== 'video') return;
    soundFx.playTapClick();
    if (frameSourceRef.current instanceof VideoFileFrameSource) {
      const isPlaying = frameSourceRef.current.togglePlayPause();
      setIsVideoPaused(!isPlaying);
    }
  };

  const toggleTorch = async () => {
    if (frameSourceRef.current && frameSourceRef.current instanceof UserMediaFrameSource) {
      const state = await frameSourceRef.current.toggleTorch();
      setTorchOn(state);
      soundFx.playTapClick();
    }
  };

  // =========================================================================
  // CAPTURE LOOP: USES STRICT getNextFrame() ABSTRACTION INTERFACE
  // =========================================================================

  useEffect(() => {
    if (!streamActive || !wsClient) return;

    const intervalMs = Math.round(1000 / Math.max(1, targetFps));

    const captureFrame = async () => {
      const source = frameSourceRef.current;
      if (!source || !source.isActive()) return;

      try {
        const frameData = await source.getNextFrame(captureCanvasRef.current);
        if (frameData && frameData.blob && wsClient) {
          wsClient.sendFrameBlob(frameData.blob);
        }
      } catch (err) {
        console.warn('Frame capture error:', err);
      }
    };

    captureTimerRef.current = setInterval(captureFrame, intervalMs);

    return () => {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
      }
    };
  }, [streamActive, wsClient, targetFps]);

  // =========================================================================
  // TAP TO LOCK
  // =========================================================================

  const handleCanvasClick = (e) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    soundFx.playTapClick();
    if (onManualTapLock) {
      onManualTapLock(clickX, clickY);
    }
  };

  // =========================================================================
  // TACTICAL OVERLAY CANVAS: RENDERS PREDICTED DASHED RETICLE & DETECTIONS
  // =========================================================================

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Draw Screen Center Crosshair & Deadband
    const cx = width / 2;
    const cy = height / 2;
    const deadbandRadius = width * 0.08;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.arc(cx, cy, deadbandRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();

    const isLocked = Boolean(tracking && tracking.locked);
    const isPredicted = Boolean(tracking && tracking.predicted);
    const lockedBBox = tracking ? tracking.target_bbox : null;

    // 2. Draw Unlocked Detections
    detections.forEach((det) => {
      const [nx1, ny1, nx2, ny2] = det.bbox;
      const bx1 = nx1 * width;
      const by1 = ny1 * height;
      const bw = (nx2 - nx1) * width;
      const bh = (ny2 - ny1) * height;

      const matchesLockedBox =
        isLocked &&
        lockedBBox &&
        Math.abs(lockedBBox[0] - nx1) < 0.08 &&
        Math.abs(lockedBBox[1] - ny1) < 0.08;

      if (det.is_locked || matchesLockedBox) {
        return; // Handled below in dedicated locked target pass
      }

      // Sleek silver hairline bounding box
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
      ctx.shadowBlur = 6;
      ctx.setLineDash([]);

      ctx.strokeRect(bx1, by1, bw, bh);

      // Label Tag
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(10, 10, 14, 0.92)';
      const labelText = `${det.class_name} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = '11px JetBrains Mono, monospace';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillRect(bx1, Math.max(0, by1 - 20), textWidth + 10, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, bx1 + 5, Math.max(13, by1 - 7));
    });

    // 3. Dedicated Locked Target Rendering (Supports Freshly Detected & Predicted Grace Frames)
    if (isLocked && lockedBBox && lockedBBox.length === 4) {
      const [lx1, ly1, lx2, ly2] = lockedBBox;
      const bx1 = lx1 * width;
      const by1 = ly1 * height;
      const bw = (lx2 - lx1) * width;
      const bh = (ly2 - ly1) * height;

      const tcx = bx1 + bw / 2;
      const tcy = by1 + bh / 2;

      if (isPredicted) {
        // =====================================================================
        // PREDICTED POSITION (Motion Blur / Brief Occlusion Grace Period)
        // Distinctive DASHED tactical box + Dead Reckoning indicator
        // =====================================================================
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([8, 6]); // DASHED!
        ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
        ctx.shadowBlur = 14;

        ctx.strokeRect(bx1, by1, bw, bh);

        // Dashed center reticle ring
        ctx.beginPath();
        ctx.arc(tcx, tcy, 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tcx, tcy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Dashed Vector tracking line from center
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tcx, tcy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tactical Predicted Badge
        ctx.shadowBlur = 0;
        const lostCount = tracking.lost_count || 1;
        const maxThreshold = tracking.max_lost_threshold || 10;
        const labelText = `[PREDICTED HOLD ${lostCount}/${maxThreshold}] ${(tracking.target_class || 'TARGET').toUpperCase()}`;
        ctx.font = 'bold 11px Orbitron, sans-serif';
        const textWidth = ctx.measureText(labelText).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(bx1, Math.max(0, by1 - 24), textWidth + 14, 22);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(bx1, Math.max(0, by1 - 24), textWidth + 14, 22);
        ctx.setLineDash([]);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, bx1 + 7, Math.max(15, by1 - 8));

      } else {
        // =====================================================================
        // CONFIRMED FRESH DETECTION (Solid Brilliant White Tactical Brackets)
        // =====================================================================
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.8;
        ctx.setLineDash([]); // SOLID!
        ctx.shadowColor = 'rgba(255, 255, 255, 0.95)';
        ctx.shadowBlur = 18;

        const cornerLen = Math.min(24, bw * 0.25, bh * 0.25);

        // Top-Left
        ctx.beginPath();
        ctx.moveTo(bx1, by1 + cornerLen);
        ctx.lineTo(bx1, by1);
        ctx.lineTo(bx1 + cornerLen, by1);
        ctx.stroke();

        // Top-Right
        ctx.beginPath();
        ctx.moveTo(bx1 + bw - cornerLen, by1);
        ctx.lineTo(bx1 + bw, by1);
        ctx.lineTo(bx1 + bw, by1 + cornerLen);
        ctx.stroke();

        // Bottom-Left
        ctx.beginPath();
        ctx.moveTo(bx1, by1 + bh - cornerLen);
        ctx.lineTo(bx1, by1 + bh);
        ctx.lineTo(bx1 + cornerLen, by1 + bh);
        ctx.stroke();

        // Bottom-Right
        ctx.beginPath();
        ctx.moveTo(bx1 + bw - cornerLen, by1 + bh);
        ctx.lineTo(bx1 + bw, by1 + bh);
        ctx.lineTo(bx1 + bw, by1 + bh - cornerLen);
        ctx.stroke();

        // Solid Center target dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tcx, tcy, 5, 0, Math.PI * 2);
        ctx.fill();

        // Vector tracking line from center
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tcx, tcy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pure White High-Contrast Badge
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        const targetClass = (tracking.target_class || 'TARGET').toUpperCase();
        const labelText = `[LOCKED] ${targetClass}`;
        ctx.font = 'bold 12px Orbitron, sans-serif';
        const textWidth = ctx.measureText(labelText).width;

        ctx.fillRect(bx1, Math.max(0, by1 - 24), textWidth + 14, 22);
        ctx.fillStyle = '#000000';
        ctx.fillText(labelText, bx1 + 7, Math.max(15, by1 - 8));
      }
    }

    ctx.restore();
  }, [detections, tracking]);

  return (
    <div className="viewport-wrapper">
      {/* Hidden file input for uploading animal video */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
        style={{ display: 'none' }}
        onChange={handleVideoFileSelect}
      />

      {/* HTML5 Video element (Used by UserMediaFrameSource & VideoFileFrameSource) */}
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        autoPlay
        muted
        style={{
          display: feedSourceType !== 'esp32' ? 'block' : 'none',
          opacity: streamActive && !cameraError ? 1 : 0,
          pointerEvents: streamActive && !cameraError ? 'auto' : 'none'
        }}
        loop={feedSourceType === 'video'}
      />

      {/* HTML5 Image element (Used by ESP32MjpegFrameSource) */}
      <img
        ref={imgRef}
        className="camera-video"
        alt=""
        crossOrigin="anonymous"
        style={{
          display: feedSourceType === 'esp32' && streamActive && !cameraError ? 'block' : 'none',
          objectFit: 'cover'
        }}
        onError={() => {
          if (feedSourceType === 'esp32') {
            setStreamActive(false);
            setCameraError({
              category: 'esp32_offline',
              title: 'ESP32 STREAM OFFLINE',
              guidance: 'Unable to connect to the MJPEG network stream.',
              message: `Connection failed to ${esp32StreamUrl}. Please verify ESP32 Wi-Fi and IP address.`
            });
            if (imgRef.current) {
              imgRef.current.style.display = 'none';
              try {
                imgRef.current.removeAttribute('src');
                imgRef.current.src = '';
              } catch (_) {}
            }
          }
        }}
      />

      {/* Hidden canvas for JPEG frame capture abstraction */}
      <canvas ref={captureCanvasRef} className="canvas-capture-hidden" />

      {/* High-precision interactive HUD overlay canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="canvas-overlay"
        onClick={handleCanvasClick}
      />

      {/* Top HUD Badges (Feed Source + Live External Feed Publisher Status) */}
      <div className="feed-source-indicator">
        {feedSourceType === 'video' ? (
          <div className="source-pill video-pill">
            <Film size={12} color="#ffffff" />
            <span className="source-name">VIDEO: {videoFileName || 'FILE'}</span>
            <span className="source-status" style={{ color: isVideoPaused ? '#ffaa00' : '#00ff88', fontWeight: 700 }}>
              {isVideoPaused ? '[PAUSED]' : '[STREAMING]'}
            </span>
          </div>
        ) : feedSourceType === 'esp32' ? (
          <div className="source-pill esp32-pill" style={{
            background: streamActive && !cameraError ? 'rgba(0, 255, 136, 0.12)' : 'rgba(255, 107, 107, 0.15)',
            border: streamActive && !cameraError ? '1px solid rgba(0, 255, 136, 0.4)' : '1px solid rgba(255, 107, 107, 0.4)'
          }}>
            <Cpu size={12} color={streamActive && !cameraError ? '#00ff88' : '#ff6b6b'} />
            <span className="source-name">ESP32-CAM MJPEG</span>
            <span className="source-status" style={{ color: streamActive && !cameraError ? '#00ff88' : '#ff6b6b', fontWeight: 700 }}>
              {streamActive && !cameraError ? '[STREAMING]' : '[OFFLINE]'}
            </span>
          </div>
        ) : (
          <div className="source-pill camera-pill" style={{
            background: streamActive && !cameraError ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 107, 107, 0.15)',
            border: streamActive && !cameraError ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgba(255, 107, 107, 0.4)'
          }}>
            <Camera size={12} color={streamActive && !cameraError ? '#ffffff' : '#ff6b6b'} />
            <span className="source-name">
              LIVE CAMERA [{facingMode === 'user' ? (isMobileClient ? 'FRONT' : 'WEBCAM') : (isMobileClient ? 'REAR' : 'ENVIRONMENT')}]
            </span>
            <span className="source-status" style={{ color: streamActive && !cameraError ? '#00ff88' : '#ff6b6b', fontWeight: 700 }}>
              {streamActive && !cameraError ? '[ACTIVE]' : '[OFFLINE]'}
            </span>
          </div>
        )}

        {/* External Feed Publishing Status Badge */}
        <div className="source-pill publish-pill" title="Continuous feed publishing to external endpoint /ws/live-feed">
          <Share2 size={12} color="#00ff88" />
          <span className="source-name">FEED PUBLISHER:</span>
          <span className="source-status" style={{ color: '#00ff88', fontWeight: 800 }}>
            [LIVE / BROADCASTING]
          </span>
        </div>
      </div>

      {/* Loading / Placeholder Screen */}
      {!streamActive && !cameraError && (
        <div className="camera-placeholder">
          <div className="radar-spinner" />
          <div style={{ fontFamily: 'var(--font-hud)', fontSize: '13px', color: '#ffffff', letterSpacing: '0.08em' }}>
            INITIALIZING SENSOR ABSTRACTION...
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', maxWidth: '280px' }}>
            Connecting frame source: {feedSourceType.toUpperCase()}...
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '8px 14px', fontSize: '11px' }}
              onClick={() => initCameraSource()}
            >
              <Camera size={14} /> {isMobileClient ? 'PHONE CAMERA' : 'LAPTOP WEBCAM'}
            </button>
            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '8px 14px', fontSize: '11px' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Film size={14} /> SELECT VIDEO FILE
            </button>
            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '8px 14px', fontSize: '11px' }}
              onClick={() => setShowEsp32Modal(true)}
            >
              <Cpu size={14} /> CONNECT ESP32-CAM
            </button>
          </div>
        </div>
      )}

      {/* Tactical Camera Access Error & Diagnostic Troubleshooting HUD */}
      {cameraError && (
        <div className="camera-placeholder" style={{ background: 'rgba(8, 8, 10, 0.97)', padding: '24px 18px', zIndex: 12 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(255, 107, 107, 0.12)',
            border: '1px solid rgba(255, 107, 107, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff6b6b',
            marginBottom: 2
          }}>
            <AlertCircle size={26} />
          </div>

          <div style={{ fontFamily: 'var(--font-hud)', fontSize: '15px', color: '#ffffff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {cameraError.title || 'FRAME SOURCE SENSOR OFFLINE'}
          </div>

          <div style={{
            fontSize: '12px',
            color: 'rgba(255, 255, 255, 0.88)',
            maxWidth: '520px',
            lineHeight: 1.5,
            background: 'rgba(20, 10, 10, 0.7)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 107, 107, 0.3)',
            textAlign: 'left',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
          }}>
            <div style={{ fontWeight: 700, color: '#ff7777', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>SENSOR STATUS:</span>
              <span style={{ fontFamily: 'var(--font-mono)', background: 'rgba(255, 107, 107, 0.18)', padding: '2px 8px', borderRadius: 4 }}>
                {cameraError.message || 'Permission denied'}
              </span>
            </div>
            <div style={{ color: '#cccccc', fontSize: '11.5px', marginBottom: cameraError.category === 'permission_denied' ? 8 : 0 }}>
              {cameraError.guidance}
            </div>

            {/* Tactical step-by-step fix guide for Permission Denied */}
            {cameraError.category === 'permission_denied' && (
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: '11px',
                color: '#bbb',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: '#00ff88', fontWeight: 800 }}>1.</span>
                  <span><strong>Browser Site Permission:</strong> Click the <strong>Lock (🔒) or Tune (🎛️)</strong> icon on the left side of your browser address bar next to the URL. Set <strong>Camera</strong> from <em>Block</em> to <strong>Allow</strong>.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: '#00ff88', fontWeight: 800 }}>2.</span>
                  <span><strong>Windows Privacy Settings:</strong> Press Windows Key, search <em>"Camera privacy settings"</em>, and verify that <strong>"Camera access"</strong> and <strong>"Let desktop apps access your camera"</strong> are turned <strong>ON</strong>.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: '#00ff88', fontWeight: 800 }}>3.</span>
                  <span><strong>Hardware In Use:</strong> Check that no other application (Zoom, Teams, Skype, OBS, or Windows Camera) is actively holding the webcam stream.</span>
                </div>
              </div>
            )}

            {/* Insecure Context Hint */}
            {cameraError.category === 'insecure_context' && (
              <div style={{ marginTop: 8, fontSize: '11px', color: '#ffaa00' }}>
                💡 <strong>HTTPS Context:</strong> Access via <code>https://&lt;IP&gt;:5173</code> or run directly on <code>http://localhost:5173</code> to satisfy browser camera security policies.
              </div>
            )}
          </div>

          {/* Device switcher if multiple cameras detected */}
          {availableVideoDevices.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: '11px', color: '#888', letterSpacing: '0.05em' }}>SELECT WEBCAM:</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  const devId = e.target.value;
                  setSelectedDeviceId(devId);
                  initCameraSource({ deviceId: devId });
                }}
                style={{
                  background: '#141414',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  padding: '5px 12px',
                  borderRadius: 4,
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                <option value="">Default ({facingMode === 'user' ? 'Webcam / Front' : 'Rear'})</option>
                {availableVideoDevices.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `Camera Device ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {feedSourceType === 'esp32' && (
              <button
                className="btn-tactical-main"
                style={{ width: 'auto', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', background: 'rgba(0, 255, 136, 0.15)', borderColor: '#00ff88', color: '#00ff88' }}
                onClick={() => initEsp32Source(esp32StreamUrl)}
              >
                <RefreshCw size={15} /> RETRY ESP32 STREAM
              </button>
            )}

            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              onClick={() => initCameraSource()}
            >
              <Camera size={15} /> {isMobileClient ? 'RETRY PHONE CAMERA' : 'RETRY WEBCAM ACCESS'}
            </button>

            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              onClick={() => {
                if (onToggleFacingMode) {
                  onToggleFacingMode();
                } else {
                  const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
                  initCameraSource({ facingMode: nextFacing });
                }
              }}
            >
              <SwitchCamera size={15} /> {facingMode === 'environment' ? 'SWITCH TO WEBCAM (FRONT)' : 'SWITCH TO REAR CAMERA'}
            </button>

            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Film size={15} /> SELECT VIDEO FILE
            </button>

            <button
              className="btn-tactical-main"
              style={{ width: 'auto', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              onClick={() => setShowEsp32Modal(true)}
            >
              <Cpu size={15} /> CONFIGURE ESP32
            </button>
          </div>
        </div>
      )}

      {/* Floating Action Controls */}
      <div style={{ position: 'absolute', right: 18, bottom: 105, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 14 }}>
        <button
          className={`btn-icon-tactical ${feedSourceType === 'video' ? 'active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          title="Upload / Select Animal Video File"
        >
          <Film size={22} />
        </button>

        <button
          className={`btn-icon-tactical ${feedSourceType === 'esp32' ? 'active' : ''}`}
          onClick={() => setShowEsp32Modal(true)}
          title="Configure ESP32-CAM MJPEG Stream"
        >
          <Cpu size={22} />
        </button>

        {feedSourceType === 'video' && (
          <>
            <button
              className="btn-icon-tactical"
              onClick={handleTogglePlayPause}
              title={isVideoPaused ? 'Play Video' : 'Pause Video'}
            >
              {isVideoPaused ? <Play size={22} /> : <Pause size={22} />}
            </button>
            <button
              className="btn-icon-tactical"
              onClick={handleSwitchToCamera}
              title="Switch back to Live Camera"
            >
              <Camera size={22} />
            </button>
          </>
        )}

        {feedSourceType === 'esp32' && (
          <button
            className="btn-icon-tactical"
            onClick={handleSwitchToCamera}
            title="Switch back to Live Camera"
          >
            <Camera size={22} />
          </button>
        )}

        {feedSourceType === 'camera' && (
          <>
            <button
              className="btn-icon-tactical"
              onClick={onToggleFacingMode}
              title="Switch Front/Rear Camera"
            >
              <SwitchCamera size={22} />
            </button>

            {torchAvailable && (
              <button
                className={`btn-icon-tactical ${torchOn ? 'active' : ''}`}
                onClick={toggleTorch}
                title="Toggle Flashlight"
                style={{ color: torchOn ? '#ffffff' : 'var(--text-dim)' }}
              >
                {torchOn ? <Zap size={22} /> : <ZapOff size={22} />}
              </button>
            )}
          </>
        )}
      </div>

      {/* ESP32 Stream URL Modal */}
      {showEsp32Modal && (
        <div className="modal-backdrop" onClick={() => setShowEsp32Modal(false)} style={{ zIndex: 100 }}>
          <div className="tactical-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, padding: 22 }}>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <div className="modal-title-row">
                <Cpu size={18} />
                <h4>CONNECT ESP32-CAM MJPEG STREAM</h4>
              </div>
              <button className="btn-icon-close" onClick={() => setShowEsp32Modal(false)}>
                <X size={16} />
              </button>
            </div>
            <p style={{ fontSize: '12px', color: '#aaa', marginBottom: 14 }}>
              Enter the HTTP stream URL exposed by your ESP32-CAM (OV2640) Wi-Fi module. The FrameSource abstraction seamlessly ingests frames into the neural tracker and feed publisher.
            </p>
            <div className="input-field" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: '11px', color: '#ccc', display: 'block', marginBottom: 6 }}>
                ESP32 Stream URL
              </label>
              <input
                type="text"
                className="tactical-input"
                style={{ width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 4 }}
                value={tempEsp32Url}
                onChange={(e) => {
                  setTempEsp32Url(e.target.value);
                  setEsp32TestResult(null);
                }}
                placeholder="http://172.16.4.122:81/stream"
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#aaa', fontSize: '10px', padding: '2px 8px', borderRadius: 3, cursor: 'pointer' }}
                  onClick={() => setTempEsp32Url('http://172.16.4.122:81/stream')}
                >
                  Preset: 172.16.4.122:81
                </button>
                <button
                  type="button"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#aaa', fontSize: '10px', padding: '2px 8px', borderRadius: 3, cursor: 'pointer' }}
                  onClick={() => setTempEsp32Url('http://192.168.4.1/stream')}
                >
                  Preset: 192.168.4.1 AP
                </button>
              </div>
            </div>

            {/* Live Connection Test Probe Result */}
            {esp32TestResult && (
              <div style={{
                padding: '8px 12px',
                borderRadius: 4,
                marginBottom: 14,
                fontSize: '11px',
                background: esp32TestResult.online ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 70, 70, 0.1)',
                border: esp32TestResult.online ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid rgba(255, 70, 70, 0.3)',
                color: esp32TestResult.online ? '#00ff88' : '#ff6b6b'
              }}>
                {esp32TestResult.online
                  ? `🟢 ONLINE: Responding (HTTP ${esp32TestResult.status_code}, ${esp32TestResult.latency_ms}ms)`
                  : `🔴 UNREACHABLE: ${esp32TestResult.error || 'Connection timed out. Verify Wi-Fi and 5V power.'}`}
              </div>
            )}

            <div className="modal-actions-bar" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-cancel"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px' }}
                disabled={esp32Testing}
                onClick={handleTestEsp32}
              >
                <RefreshCw size={12} className={esp32Testing ? 'spin-anim' : ''} />
                {esp32Testing ? 'TESTING...' : 'TEST LINK'}
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowEsp32Modal(false)}
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  className="btn-primary-action"
                  onClick={() => {
                    setShowEsp32Modal(false);
                    initEsp32Source(tempEsp32Url);
                  }}
                >
                  <Check size={14} /> CONNECT STREAM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

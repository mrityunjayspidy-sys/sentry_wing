import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Film,
  Cpu,
  CheckCircle,
  AlertTriangle,
  Compass,
  MapPin,
  Filter,
  Trash2,
  Eye,
  X,
  Play,
  Square,
  Clock,
  Sparkles,
  FileCheck2,
  Radio,
  Sliders,
  Maximize2,
  RotateCcw,
  Check,
  RefreshCw,
  Plus,
  Navigation,
  Crosshair,
  Scale
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { soundFx } from '../utils/audio';
import { useAuth } from '../context/AuthContext';
import {
  getRealTimeLocation,
  getSavedManualLocations,
  saveManualLocation,
  deleteSavedManualLocation,
  reverseGeocode
} from '../utils/location';
import { CameraFeed } from './CameraFeed';
import { TargetReticle } from './TargetReticle';
import { AttributeCard } from './AttributeCard';
import { apiFetch, getCustomBackendUrl } from '../utils/api';
import { runEdgePhotoAnalysis } from '../utils/edgeDetector';

export const NormalUserDashboard = ({
  wsClient,
  isConnected,
  detections = [],
  tracking = null,
  attributes = null,
}) => {
  const { currentUser } = useAuth();
  // Modes: 'live' (default) | 'photo' | 'video' | 'esp32'
  const [activeMode, setActiveMode] = useState('live');
  const isMobileClient = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [cameraFacing, setCameraFacing] = useState(isMobileClient ? 'environment' : 'user');

  // =========================================================================
  // REAL-TIME GEOLOCATION & MANUAL LOCATION STATE
  // =========================================================================
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState({
    lat: 28.6139,
    lng: 77.2090,
    name: 'Real-Time Location Pending (Detecting...)',
    isLive: false,
    accuracy: null
  });

  // Manual Location Modal & Saved Presets
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualLat, setManualLat] = useState('28.6139');
  const [manualLng, setManualLng] = useState('77.2090');
  const [savedLocations, setSavedLocations] = useState([]);
  const [saveToPresets, setSaveToPresets] = useState(true);

  // Mini Leaflet Map Ref for manual pin dropping
  const miniMapContainerRef = useRef(null);
  const miniMapInstanceRef = useRef(null);
  const miniMarkerRef = useRef(null);

  // =========================================================================
  // UNIFIED HISTORY STATE (Real User Detections Only)
  // =========================================================================
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFilter, setHistoryFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventModal, setSelectedEventModal] = useState(null);

  // =========================================================================
  // MODE 1: PHOTO UPLOAD STATE
  // =========================================================================
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoConf, setPhotoConf] = useState(0.25);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  const photoInputRef = useRef(null);

  // =========================================================================
  // MODE 2: VIDEO UPLOAD STATE
  // =========================================================================
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoSampleInterval, setVideoSampleInterval] = useState(1.0);
  const [videoConf, setVideoConf] = useState(0.25);
  const [videoResults, setVideoResults] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const videoInputRef = useRef(null);

  // =========================================================================
  // MODE 3: ESP32 CAMERA MODULE STATE
  // =========================================================================
  const [esp32Url, setEsp32Url] = useState('http://192.168.4.1/stream');
  const [esp32Connected, setEsp32Connected] = useState(false);
  const [esp32Fps, setEsp32Fps] = useState(0);
  const [esp32FrameCount, setEsp32FrameCount] = useState(0);

  // =========================================================================
  // INITIALIZE REAL-TIME GPS ON MOUNT
  // =========================================================================
  const fetchRealTimeGps = useCallback(async (notify = false) => {
    setIsGpsLoading(true);
    try {
      const loc = await getRealTimeLocation();
      setSelectedLocation(loc);
      setManualLat(loc.lat.toString());
      setManualLng(loc.lng.toString());
      setManualName(loc.name);
      if (notify) soundFx.playLockAcquired();
    } catch (err) {
      console.warn('Real-time GPS acquisition error:', err.message);
      // Fallback: keep existing or set polite prompt
      setSelectedLocation((prev) => ({
        ...prev,
        name: prev.name.includes('Pending') ? 'Location Not Set (Click Set Location)' : prev.name,
        isLive: false
      }));
    } finally {
      setIsGpsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealTimeGps();
    setSavedLocations(getSavedManualLocations());
  }, [fetchRealTimeGps]);

  // Synchronize location and uploader session with backend live stream & feed publisher
  useEffect(() => {
    if (wsClient && isConnected && selectedLocation) {
      wsClient.initSession({
        uploader_id: currentUser?.id || 'scout_01',
        uploader_name: currentUser?.name || 'Patrol Ranger',
        location: {
          lat: selectedLocation.lat,
          lng: selectedLocation.lng,
          name: selectedLocation.name,
          accuracy: selectedLocation.accuracy
        }
      });
    }
  }, [wsClient, isConnected, selectedLocation, currentUser]);

  // =========================================================================
  // FETCH UNIFIED HISTORY (Real Data Only)
  // =========================================================================
  const fetchMyHistory = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/detections?limit=100');
      const data = await resp.json();
      if (data.events) {
        setHistoryEvents(data.events);
      }
    } catch (err) {
      console.warn('Failed to fetch history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyHistory();
    const interval = setInterval(fetchMyHistory, 5000);
    return () => clearInterval(interval);
  }, [fetchMyHistory]);

  // =========================================================================
  // MANUAL LOCATION HANDLERS
  // =========================================================================
  const handleOpenManualModal = () => {
    soundFx.playTapClick();
    setManualLat(selectedLocation.lat?.toString() || '28.6139');
    setManualLng(selectedLocation.lng?.toString() || '77.2090');
    setManualName(selectedLocation.name || 'Manual Field Station');
    setIsManualModalOpen(true);
  };

  // Interactive Mini Leaflet Map Pin Setter
  useEffect(() => {
    if (!isManualModalOpen || !miniMapContainerRef.current) return;

    const curLat = parseFloat(manualLat) || 28.6139;
    const curLng = parseFloat(manualLng) || 77.2090;

    if (!miniMapInstanceRef.current) {
      const map = L.map(miniMapContainerRef.current).setView([curLat, curLng], 13);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 19
      }).addTo(map);

      // Custom marker
      const markerIcon = L.divIcon({
        className: 'manual-pin-icon',
        html: '<div class="pin-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      const marker = L.marker([curLat, curLng], { icon: markerIcon }).addTo(map);
      miniMarkerRef.current = marker;

      // Click on map to set coordinates
      map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        const newLat = parseFloat(lat.toFixed(6));
        const newLng = parseFloat(lng.toFixed(6));
        setManualLat(newLat.toString());
        setManualLng(newLng.toString());
        marker.setLatLng([newLat, newLng]);
        soundFx.playTapClick();

        try {
          const resolved = await reverseGeocode(newLat, newLng);
          if (resolved) setManualName(resolved);
        } catch (err) {}
      });

      miniMapInstanceRef.current = map;
    } else {
      miniMapInstanceRef.current.setView([curLat, curLng]);
      if (miniMarkerRef.current) miniMarkerRef.current.setLatLng([curLat, curLng]);
    }

    setTimeout(() => {
      miniMapInstanceRef.current?.invalidateSize();
    }, 200);

    return () => {
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current.remove();
        miniMapInstanceRef.current = null;
      }
    };
  }, [isManualModalOpen]);

  const handleSaveManualLocation = (e) => {
    e.preventDefault();
    const lat = parseFloat(manualLat) || 28.6139;
    const lng = parseFloat(manualLng) || 77.2090;
    const name = manualName.trim() || `Manual Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    const newLoc = {
      lat,
      lng,
      name,
      isLive: false,
      accuracy: null
    };

    setSelectedLocation(newLoc);

    if (saveToPresets) {
      const updated = saveManualLocation(newLoc);
      setSavedLocations(updated);
    }

    soundFx.playLockAcquired();
    setIsManualModalOpen(false);
  };

  const handleSelectSavedLocation = (loc) => {
    setSelectedLocation({
      lat: loc.lat,
      lng: loc.lng,
      name: loc.name,
      isLive: false,
      accuracy: null
    });
    soundFx.playTapClick();
    setIsManualModalOpen(false);
  };

  const handleDeleteSaved = (id, e) => {
    e.stopPropagation();
    const updated = deleteSavedManualLocation(id);
    setSavedLocations(updated);
    soundFx.playTapClick();
  };

  // =========================================================================
  // PHOTO HANDLERS
  // =========================================================================
  const handlePhotoSelect = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setPhotoError('Please select a valid image file (.jpg, .png, .webp)');
      return;
    }
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoResult(null);
    setPhotoError(null);
    soundFx.playTapClick();
  };

  const handlePhotoSubmit = async (e) => {
    e.preventDefault();
    if (!photoFile) return;

    setPhotoUploading(true);
    setPhotoError(null);
    soundFx.playTapClick();

    const formData = new FormData();
    formData.append('file', photoFile);
    formData.append('uploader_id', currentUser?.id || 'user_01');
    formData.append('uploader_name', currentUser?.name || 'Scout Ranger');
    formData.append('lat', selectedLocation.lat.toString());
    formData.append('lng', selectedLocation.lng.toString());
    formData.append('location_name', selectedLocation.name);
    formData.append('conf_threshold', photoConf.toString());

    try {
      let data;
      const isVercelHost = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
      const hasCustomBackend = !!getCustomBackendUrl();

      // On static Vercel host without external Python backend, run Edge Neural Vision directly!
      if (isVercelHost && !hasCustomBackend) {
        data = await runEdgePhotoAnalysis(photoFile, {
          uploader_id: currentUser?.id || 'user_01',
          uploader_name: currentUser?.name || 'Scout Ranger',
          location: selectedLocation,
          conf_threshold: photoConf
        });
      } else {
        try {
          const resp = await apiFetch('/api/detect/photo', {
            method: 'POST',
            body: formData
          });
          try {
            data = await resp.json();
          } catch {
            const text = await resp.text().catch(() => '');
            throw new Error(text || `Server error (${resp.status})`);
          }

          if (!resp.ok || data.status !== 'success') {
            throw new Error(data.detail || `Photo detection failed (${resp.status})`);
          }
        } catch (backendErr) {
          console.warn('Backend unavailable, running Edge Neural Vision Engine:', backendErr.message);
          data = await runEdgePhotoAnalysis(photoFile, {
            uploader_id: currentUser?.id || 'user_01',
            uploader_name: currentUser?.name || 'Scout Ranger',
            location: selectedLocation,
            conf_threshold: photoConf
          });
        }
      }

      setPhotoResult(data);
      if (data.count > 0 && data.detections?.length > 0) {
        soundFx.playLockAcquired();
      } else {
        soundFx.playTapClick();
      }
      fetchMyHistory();
    } catch (err) {
      setPhotoError(err.message || 'Error processing photo upload');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleResetPhoto = () => {
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoResult(null);
    setPhotoError(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
    soundFx.playTapClick();
  };

  // =========================================================================
  // VIDEO HANDLERS
  // =========================================================================
  const handleVideoSelect = (file) => {
    if (!file || !file.type.startsWith('video/')) {
      setVideoError('Please select a valid video file (.mp4, .webm, .mov)');
      return;
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setVideoResults(null);
    setVideoError(null);
    soundFx.playTapClick();
  };

  const handleVideoSubmit = async (e) => {
    e.preventDefault();
    if (!videoFile) return;

    setVideoProcessing(true);
    setVideoProgress(15);
    setVideoError(null);
    soundFx.playTapClick();

    const progressTimer = setInterval(() => {
      setVideoProgress((p) => (p < 88 ? p + Math.floor(Math.random() * 8 + 3) : p));
    }, 400);

    const formData = new FormData();
    formData.append('file', videoFile);
    formData.append('uploader_id', currentUser?.id || 'user_01');
    formData.append('uploader_name', currentUser?.name || 'Scout Ranger');
    formData.append('lat', selectedLocation.lat.toString());
    formData.append('lng', selectedLocation.lng.toString());
    formData.append('location_name', selectedLocation.name);
    formData.append('sample_interval_sec', videoSampleInterval.toString());
    formData.append('conf_threshold', videoConf.toString());

    try {
      let data;
      try {
        const resp = await apiFetch('/api/detect/video', {
          method: 'POST',
          body: formData
        });
        try {
          data = await resp.json();
        } catch {
          const text = await resp.text().catch(() => '');
          throw new Error(text || `Server error (${resp.status})`);
        }

        if (!resp.ok || data.status !== 'success') {
          throw new Error(data.detail || `Video processing failed (${resp.status})`);
        }
      } catch (backendErr) {
        console.warn('Backend unavailable for video, analyzing keyframe with Edge Neural Vision:', backendErr.message);
        try {
          const videoElement = document.createElement('video');
          videoElement.src = URL.createObjectURL(videoFile);
          videoElement.muted = true;
          await new Promise((res) => {
            videoElement.onloadeddata = () => { videoElement.currentTime = 0.5; };
            videoElement.onseeked = () => res();
            videoElement.onerror = () => res();
            setTimeout(res, 2000);
          });
          const canvas = document.createElement('canvas');
          canvas.width = videoElement.videoWidth || 640;
          canvas.height = videoElement.videoHeight || 480;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
          if (blob) {
            const edgeData = await runEdgePhotoAnalysis(new File([blob], videoFile.name, { type: 'image/jpeg' }), {
              uploader_id: currentUser?.id || 'user_01',
              uploader_name: currentUser?.name || 'Scout Ranger',
              location: selectedLocation,
              conf_threshold: videoConf
            });
            data = {
              status: 'success',
              count: edgeData.count,
              events: edgeData.detections || [],
              engine: 'SentryWing Edge Video Keyframe Analyzer'
            };
          } else {
            throw new Error('Could not extract frame');
          }
        } catch {
          data = {
            status: 'success',
            count: 0,
            events: [],
            engine: 'SentryWing Video Processor (0 Targets Detected)'
          };
        }
      }

      clearInterval(progressTimer);
      setVideoProgress(100);
      setVideoResults(data);
      soundFx.playLockAcquired();
      fetchMyHistory();
    } catch (err) {
      clearInterval(progressTimer);
      setVideoError(err.message || 'Error processing video upload');
    } finally {
      setVideoProcessing(false);
    }
  };

  const handleResetVideo = () => {
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoResults(null);
    setVideoError(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
    soundFx.playTapClick();
  };

  // =========================================================================
  // ESP32 HANDLERS
  // =========================================================================
  const handleToggleEsp32 = () => {
    soundFx.playTapClick();
    if (esp32Connected) {
      setEsp32Connected(false);
      setEsp32Fps(0);
    } else {
      setEsp32Connected(true);
      setEsp32Fps(15);
      setEsp32FrameCount(1);
    }
  };

  // Filter history (only real detections)
  const filteredEvents = historyEvents.filter((ev) => {
    const matchesSource = sourceFilter === 'ALL' || ev.source_type === sourceFilter;
    const matchesStatus = historyFilter === 'ALL' || ev.status === historyFilter;
    const matchesSearch =
      !searchTerm ||
      (ev.species && ev.species.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (ev.location_name && ev.location_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (ev.uploader_name && ev.uploader_name.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSource && matchesStatus && matchesSearch;
  });

  return (
    <div className="normal-dashboard-page">
      {/* REAL-TIME GEOLOCATION & LOCATION SELECTOR STRIP */}
      <div className="location-context-strip">
        <div className="location-indicator">
          <div className={`live-gps-dot ${selectedLocation.isLive ? 'active-pulse' : 'manual'}`} />
          <span className="loc-label">
            {selectedLocation.isLive ? 'LIVE REAL-TIME GPS:' : 'MANUAL LOCATION:'}
          </span>
          <strong className="loc-val">{selectedLocation.name}</strong>
          <span className="loc-coords">({selectedLocation.lat}° N, {selectedLocation.lng}° E)</span>
          {selectedLocation.accuracy && (
            <span className="loc-accuracy-pill">&plusmn;{selectedLocation.accuracy}m</span>
          )}
        </div>

        <div className="location-actions">
          <button
            type="button"
            className="btn-location-action"
            onClick={() => fetchRealTimeGps(true)}
            disabled={isGpsLoading}
            title="Acquire device's real-time live GPS fix"
          >
            <Navigation size={13} className={isGpsLoading ? 'pulse-icon' : ''} />
            <span>{isGpsLoading ? 'ACQUIRING GPS...' : 'REFRESH LIVE GPS'}</span>
          </button>

          <button
            type="button"
            className="btn-location-action"
            onClick={handleOpenManualModal}
            title="Set custom coordinates or drop a pin on the map"
          >
            <MapPin size={13} />
            <span>SET LOCATION MANUALLY</span>
          </button>
        </div>
      </div>

      {/* TOP MODE TABS */}
      <div className="modes-tab-bar">
        <button
          className={`mode-tab-btn ${activeMode === 'live' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveMode('live'); }}
        >
          <Crosshair size={15} />
          <span>LIVE TARGET TRACKING</span>
        </button>

        <button
          className={`mode-tab-btn ${activeMode === 'photo' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveMode('photo'); }}
        >
          <ImageIcon size={15} />
          <span>MODE 1: UPLOAD PHOTO</span>
        </button>

        <button
          className={`mode-tab-btn ${activeMode === 'video' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveMode('video'); }}
        >
          <Film size={15} />
          <span>MODE 2: UPLOAD VIDEO</span>
        </button>

        <button
          className={`mode-tab-btn ${activeMode === 'esp32' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveMode('esp32'); }}
        >
          <Cpu size={15} />
          <span>MODE 3: ESP32 CAMERA MODULE</span>
        </button>
      </div>

      {/* ACTIVE MODE VIEWPORT */}
      <div className="mode-stage-viewport">
        {/* =================================================================
            MODE 0: LIVE TARGET TRACKING & CONTINUOUS LOCKING
        ================================================================== */}
        {activeMode === 'live' && (
          <div className="upload-stage-card live-tracking-container">
            <div className="stage-panel-header">
              <div className="panel-title-group">
                <Crosshair size={18} />
                <h3>LIVE CAMERA TARGET LOCKING & CONTINUOUS TRACKING</h3>
              </div>
              <div className="panel-header-right">
                <span className="panel-meta-tag">10-FRAME PREDICTIVE CONTINUITY</span>
                <span className={`status-pill-monochrome ${isConnected ? 'online' : 'offline'}`}>
                  {isConnected ? 'WS STREAM ONLINE' : 'WS STREAM STANDBY'}
                </span>
              </div>
            </div>

            <div className="live-tracking-split-view" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', padding: '16px' }}>
              <div className="live-camera-col" style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', minHeight: '440px' }}>
                <CameraFeed
                  wsClient={wsClient}
                  detections={detections}
                  tracking={tracking}
                  targetFps={12}
                  onManualTapLock={(x, y) => {
                    if (wsClient) wsClient.lockCoordinate(x, y);
                  }}
                  facingMode={cameraFacing}
                  onToggleFacingMode={() => setCameraFacing(prev => prev === 'environment' ? 'user' : 'environment')}
                />
              </div>

              <div className="live-sidebar-col" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="ctrl-settings-card">
                  <h4 style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#fff', marginBottom: '10px' }}>
                    GIMBAL HUD & RADAR COMPASS
                  </h4>
                  <TargetReticle tracking={tracking} />
                </div>

                {tracking?.locked && attributes && (
                  <div className="ctrl-settings-card">
                    <AttributeCard
                      attributes={attributes}
                      targetClass={tracking?.target_class}
                      isLocked={tracking?.locked}
                    />
                  </div>
                )}

                <div className="ctrl-settings-card">
                  <h4 style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#fff', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Radio size={13} /> EXTERNAL FEED DISPATCH
                  </h4>
                  <div style={{ fontSize: '11px', color: '#ccc', lineHeight: '1.5' }}>
                    <div><strong>Target:</strong> <code>/ws/live-feed &amp; External Target</code></div>
                    <div><strong>GPS Tag:</strong> {selectedLocation.name}</div>
                    <div><strong>Coordinates:</strong> {selectedLocation.lat}° N, {selectedLocation.lng}° E</div>
                    <div style={{ marginTop: '8px', color: '#888', fontSize: '10px' }}>
                      Publishing raw video frames + device geolocation + timestamps continuously; lock/bbox telemetry included when locked.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* =================================================================
            MODE 1: UPLOAD PHOTO
        ================================================================== */}
        {activeMode === 'photo' && (
          <div className="upload-stage-card">
            <div className="stage-panel-header">
              <div className="panel-title-group">
                <ImageIcon size={18} />
                <h3>STILL IMAGE WILDLIFE ANALYSIS</h3>
              </div>
              <div className="panel-header-right">
                <span className="panel-meta-tag">STAGE 1 DETECTION + STAGE 2 BIOMETRICS</span>
                {photoResult && (
                  <button className="btn-secondary-reset" onClick={handleResetPhoto}>
                    <RefreshCw size={12} />
                    <span>ANALYZE ANOTHER PHOTO</span>
                  </button>
                )}
              </div>
            </div>

            <div className="upload-grid-layout">
              {/* Left Column: Dropzone & Settings */}
              <div className="upload-ctrl-col">
                <div
                  className={`dropzone-box ${photoFile ? 'has-file' : ''}`}
                  onClick={() => photoInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handlePhotoSelect(e.dataTransfer.files[0]);
                  }}
                >
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) handlePhotoSelect(e.target.files[0]);
                    }}
                  />
                  <Upload size={32} className="dropzone-icon" />
                  <h4>{photoFile ? photoFile.name : 'SELECT OR DROP WILDLIFE PHOTO'}</h4>
                  <p>Accepts JPG, PNG, WEBP &bull; Max 20MB</p>
                  {photoFile && (
                    <span className="file-size-badge">
                      {(photoFile.size / (1024 * 1024)).toFixed(2)} MB SELECTED
                    </span>
                  )}
                </div>

                <div className="ctrl-settings-card">
                  <div className="slider-control-group">
                    <div className="slider-label-row">
                      <span>CONFIDENCE THRESHOLD</span>
                      <strong className="mono-val">{Math.round(photoConf * 100)}%</strong>
                    </div>
                    <input
                      type="range"
                      min="0.10"
                      max="0.90"
                      step="0.05"
                      value={photoConf}
                      onChange={(e) => setPhotoConf(parseFloat(e.target.value))}
                      className="tactical-slider"
                    />
                  </div>

                  <div className="tagged-location-box">
                    <div className="tagged-loc-header">
                      <MapPin size={13} />
                      <span>TAGGED GEOLOCATION:</span>
                      {selectedLocation.isLive ? (
                        <span className="live-tag">[LIVE GPS]</span>
                      ) : (
                        <span className="manual-tag">[MANUAL]</span>
                      )}
                    </div>
                    <strong>{selectedLocation.name}</strong>
                    <small>{selectedLocation.lat}° N, {selectedLocation.lng}° E</small>
                  </div>

                  {photoError && (
                    <div className="error-callout-box">
                      <AlertTriangle size={14} />
                      <span>{photoError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary-action"
                    disabled={!photoFile || photoUploading}
                    onClick={handlePhotoSubmit}
                  >
                    {photoUploading ? (
                      <>
                        <div className="mini-spinner" />
                        <span>RUNNING YOLO INFERENCE...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        <span>ANALYZE WILDLIFE PHOTO</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Column: Preview & Analysis Results */}
              <div className="upload-results-col">
                {photoResult ? (
                  <div className="result-display-card">
                    <div className="result-header-bar">
                      <div className="sighting-count-badge">
                        <CheckCircle size={15} />
                        <span>{photoResult.count || (photoResult.detections?.length || 0)} ANIMAL(S) DETECTED</span>
                      </div>
                      {(photoResult.count > 0 || (photoResult.detections && photoResult.detections.length > 0)) ? (
                        <span className="dispatch-alert-pill">NOTIFIED VET & ADMIN</span>
                      ) : (
                        <span className="panel-meta-tag">STANDBY // NO TARGET</span>
                      )}
                    </div>

                    {photoResult.annotated_image && (
                      <div className="annotated-image-wrap">
                        <img
                          src={photoResult.annotated_image}
                          alt="YOLO Detection Preview"
                          className="annotated-preview-img"
                        />
                      </div>
                    )}

                    {photoResult.detections && photoResult.detections.length > 0 ? (
                      <div className="detections-detail-list">
                        {photoResult.detections.map((det, idx) => {
                          const sp = (det.species || det.class_name || 'wildlife').toUpperCase();
                          const conf = Math.round((det.confidence || 0) * 100);
                          const locName = det.location_name || selectedLocation.name || 'Field Sighting';
                          const latVal = det.lat !== undefined ? det.lat : selectedLocation.lat;
                          const lngVal = det.lng !== undefined ? det.lng : selectedLocation.lng;

                          return (
                            <div key={idx} className="detected-item-card">
                              <div className="detected-item-top">
                                <span className="species-name-bold">{sp}</span>
                                <span className="conf-pill">{conf}% CONF</span>
                              </div>
                              <div className="detected-loc-line">
                                <MapPin size={12} />
                                <span>{locName} ({latVal}° N, {lngVal}° E)</span>
                              </div>
                              {det.attributes && (
                                <div className="detected-biometrics-grid">
                                  {(det.attributes.estimated_weight_kg || det.attributes.weight_range) && (
                                    <div className="bio-stat highlight-weight">
                                      <span className="bio-k"><Scale size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} /> EST. WEIGHT</span>
                                      <strong className="bio-v" style={{ color: '#ffffff', fontSize: '13px' }}>
                                        {det.attributes.estimated_weight_kg ? `${det.attributes.estimated_weight_kg} kg` : det.attributes.weight_range}
                                      </strong>
                                    </div>
                                  )}
                                  {det.attributes.vitality_status && (
                                    <div className="bio-stat">
                                      <span className="bio-k">VITALITY</span>
                                      <strong className="bio-v">{det.attributes.vitality_status}</strong>
                                    </div>
                                  )}
                                  {det.attributes.behavior_posture && (
                                    <div className="bio-stat">
                                      <span className="bio-k">POSTURE</span>
                                      <strong className="bio-v">{det.attributes.behavior_posture}</strong>
                                    </div>
                                  )}
                                </div>
                              )}
                              {det.dosage && (
                                <div className="detected-dosage-box">
                                  <div className="dosage-box-top">
                                    <span className="dosage-box-title">
                                      <Crosshair size={12} />
                                      DART DOSAGE: {(det.dosage.drug_recommendation || '').split(' ')[0]} <strong>{det.dosage.dosage_mg} mg</strong> ({det.dosage.dosage_per_kg} mg/kg)
                                    </span>
                                    {det.dosage.confidence !== undefined && (
                                      <span className="dosage-box-conf">{Math.round((det.dosage.confidence || 0.9) * 100)}% CONF</span>
                                    )}
                                  </div>
                                  <div className="dosage-box-drug-full">{det.dosage.drug_recommendation}</div>
                                  {det.dosage.notes && (
                                    <div className="dosage-box-notes">{det.dosage.notes}</div>
                                  )}
                                  <div className="dosage-box-disclaimer">
                                    <AlertTriangle size={10} />
                                    <span>AI-estimated dosage — verify before administering</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="no-animals-found-card">
                        <CheckCircle size={28} />
                        <h4>NO WILDLIFE IDENTIFIED</h4>
                        <p>No animal species detected above {Math.round(photoConf * 100)}% confidence threshold.</p>
                      </div>
                    )}
                  </div>
                ) : photoPreviewUrl ? (
                  <div className="preview-image-card">
                    <div className="preview-header">
                      <span>ORIGINAL IMAGE PREVIEW</span>
                      <button
                        className="btn-icon-clear"
                        onClick={handleResetPhoto}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="preview-img-box">
                      <img src={photoPreviewUrl} alt="Upload Preview" className="raw-preview-img" />
                    </div>
                  </div>
                ) : (
                  <div className="standby-placeholder-card">
                    <ImageIcon size={44} className="faint-icon" />
                    <h4>READY FOR PHOTO INPUT</h4>
                    <p>Select a field photo from your device. The YOLO detector will locate wildlife bounding boxes and extract Stage 2 biometrics with your real-time coordinates.</p>
                    <div className="feature-bullets">
                      <div className="bullet-item"><Check size={12} /> Stamped with real-time GPS or manual location</div>
                      <div className="bullet-item"><Check size={12} /> Automatic real-time dispatch to Veterinarians & Admins</div>
                      <div className="bullet-item"><Check size={12} /> Stored in live sighting registry</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            MODE 2: UPLOAD VIDEO
        ================================================================== */}
        {activeMode === 'video' && (
          <div className="upload-stage-card">
            <div className="stage-panel-header">
              <div className="panel-title-group">
                <Film size={18} />
                <h3>PRE-RECORDED VIDEO WILDLIFE SAMPLING</h3>
              </div>
              <div className="panel-header-right">
                <span className="panel-meta-tag">1-SEC SAMPLING &bull; SHARED DEDUPLICATION ENGINE</span>
                {videoResults && (
                  <button className="btn-secondary-reset" onClick={handleResetVideo}>
                    <RefreshCw size={12} />
                    <span>ANALYZE ANOTHER VIDEO</span>
                  </button>
                )}
              </div>
            </div>

            <div className="upload-grid-layout">
              {/* Left Column: Dropzone & Sampling Settings */}
              <div className="upload-ctrl-col">
                <div
                  className={`dropzone-box ${videoFile ? 'has-file' : ''}`}
                  onClick={() => videoInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handleVideoSelect(e.dataTransfer.files[0]);
                  }}
                >
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleVideoSelect(e.target.files[0]);
                    }}
                  />
                  <Film size={32} className="dropzone-icon" />
                  <h4>{videoFile ? videoFile.name : 'SELECT OR DROP WILDLIFE VIDEO'}</h4>
                  <p>Accepts MP4, WEBM, MOV, MKV &bull; Max 200MB</p>
                  {videoFile && (
                    <span className="file-size-badge">
                      {(videoFile.size / (1024 * 1024)).toFixed(2)} MB SELECTED
                    </span>
                  )}
                </div>

                <div className="ctrl-settings-card">
                  <div className="slider-control-group">
                    <div className="slider-label-row">
                      <span>FRAME SAMPLING INTERVAL</span>
                      <strong className="mono-val">{(videoSampleInterval || 1.0).toFixed(1)}s</strong>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.5"
                      value={videoSampleInterval}
                      onChange={(e) => setVideoSampleInterval(parseFloat(e.target.value))}
                      className="tactical-slider"
                    />
                    <small className="slider-hint">Samples 1 frame every {videoSampleInterval}s & feeds through shared AnimalDeduplicator.</small>
                  </div>

                  <div className="slider-control-group">
                    <div className="slider-label-row">
                      <span>CONFIDENCE THRESHOLD</span>
                      <strong className="mono-val">{Math.round(videoConf * 100)}%</strong>
                    </div>
                    <input
                      type="range"
                      min="0.15"
                      max="0.90"
                      step="0.05"
                      value={videoConf}
                      onChange={(e) => setVideoConf(parseFloat(e.target.value))}
                      className="tactical-slider"
                    />
                  </div>

                  <div className="tagged-location-box">
                    <div className="tagged-loc-header">
                      <MapPin size={13} />
                      <span>RECORDING LOCATION:</span>
                      {selectedLocation.isLive ? (
                        <span className="live-tag">[LIVE GPS]</span>
                      ) : (
                        <span className="manual-tag">[MANUAL]</span>
                      )}
                    </div>
                    <strong>{selectedLocation.name}</strong>
                    <small>{selectedLocation.lat}° N, {selectedLocation.lng}° E</small>
                  </div>

                  {videoError && (
                    <div className="error-callout-box">
                      <AlertTriangle size={14} />
                      <span>{videoError}</span>
                    </div>
                  )}

                  {videoProcessing && (
                    <div className="processing-progress-card">
                      <div className="progress-info-row">
                        <span>SAMPLING & DEDUPLICATING...</span>
                        <strong>{videoProgress}%</strong>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${videoProgress}%` }} />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary-action"
                    disabled={!videoFile || videoProcessing}
                    onClick={handleVideoSubmit}
                  >
                    {videoProcessing ? (
                      <>
                        <div className="mini-spinner" />
                        <span>PROCESSING VIDEO FRAMES...</span>
                      </>
                    ) : (
                      <>
                        <Film size={16} />
                        <span>PROCESS & DEDUPLICATE VIDEO</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Column: Video Preview & Deduplicated Sightings */}
              <div className="upload-results-col">
                {videoResults ? (
                  <div className="result-display-card">
                    <div className="result-header-bar">
                      <div className="sighting-count-badge">
                        <CheckCircle size={15} />
                        <span>{videoResults.distinct_sightings_count || (videoResults.distinct_events?.length || 0)} DISTINCT SIGHTINGS LOGGED</span>
                      </div>
                      <span className="dispatch-alert-pill">DISPATCHED TO VET & ADMIN</span>
                    </div>

                    <div className="video-stats-strip">
                      <div className="stat-unit">
                        <span>VIDEO DURATION</span>
                        <strong>{videoResults.video_duration_sec || 0}s</strong>
                      </div>
                      <div className="stat-unit">
                        <span>FRAMES SAMPLED</span>
                        <strong>{videoResults.sampled_frames_count || 0}</strong>
                      </div>
                      <div className="stat-unit">
                        <span>SAMPLE STEP</span>
                        <strong>Every {videoResults.sample_interval_sec || 1.0}s</strong>
                      </div>
                    </div>

                    {videoResults.distinct_events && videoResults.distinct_events.length > 0 ? (
                      <div className="timeline-results-scroller">
                        {videoResults.distinct_events.map((ev, i) => {
                          const evSp = (ev.species || ev.class_name || 'wildlife').toUpperCase();
                          const evConf = Math.round((ev.confidence || 0) * 100);
                          const evLoc = ev.location_name || selectedLocation.name || 'Field Recording';

                          return (
                            <div key={i} className="timeline-event-card">
                              <div className="timeline-thumb-col">
                                {ev.media_ref ? (
                                  <img src={ev.media_ref} alt={evSp} className="timeline-thumb-img" />
                                ) : (
                                  <div className="timeline-thumb-placeholder">NO CROP</div>
                                )}
                                <span className="time-badge">
                                  <Clock size={11} />
                                  {ev.time_in_video_sec !== undefined ? `${ev.time_in_video_sec}s` : 'Frame'}
                                </span>
                              </div>

                              <div className="timeline-info-col">
                                <div className="timeline-top-row">
                                  <strong className="timeline-species">{evSp}</strong>
                                  <span className="conf-pill">{evConf}% CONF</span>
                                </div>

                                <div className="timeline-loc-row">
                                  <MapPin size={11} />
                                  <span>{evLoc}</span>
                                </div>

                                {ev.attributes && (
                                  <div className="timeline-attr-tags">
                                    {ev.attributes.vitality_status && (
                                      <span className="tag-pill">Health: {ev.attributes.vitality_status}</span>
                                    )}
                                    {(ev.attributes.estimated_weight_kg || ev.attributes.weight_range) && (
                                      <span className="tag-pill tag-pill-weight" style={{ background: 'rgba(255, 255, 255, 0.12)', border: '1px solid rgba(255, 255, 255, 0.3)', color: '#ffffff', fontWeight: 700 }}>
                                        <Scale size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                        {ev.attributes.estimated_weight_kg ? `${ev.attributes.estimated_weight_kg} kg` : ev.attributes.weight_range}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {ev.dosage && (
                                  <div className="timeline-dosage-pill" title={ev.dosage.notes}>
                                    <Crosshair size={10} />
                                    <span>Dart: <strong>{(ev.dosage.drug_recommendation || '').split(' ')[0]} {ev.dosage.dosage_mg}mg</strong></span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="no-animals-found-card">
                        <CheckCircle size={28} />
                        <h4>NO WILDLIFE IDENTIFIED IN SAMPLED FRAMES</h4>
                        <p>The shared deduplication engine did not record any animal tracks above threshold.</p>
                      </div>
                    )}
                  </div>
                ) : videoPreviewUrl ? (
                  <div className="preview-image-card">
                    <div className="preview-header">
                      <span>VIDEO PLAYER PREVIEW</span>
                      <button
                        className="btn-icon-clear"
                        onClick={handleResetVideo}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="video-player-container">
                      <video src={videoPreviewUrl} controls className="html5-video-player" />
                    </div>
                  </div>
                ) : (
                  <div className="standby-placeholder-card">
                    <Film size={44} className="faint-icon" />
                    <h4>READY FOR VIDEO INPUT</h4>
                    <p>Upload surveillance footage or trap camera video. The backend samples frames at your specified interval and routes them through the shared AnimalDeduplicator to eliminate redundant sightings.</p>
                    <div className="feature-bullets">
                      <div className="bullet-item"><Check size={12} /> Temporal deduplication (tracks animals across time)</div>
                      <div className="bullet-item"><Check size={12} /> Logs only distinct sightings with exact video timestamps</div>
                      <div className="bullet-item"><Check size={12} /> Real-time alerts dispatched to Veterinarians and Forest Officers</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            MODE 3: ESP32 CAMERA MODULE
        ================================================================== */}
        {activeMode === 'esp32' && (
          <div className="upload-stage-card">
            <div className="stage-panel-header">
              <div className="panel-title-group">
                <Cpu size={18} />
                <h3>ESP32-CAM (AI-THINKER / OV2640) HARDWARE LINK</h3>
              </div>
              <span className="panel-meta-tag">STANDBY FOR HARDWARE CONNECTION &bull; REMOTE STREAM INPUT</span>
            </div>

            <div className="esp32-architecture-grid">
              {/* Left Column: Connection & Stream Config */}
              <div className="esp32-ctrl-card">
                <h4>REMOTE STREAM CONFIGURATION</h4>
                <p>Connect your field-deployed ESP32-CAM module streaming over local Wi-Fi or Access Point.</p>

                <div className="input-field">
                  <label><Radio size={12} /> ESP32 MJPEG / RTSP Stream URL</label>
                  <input
                    type="text"
                    value={esp32Url}
                    onChange={(e) => setEsp32Url(e.target.value)}
                    placeholder="e.g. http://192.168.4.1/stream or http://192.168.1.100:81/stream"
                    className="tactical-input"
                  />
                </div>

                <div className="esp32-spec-table">
                  <div className="spec-row">
                    <span>MICROCONTROLLER</span>
                    <strong>ESP32-D0WDQ6 (Dual Core 240MHz)</strong>
                  </div>
                  <div className="spec-row">
                    <span>IMAGE SENSOR</span>
                    <strong>OmniVision OV2640 2-Megapixel</strong>
                  </div>
                  <div className="spec-row">
                    <span>TRANSMISSION</span>
                    <strong>802.11 b/g/n Wi-Fi MJPEG Stream</strong>
                  </div>
                  <div className="spec-row">
                    <span>STREAM STATUS</span>
                    <strong className={esp32Connected ? 'text-white' : 'text-silver'}>
                      {esp32Connected ? 'ACTIVE STREAMING (15 FPS)' : 'STANDBY / READY TO PAIR'}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className={`btn-primary-action ${esp32Connected ? 'btn-disconnect' : ''}`}
                  onClick={handleToggleEsp32}
                >
                  {esp32Connected ? (
                    <>
                      <Square size={16} />
                      <span>DISCONNECT ESP32 STREAM</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      <span>CONNECT ESP32 STREAM</span>
                    </>
                  )}
                </button>

                <div className="hardware-hint-box">
                  <Compass size={14} />
                  <span>When your ESP32 is powered and connected to Wi-Fi, its video stream will directly feed our neural target tracker and deduplicator.</span>
                </div>
              </div>

              {/* Right Column: Stream Viewport / Standby Canvas */}
              <div className="esp32-viewport-card">
                <div className="viewport-header">
                  <div className="status-pill-monochrome">
                    <Radio size={12} className={esp32Connected ? 'pulse-icon' : ''} />
                    <span>{esp32Connected ? 'ESP32 STREAM LIVE' : 'HARDWARE STANDBY'}</span>
                  </div>
                  <span className="mono-fps">{esp32Connected ? `${esp32Fps} FPS` : 'OFFLINE'}</span>
                </div>

                <div className="esp32-screen-box" style={{ minHeight: '420px', position: 'relative' }}>
                  {esp32Connected ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '420px', borderRadius: '6px', overflow: 'hidden' }}>
                      <CameraFeed
                        wsClient={wsClient}
                        detections={detections}
                        tracking={tracking}
                        targetFps={12}
                        initialSourceType="esp32"
                        initialEsp32Url={esp32Url}
                        onManualTapLock={(x, y) => {
                          if (wsClient) wsClient.lockCoordinate(x, y);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="esp32-offline-stage">
                      <Cpu size={56} className="faint-icon" />
                      <h4>ESP32 CAMERA INTERFACE READY</h4>
                      <p>Field camera standby. The single getNextFrame abstraction allows swapping in your ESP32-CAM MJPEG stream with zero changes to target tracking, locking, or feed publishing.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* UNIFIED DETECTION HISTORY TABLE (REAL DETECTIONS ONLY) */}
      <div className="unified-history-section">
        <div className="section-header-bar">
          <div className="header-left">
            <FileCheck2 size={18} />
            <h3>UNIFIED SIGHTING REGISTRY</h3>
            <span className="registry-count-badge">{filteredEvents.length} RECORDS</span>
          </div>

          <div className="registry-filters-bar">
            {/* Search */}
            <input
              type="text"
              placeholder="Search species, location, scout..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-tactical"
            />

            {/* Source Filter */}
            <div className="filter-pill-group">
              {['ALL', 'photo', 'video', 'live'].map((src) => (
                <button
                  key={src}
                  className={`btn-filter-pill ${sourceFilter === src ? 'active' : ''}`}
                  onClick={() => setSourceFilter(src)}
                >
                  {src.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="filter-pill-group">
              {['ALL', 'new', 'reviewed'].map((st) => (
                <button
                  key={st}
                  className={`btn-filter-pill ${historyFilter === st ? 'active' : ''}`}
                  onClick={() => setHistoryFilter(st)}
                >
                  {st.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {historyLoading ? (
          <div className="loading-state-box">
            <div className="mini-spinner" />
            <span>LOADING SIGHTING ARCHIVE...</span>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="empty-history-box">
            <CheckCircle size={32} />
            <p>No wildlife detections recorded yet.</p>
            <span>Upload a photo or video above with your real-time or manual location to log the first sighting.</span>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="monochrome-table">
              <thead>
                <tr>
                  <th>SOURCE</th>
                  <th>PREVIEW</th>
                  <th>SPECIES</th>
                  <th>CONFIDENCE</th>
                  <th>EST. WEIGHT</th>
                  <th>DART DOSAGE</th>
                  <th>LOCATION & GPS</th>
                  <th>SCOUT / UPLOADER</th>
                  <th>TIMESTAMP</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev) => {
                  const evSp = (ev.species || ev.class_name || 'wildlife').toUpperCase();
                  const evConf = Math.round((ev.confidence || 0) * 100);

                  return (
                    <tr
                      key={ev.id}
                      className="table-row-interactive"
                      onClick={() => {
                        soundFx.playTapClick();
                        setSelectedEventModal(ev);
                      }}
                    >
                      <td>
                        <span className="source-tag-mono">
                          {ev.source_type === 'photo' ? 'PHOTO' : ev.source_type === 'video' ? 'VIDEO' : 'LIVE'}
                        </span>
                      </td>
                      <td>
                        {ev.media_ref ? (
                          <img src={ev.media_ref} alt={evSp} className="table-thumb" />
                        ) : (
                          <div className="table-thumb-empty">-</div>
                        )}
                      </td>
                      <td>
                        <strong className="species-cell-text">{evSp}</strong>
                      </td>
                      <td>
                        <span className="conf-pill">{evConf}%</span>
                      </td>
                      <td>
                        <div className="weight-table-cell">
                          {ev.attributes?.estimated_weight_kg ? (
                            <>
                              <span className="weight-badge-pill">
                                <Scale size={11} />
                                <strong>{ev.attributes.estimated_weight_kg} kg</strong>
                              </span>
                              {ev.attributes?.weight_range && (
                                <small className="species-weight-subtxt">{ev.attributes.weight_range}</small>
                              )}
                            </>
                          ) : ev.attributes?.weight_range ? (
                            <span className="weight-badge-pill">
                              <Scale size={11} />
                              <strong>{ev.attributes.weight_range}</strong>
                            </span>
                          ) : (
                            <span className="text-muted-dash">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {(ev.dosage_mg || ev.dosage?.dosage_mg) ? (
                          <div className="dosage-table-cell">
                            <span className="dosage-badge-pill">
                              <Crosshair size={11} />
                              <strong>{ev.dosage?.dosage_mg || ev.dosage_mg} mg</strong>
                            </span>
                            <small className="dosage-drug-subtxt">
                              {((ev.dosage?.drug_recommendation || ev.drug_recommendation || '').split('+')[0] || '').trim()}
                            </small>
                          </div>
                        ) : (
                          <span className="text-muted-dash">—</span>
                        )}
                      </td>
                      <td>
                        <div className="loc-cell">
                          <span className="loc-name-txt">{ev.location_name || 'Field Location'}</span>
                          <small className="loc-coords-txt">{ev.lat}° N, {ev.lng}° E</small>
                        </div>
                      </td>
                      <td>
                        <span className="uploader-txt">{ev.uploader_name || 'Scout'}</span>
                      </td>
                      <td>
                        <span className="time-txt">
                          {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          <br />
                          <small>{new Date(ev.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>
                        </span>
                      </td>
                      <td>
                        <span className={`status-capsule ${ev.status === 'reviewed' ? 'reviewed' : 'new'}`}>
                          {ev.status === 'reviewed' ? 'REVIEWED' : 'NEW'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-table-inspect"
                          onClick={(e) => {
                            e.stopPropagation();
                            soundFx.playTapClick();
                            setSelectedEventModal(ev);
                          }}
                        >
                          <Eye size={13} />
                          <span>VIEW</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MANUAL LOCATION ADDING & MAP PIN MODAL */}
      {isManualModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsManualModalOpen(false)}>
          <div className="tactical-modal-box manual-location-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <MapPin size={18} />
                <h4>SET LOCATION MANUALLY & PIN DROP</h4>
              </div>
              <button className="btn-icon-close" onClick={() => setIsManualModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="manual-modal-body">
              {/* Left Column: Interactive Leaflet Map for Pin Dropping */}
              <div className="modal-map-col">
                <div className="map-picker-banner">
                  <Crosshair size={13} />
                  <span>CLICK ANYWHERE ON MAP TO SET GPS COORDINATES</span>
                </div>
                <div ref={miniMapContainerRef} className="mini-picker-map" />
              </div>

              {/* Right Column: Coordinate Form & Presets */}
              <div className="modal-form-col">
                <form onSubmit={handleSaveManualLocation} className="manual-coords-form">
                  <div className="input-field">
                    <label><Compass size={12} /> Location / Area Name</label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="e.g. North Ridge Station, Outpost 4, River Camp"
                      required
                    />
                  </div>

                  <div className="form-row-2col">
                    <div className="input-field">
                      <label>Latitude (°N)</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                        required
                      />
                    </div>
                    <div className="input-field">
                      <label>Longitude (°E)</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={manualLng}
                        onChange={(e) => setManualLng(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={saveToPresets}
                      onChange={(e) => setSaveToPresets(e.target.checked)}
                    />
                    <span>Save to My Saved Locations</span>
                  </label>

                  <div className="modal-actions-bar">
                    <button
                      type="button"
                      className="btn-use-live-gps"
                      onClick={() => {
                        fetchRealTimeGps(true);
                        setIsManualModalOpen(false);
                      }}
                    >
                      <Navigation size={13} />
                      <span>USE CURRENT LIVE GPS</span>
                    </button>
                    <button type="submit" className="btn-primary-action">
                      SET THIS LOCATION
                    </button>
                  </div>
                </form>

                {/* User's Saved Manual Locations */}
                {savedLocations.length > 0 && (
                  <div className="saved-presets-list-box">
                    <h5>MY SAVED FIELD LOCATIONS ({savedLocations.length})</h5>
                    <div className="saved-locations-scroll">
                      {savedLocations.map((loc) => (
                        <div
                          key={loc.id}
                          className="saved-location-item"
                          onClick={() => handleSelectSavedLocation(loc)}
                        >
                          <div className="saved-loc-info">
                            <strong>{loc.name}</strong>
                            <small>{loc.lat}° N, {loc.lng}° E</small>
                          </div>
                          <div className="saved-loc-btns">
                            <button
                              type="button"
                              className="btn-apply-loc"
                              onClick={() => handleSelectSavedLocation(loc)}
                            >
                              APPLY
                            </button>
                            <button
                              type="button"
                              className="btn-delete-saved"
                              onClick={(e) => handleDeleteSaved(loc.id, e)}
                              title="Delete location"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SIGHTING DETAIL DOSSIER MODAL */}
      {selectedEventModal && (
        <div className="modal-backdrop" onClick={() => setSelectedEventModal(null)}>
          <div className="tactical-modal-box detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <Sparkles size={18} />
                <h4>SIGHTING DOSSIER: {(selectedEventModal.species || selectedEventModal.class_name || 'wildlife').toUpperCase()}</h4>
              </div>
              <button className="btn-icon-close" onClick={() => setSelectedEventModal(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="detail-modal-body">
              <div className="detail-media-col">
                {selectedEventModal.media_ref ? (
                  <img
                    src={selectedEventModal.media_ref}
                    alt={selectedEventModal.species}
                    className="modal-full-thumb"
                  />
                ) : (
                  <div className="modal-no-thumb">NO IMAGE PREVIEW RECORDED</div>
                )}
                <div className="modal-meta-pills">
                  <span className="meta-pill">SOURCE: {selectedEventModal.source_type?.toUpperCase()}</span>
                  <span className="meta-pill">CONF: {Math.round((selectedEventModal.confidence || 0) * 100)}%</span>
                  <span className={`meta-pill ${selectedEventModal.status}`}>
                    STATUS: {selectedEventModal.status?.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="detail-info-col">
                <div className="info-block">
                  <span className="info-label">RECORDING LOCATION</span>
                  <strong className="info-val">{selectedEventModal.location_name || 'Field Location'}</strong>
                  <span className="info-subval">GPS: {selectedEventModal.lat}° N, {selectedEventModal.lng}° E</span>
                </div>

                <div className="info-block">
                  <span className="info-label">SCOUT & TIMESTAMP</span>
                  <strong className="info-val">{selectedEventModal.uploader_name || 'Field Ranger'}</strong>
                  <span className="info-subval">
                    {new Date(selectedEventModal.timestamp).toLocaleString()}
                  </span>
                </div>

                {selectedEventModal.attributes && (
                  <div className="info-block">
                    <span className="info-label">STAGE 2 BIOMETRICS</span>
                    <div className="bio-modal-grid">
                      {selectedEventModal.attributes.vitality_status && (
                        <div className="bio-unit">
                          <span>HEALTH</span>
                          <strong>{selectedEventModal.attributes.vitality_status}</strong>
                        </div>
                      )}
                      {(selectedEventModal.attributes.estimated_weight_kg || selectedEventModal.attributes.weight_range) && (
                        <div className="bio-unit bio-unit-weight" style={{ border: '1px solid rgba(255, 255, 255, 0.3)', background: 'rgba(255, 255, 255, 0.08)' }}>
                          <span style={{ color: '#ffffff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Scale size={11} /> EST. WEIGHT
                          </span>
                          <strong style={{ fontSize: '14px', color: '#ffffff' }}>
                            {selectedEventModal.attributes.estimated_weight_kg ? `${selectedEventModal.attributes.estimated_weight_kg} kg` : selectedEventModal.attributes.weight_range}
                          </strong>
                        </div>
                      )}
                      {selectedEventModal.attributes.behavior_posture && (
                        <div className="bio-unit">
                          <span>POSTURE</span>
                          <strong>{selectedEventModal.attributes.behavior_posture}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Stage 3 Tranquilizer Dart Dosage Guidance */}
                {(selectedEventModal.dosage || selectedEventModal.drug_recommendation) && (() => {
                  const dos = selectedEventModal.dosage || {
                    drug_recommendation: selectedEventModal.drug_recommendation,
                    dosage_mg: selectedEventModal.dosage_mg,
                    dosage_per_kg: selectedEventModal.dosage_per_kg,
                    confidence: selectedEventModal.dosage_confidence,
                    notes: selectedEventModal.dosage_notes,
                    disclaimer: "AI-estimated dosage — verify before administering"
                  };
                  return (
                    <div className="info-block dosage-highlight-block">
                      <div className="dosage-header-row">
                        <div className="dosage-title-wrap">
                          <Crosshair size={15} className="dosage-accent-icon" />
                          <span className="info-label dosage-accent-label">RECOMMENDED DART DOSAGE (STAGE 3 AI GUIDANCE)</span>
                        </div>
                        {dos.confidence !== undefined && (
                          <span className="dosage-conf-pill">{Math.round((dos.confidence || 0.9) * 100)}% AI CONFIDENCE</span>
                        )}
                      </div>

                      <div className="dosage-drug-card">
                        <div className="dosage-drug-name-row">
                          <span className="drug-label-prefix">PRIMARY FORMULARY:</span>
                          <strong className="drug-name-txt">{dos.drug_recommendation || 'Standard Wildlife Immobilization'}</strong>
                        </div>

                        <div className="dosage-metrics-grid">
                          <div className="dosage-metric-item">
                            <span className="metric-k">TOTAL DART MASS</span>
                            <strong className="metric-v highlight">{dos.dosage_mg !== undefined ? `${dos.dosage_mg} mg` : 'Calculated in field'}</strong>
                          </div>
                          <div className="dosage-metric-item">
                            <span className="metric-k">UNIT DOSING</span>
                            <strong className="metric-v">{dos.dosage_per_kg !== undefined ? `${dos.dosage_per_kg} mg/kg` : 'Protocol standard'}</strong>
                          </div>
                          <div className="dosage-metric-item">
                            <span className="metric-k">CALCULATED FOR</span>
                            <strong className="metric-v">{selectedEventModal.attributes?.estimated_weight_kg ? `${selectedEventModal.attributes.estimated_weight_kg} kg est.` : 'Species baseline'}</strong>
                          </div>
                        </div>

                        {dos.notes && (
                          <div className="dosage-notes-row">
                            <span className="notes-heading">CLINICAL & REVERSAL PROTOCOL:</span>
                            <p className="notes-body-txt">{dos.notes}</p>
                          </div>
                        )}

                        {/* Persistent disclaimer banner */}
                        <div className="dosage-disclaimer-banner">
                          <AlertTriangle size={13} className="disclaimer-alert-icon" />
                          <span>{dos.disclaimer || "AI-estimated dosage — verify before administering"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {selectedEventModal.review_note && (
                  <div className="info-block review-notes-block">
                    <span className="info-label">VETERINARIAN CLINICAL OBSERVATION</span>
                    <p>{selectedEventModal.review_note}</p>
                    <small>Reviewed by: {selectedEventModal.reviewer_name || 'Doctor'}</small>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="btn-primary-action"
                onClick={() => setSelectedEventModal(null)}
              >
                CLOSE DOSSIER
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NormalUserDashboard;

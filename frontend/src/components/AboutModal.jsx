import React, { useState, useEffect } from 'react';
import {
  X,
  Info,
  Cpu,
  Layers,
  Zap,
  Server,
  Database,
  Radio,
  Camera,
  Activity,
  Shield,
  Crosshair,
  Code2,
  GitBranch,
  Terminal,
  FileCheck2,
  Scale
} from 'lucide-react';
import { soundFx } from '../utils/audio';

export const AboutModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('models'); // 'models' | 'stack' | 'pipeline' | 'hardware'

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 25000 }}>
      <div
        className="tactical-modal-box about-modal-wrapper"
        style={{
          maxWidth: '860px',
          width: '94%',
          maxHeight: '88vh',
          overflowY: 'auto',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="auth-modal-close"
          onClick={(e) => {
            e.stopPropagation();
            soundFx.playTapClick();
            onClose();
          }}
          title="Close Specifications"
        >
          <X size={18} />
        </button>

        {/* Modal Tactical Header */}
        <div className="about-header-section">
          <div className="about-title-row">
            <div className="about-icon-pill">
              <Info size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="about-main-title">SYSTEM ARCHITECTURE & TECH STACK</h2>
              <p className="about-sub-title">
                SentryWing Wildlife Intelligence, Autonomous Tracking & Drone Dart Interception Platform
              </p>
            </div>
          </div>

          <div className="about-meta-badges">
            <span className="spec-chip active">EDGE + CLOUD READY</span>
            <span className="spec-chip">PYTORCH YOLOv8</span>
            <span className="spec-chip">SUPABASE SYNC</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="about-nav-tabs">
          <button
            type="button"
            className={`about-tab-btn ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => {
              soundFx.playTapClick();
              setActiveTab('models');
            }}
          >
            <Cpu size={15} />
            <span>AI & ML MODELS</span>
          </button>

          <button
            type="button"
            className={`about-tab-btn ${activeTab === 'stack' ? 'active' : ''}`}
            onClick={() => {
              soundFx.playTapClick();
              setActiveTab('stack');
            }}
          >
            <Code2 size={15} />
            <span>CORE TECH STACK</span>
          </button>

          <button
            type="button"
            className={`about-tab-btn ${activeTab === 'pipeline' ? 'active' : ''}`}
            onClick={() => {
              soundFx.playTapClick();
              setActiveTab('pipeline');
            }}
          >
            <Layers size={15} />
            <span>SURVEILLANCE PIPELINE</span>
          </button>

          <button
            type="button"
            className={`about-tab-btn ${activeTab === 'hardware' ? 'active' : ''}`}
            onClick={() => {
              soundFx.playTapClick();
              setActiveTab('hardware');
            }}
          >
            <Camera size={15} />
            <span>SENSORS & HARDWARE</span>
          </button>
        </div>

        {/* TAB 1: AI & ML MODELS */}
        {activeTab === 'models' && (
          <div className="about-tab-content">
            <div className="spec-card-grid">
              {/* Model 1: YOLOv8 Detector */}
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Crosshair size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">YOLOv8 Deep Vision Object Detector</div>
                      <div className="spec-card-file">backend/models/detector.pt (19.2 MB) &bull; ONNX / PyTorch</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">STAGE 1</span>
                </div>
                <p className="spec-card-desc">
                  Real-time multi-scale convolutional neural network trained on sanctuary and field camera datasets
                  for zero-latency identification of critical wildlife species under dense camouflage, canopy occlusion,
                  and low-light forest environments.
                </p>
                <div className="spec-points-list">
                  <div className="spec-point-item">
                    <strong>Trained Classes:</strong> Indian Leopard, Bengal Tiger, Asian Elephant, Sloth Bear, Spotted Deer (Chital), Wild Boar, Lion, Hyena
                  </div>
                  <div className="spec-point-item">
                    <strong>Input Resolution:</strong> 640&times;640 multi-scale tensor normalized
                  </div>
                  <div className="spec-point-item">
                    <strong>Inference Latency:</strong> ~28ms (CUDA GPU) / ~95ms (Edge CPU)
                  </div>
                  <div className="spec-point-item">
                    <strong>Output:</strong> Normalized bounding boxes [x1, y1, x2, y2], class probability score (0.00–1.00), and center coordinates
                  </div>
                </div>
              </div>

              {/* Model 2: ByteTrack MOT */}
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Activity size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">ByteTrack Multi-Object Motion Tracker</div>
                      <div className="spec-card-file">backend/tracker.py &bull; 2D Kalman Filter & IoU Association</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">TRACKER</span>
                </div>
                <p className="spec-card-desc">
                  Autonomous object continuity engine maintaining persistent target locks during temporary occlusion
                  (e.g., animal walking behind trees or brush) without re-identification drift.
                </p>
                <div className="spec-points-list">
                  <div className="spec-point-item">
                    <strong>Target Lock Logic:</strong> Center Deadband Threshold (8% deadzone), Velocity damping vector (0.88), Directional Vector (&Delta;x, &Delta;y)
                  </div>
                  <div className="spec-point-item">
                    <strong>Lost-Count Buffer:</strong> 15 continuous frame memory before target lock disengagement
                  </div>
                  <div className="spec-point-item">
                    <strong>Drone Gimbal Command:</strong> Generates real-time PAN/TILT correctional offsets to center targets automatically
                  </div>
                </div>
              </div>

              {/* Model 3: Stage 2 Biometrics */}
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <FileCheck2 size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">Stage 2 Biometric & Attribute Classifier</div>
                      <div className="spec-card-file">backend/inference.py &bull; Morphology & Feature Extraction</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">STAGE 2</span>
                </div>
                <p className="spec-card-desc">
                  Extracts animal demographic and physiological attributes from high-resolution bounding box crops
                  to establish baseline health and prepare field intervention protocols.
                </p>
                <div className="spec-points-list">
                  <div className="spec-point-item">
                    <strong>Estimated Attributes:</strong> Age Group (Cub / Sub-Adult / Adult / Senior), Gender (Male / Female), Posture & Activity (Standing / Alert / Walking / Recumbent)
                  </div>
                  <div className="spec-point-item">
                    <strong>Health Index:</strong> Composite score (0.00–1.00) measuring coat sheen, symmetry, and mobility
                  </div>
                  <div className="spec-point-item">
                    <strong>Crop Aspect Ratio:</strong> Aspect ratio & body dimension volumetric approximation for weight prediction
                  </div>
                </div>
              </div>

              {/* Model 4: Stage 3 Dart Dosage Calculator */}
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Scale size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">Stage 3 Dart Dosage & Tranquilizer ML Model</div>
                      <div className="spec-card-file">backend/models/dart_dose_model.joblib (3.27 MB) &bull; Gradient Boosting</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">STAGE 3</span>
                </div>
                <p className="spec-card-desc">
                  Trained pharmacology regression and classification model validated with veterinary immobilization
                  formularies to compute exact milligrams and safety margins for dart projector delivery.
                </p>
                <div className="spec-points-list">
                  <div className="spec-point-item">
                    <strong>Supported Formularies:</strong> Ketamine + Medetomidine (5:1), Telazol + Xylazine, Etorphine HCl (M99), Zoletil
                  </div>
                  <div className="spec-point-item">
                    <strong>Dosage Metrics:</strong> Target weight (kg), Total Dose (mg), Ratio (mg/kg), Reversal Agent (Atipamezole, Naltrexone)
                  </div>
                  <div className="spec-point-item">
                    <strong>Safety Safeguard:</strong> Real-time disclaimer flags for field veterinarians to confirm before tranquilization
                  </div>
                </div>
              </div>

              {/* Model 5: Edge Wildlife Fallback */}
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Zap size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">Edge Wildlife Intelligence Engine (Fallback)</div>
                      <div className="spec-card-file">frontend/src/utils/edgeDetector.js &bull; Client Canvas Vision</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">EDGE AI</span>
                </div>
                <p className="spec-card-desc">
                  Autonomous client-side fallback engine providing zero-failure detection and dosage computation
                  even when deployed on static web hosts (Vercel CDN) or in disconnected offline field operations.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CORE TECH STACK */}
        {activeTab === 'stack' && (
          <div className="about-tab-content">
            <div className="tech-stack-layout">
              {/* Frontend */}
              <div className="tech-group-card">
                <div className="tech-group-header">
                  <Code2 size={16} className="text-accent" />
                  <span>FRONTEND ARCHITECTURE</span>
                </div>
                <div className="tech-pills-wrap">
                  <div className="tech-pill">
                    <strong>React 19</strong>
                    <span>Core Component Architecture</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Vite 6</strong>
                    <span>High-Speed HMR & HTTPS Dev Server</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Vanilla Tactical CSS</strong>
                    <span>Zero-framework glassmorphism & HUD system</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Leaflet & OSM</strong>
                    <span>Interactive geospatial reserve mapping</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Lucide Icons</strong>
                    <span>Ultra-crisp vector tactical iconography</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Web Audio API</strong>
                    <span>Procedural military tone & alert synthesizer</span>
                  </div>
                </div>
              </div>

              {/* Backend */}
              <div className="tech-group-card">
                <div className="tech-group-header">
                  <Server size={16} className="text-accent" />
                  <span>BACKEND & COMPUTER VISION</span>
                </div>
                <div className="tech-pills-wrap">
                  <div className="tech-pill">
                    <strong>FastAPI</strong>
                    <span>High-throughput async Python API</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Uvicorn (ASGI)</strong>
                    <span>Production WebSocket & HTTP server</span>
                  </div>
                  <div className="tech-pill">
                    <strong>PyTorch & TorchVision</strong>
                    <span>Deep learning tensor runtime</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Ultralytics YOLOv8</strong>
                    <span>Object detection model core</span>
                  </div>
                  <div className="tech-pill">
                    <strong>OpenCV (cv2)</strong>
                    <span>Image demuxing, drawing & MJPEG proxy</span>
                  </div>
                  <div className="tech-pill">
                    <strong>scikit-learn & Joblib</strong>
                    <span>Gradient-boosted dosage regression model</span>
                  </div>
                </div>
              </div>

              {/* Database & Cloud */}
              <div className="tech-group-card">
                <div className="tech-group-header">
                  <Database size={16} className="text-accent" />
                  <span>CLOUD PERSISTENCE & DATA</span>
                </div>
                <div className="tech-pills-wrap">
                  <div className="tech-pill">
                    <strong>Supabase PostgreSQL</strong>
                    <span>Cloud database with Row-Level Security</span>
                  </div>
                  <div className="tech-pill">
                    <strong>SQLite 3</strong>
                    <span>Zero-config local database & cache (sentrywing.db)</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Native WebSockets</strong>
                    <span>Full-duplex telemetry & notification fan-out</span>
                  </div>
                  <div className="tech-pill">
                    <strong>Vercel Edge Platform</strong>
                    <span>Global CDN deployment & serverless endpoints</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SURVEILLANCE PIPELINE */}
        {activeTab === 'pipeline' && (
          <div className="about-tab-content">
            <div className="pipeline-flow-steps">
              <div className="flow-step">
                <div className="flow-step-num">01</div>
                <div className="flow-step-body">
                  <h4>Video / Still Ingestion</h4>
                  <p>Ingets frames from Phone Camera (HTTPS), ESP32-CAM MJPEG stream proxy, or direct file uploads (Photo/Video).</p>
                </div>
              </div>
              <div className="flow-step-connector" />

              <div className="flow-step">
                <div className="flow-step-num">02</div>
                <div className="flow-step-body">
                  <h4>Stage 1: YOLOv8 Inference</h4>
                  <p>Runs neural detection, generating spatial bounding boxes, class labels, and confidence probabilities.</p>
                </div>
              </div>
              <div className="flow-step-connector" />

              <div className="flow-step">
                <div className="flow-step-num">03</div>
                <div className="flow-step-body">
                  <h4>ByteTrack Target Locking</h4>
                  <p>Assigns persistent track IDs, computes target offset vector (&Delta;x, &Delta;y), and checks center deadband threshold.</p>
                </div>
              </div>
              <div className="flow-step-connector" />

              <div className="flow-step">
                <div className="flow-step-num">04</div>
                <div className="flow-step-body">
                  <h4>Stage 2: Biometrics & Morphology</h4>
                  <p>Crops target bounding box, evaluating animal age, gender, estimated weight, health index, and posture.</p>
                </div>
              </div>
              <div className="flow-step-connector" />

              <div className="flow-step">
                <div className="flow-step-num">05</div>
                <div className="flow-step-body">
                  <h4>Stage 3: Dart Dosage Formulation</h4>
                  <p>Calculates precise tranquilizer drug dosage (mg, mg/kg), projectile projection notes, and specific reversal agents.</p>
                </div>
              </div>
              <div className="flow-step-connector" />

              <div className="flow-step">
                <div className="flow-step-num">06</div>
                <div className="flow-step-body">
                  <h4>Supabase Cloud Fan-Out & Alerts</h4>
                  <p>Broadcasts live alert to Veterinarian and Forest Officer dashboards with audible tactical chimes and map coordinates.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SENSORS & HARDWARE */}
        {activeTab === 'hardware' && (
          <div className="about-tab-content">
            <div className="spec-card-grid">
              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Radio size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">ESP32-CAM IoT Video Ingestion Bridge</div>
                      <div className="spec-card-file">bridge/esp32_bridge.py &bull; OV2640 Sensor &bull; Port 8000 Proxy</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">HARDWARE</span>
                </div>
                <p className="spec-card-desc">
                  Low-power edge microcontroller stream proxy that translates raw HTTP MJPEG streams from field-deployed
                  ESP32-CAM modules into CORS-compliant, HTTPS-compatible feeds with auto-reconnection and FPS throttling.
                </p>
                <div className="spec-points-list">
                  <div className="spec-point-item">
                    <strong>Sensor Compatibility:</strong> OV2640 / OV3660 / OV5640 CMOS camera sensors
                  </div>
                  <div className="spec-point-item">
                    <strong>Stream Resolution:</strong> SVGA (800&times;600), VGA (640&times;480), CIF (400&times;296)
                  </div>
                  <div className="spec-point-item">
                    <strong>Security Bypass:</strong> Backend reverse proxy completely eliminates Mixed Content (HTTPS &rarr; HTTP) blocking
                  </div>
                </div>
              </div>

              <div className="spec-card">
                <div className="spec-card-head">
                  <div className="spec-card-title-wrap">
                    <Camera size={18} className="text-accent" />
                    <div>
                      <div className="spec-card-title">Mobile Phone & Field Tablet Cameras</div>
                      <div className="spec-card-file">frontend/src/utils/frameSource.js &bull; getUserMedia API</div>
                    </div>
                  </div>
                  <span className="spec-badge-stage">MOBILE HUD</span>
                </div>
                <p className="spec-card-desc">
                  Accesses rear-facing wide and telephoto lenses on mobile handsets with hardware flash/torch control,
                  pinch-to-zoom, and 60 FPS requestVideoFrameCallback synchronization.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="about-modal-footer">
          <div className="about-footer-info">
            <span>SentryWing Drone Wildlife Surveillance System &bull; Open Source AI Initiative</span>
          </div>
          <button
            type="button"
            className="btn-auth-submit"
            style={{ width: 'auto', padding: '8px 20px', fontSize: '12px' }}
            onClick={() => {
              soundFx.playTapClick();
              onClose();
            }}
          >
            DISMISS SPECIFICATIONS
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;

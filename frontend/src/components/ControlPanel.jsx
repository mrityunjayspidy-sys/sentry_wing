import React, { useState } from 'react';
import { X, Volume2, VolumeX, Smartphone, RefreshCw, Layers, Shield } from 'lucide-react';
import { soundFx } from '../utils/audio';

export const ControlPanel = ({
  isOpen,
  onClose,
  autoLock,
  onToggleAutoLock,
  targetFps,
  onChangeFps,
  confidenceThreshold,
  onChangeConfidence,
  deadband,
  onChangeDeadband,
  lockLostThreshold,
  onChangeLockLostThreshold,
  detectorType,
  attributeType,
  onReloadModels
}) => {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [isReloading, setIsReloading] = useState(false);

  if (!isOpen) return null;

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    soundFx.setSoundEnabled(nextVal);
    if (nextVal) soundFx.playTapClick();
  };

  const handleToggleHaptic = () => {
    const nextVal = !hapticEnabled;
    setHapticEnabled(nextVal);
    soundFx.setHapticEnabled(nextVal);
    if (nextVal) soundFx.playTapClick();
  };

  const handleReloadClick = async () => {
    setIsReloading(true);
    soundFx.playTapClick();
    if (onReloadModels) {
      await onReloadModels();
    }
    setTimeout(() => setIsReloading(false), 500);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">CALIBRATION & SETTINGS</div>
          <button className="btn-icon-tactical" onClick={onClose} title="Close Settings">
            <X size={22} />
          </button>
        </div>

        {/* Model Engine Status Card */}
        <div className="model-info-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 800, color: '#ffffff', fontSize: '13px' }}>
            <Layers size={16} /> MODEL PIPELINE STATUS
          </div>
          <div>Stage 1 Detector: <strong>{detectorType?.toUpperCase() || 'YOLO_PT'}</strong></div>
          <div>Stage 2 Attributes: <strong>{attributeType?.toUpperCase() || 'RULE_ENGINE'}</strong></div>
          <div style={{ marginTop: 6, fontSize: '11px', color: 'var(--text-muted)' }}>
            Weights: <code>backend/models/detector.pt</code> (8 Species)
          </div>
          <button
            className="btn-full"
            style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={handleReloadClick}
            disabled={isReloading}
          >
            <RefreshCw size={16} className={isReloading ? 'spin' : ''} />
            {isReloading ? 'RELOADING...' : 'RELOAD MODELS'}
          </button>
        </div>

        {/* Tracking Mode Toggle */}
        <div className="control-group">
          <div className="control-label">
            <span>TARGET ACQUISITION MODE</span>
          </div>
          <button
            className={`btn-tactical-main ${autoLock ? '' : 'locked-active'}`}
            style={{ minHeight: 52 }}
            onClick={onToggleAutoLock}
          >
            <Shield size={18} />
            {autoLock ? 'AUTO-LOCK: ON (FIRST ANIMAL)' : 'MANUAL TAP-TO-LOCK'}
          </button>
        </div>

        {/* Streaming Frame Rate Slider */}
        <div className="control-group">
          <div className="control-label">
            <span>CAPTURE RATE</span>
            <strong style={{ color: '#ffffff' }}>{targetFps} FPS</strong>
          </div>
          <input
            type="range"
            min="5"
            max="30"
            step="1"
            value={targetFps}
            onChange={(e) => onChangeFps(Number(e.target.value))}
            className="control-slider"
          />
        </div>

        {/* Confidence Threshold */}
        <div className="control-group">
          <div className="control-label">
            <span>CONFIDENCE THRESHOLD</span>
            <strong style={{ color: '#ffffff' }}>{Math.round(confidenceThreshold * 100)}%</strong>
          </div>
          <input
            type="range"
            min="0.10"
            max="0.90"
            step="0.05"
            value={confidenceThreshold}
            onChange={(e) => onChangeConfidence(Number(e.target.value))}
            className="control-slider"
          />
        </div>

        {/* Center Deadband */}
        <div className="control-group">
          <div className="control-label">
            <span>CENTER DEADBAND</span>
            <strong style={{ color: '#ffffff' }}>{(deadband * 100).toFixed(0)}%</strong>
          </div>
          <input
            type="range"
            min="0.02"
            max="0.20"
            step="0.01"
            value={deadband}
            onChange={(e) => onChangeDeadband(Number(e.target.value))}
            className="control-slider"
          />
        </div>

        {/* Lock-loss frame timeout */}
        <div className="control-group">
          <div className="control-label">
            <span>LOCK-LOSS DROP TIMEOUT</span>
            <strong style={{ color: '#ffffff' }}>{lockLostThreshold} FRAMES</strong>
          </div>
          <input
            type="range"
            min="5"
            max="45"
            step="1"
            value={lockLostThreshold}
            onChange={(e) => onChangeLockLostThreshold(Number(e.target.value))}
            className="control-slider"
          />
        </div>

        {/* Tactical Feedback Toggles */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <button
            className={`btn-tactical-toggle ${soundEnabled ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={handleToggleSound}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {soundEnabled ? 'AUDIO FX' : 'MUTED'}
          </button>

          <button
            className={`btn-tactical-toggle ${hapticEnabled ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={handleToggleHaptic}
          >
            <Smartphone size={16} />
            {hapticEnabled ? 'HAPTIC' : 'DISABLED'}
          </button>
        </div>
      </div>
    </div>
  );
};

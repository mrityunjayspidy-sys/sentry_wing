import React from 'react';
import { Cpu, Sliders, Eye } from 'lucide-react';

export const TelemetryBar = ({
  isConnected,
  isConnecting,
  fps,
  latencyMs,
  detectorType,
  attributeType,
  onOpenSettings
}) => {
  return (
    <header className="hud-header">
      <div className="brand-section">
        <div className="brand-badge">
          <Eye size={20} color="#ffffff" />
          TARGET_LOCK
        </div>
        <span className="brand-phase">PHASE 1</span>
      </div>

      <div className="telemetry-pills">
        {/* Model Engine Pill */}
        <div className="hud-pill" title={`Detector: ${detectorType} | Attributes: ${attributeType}`}>
          <Cpu size={14} color="#ffffff" />
          <span>{detectorType?.toUpperCase() || 'YOLO_PT'}</span>
        </div>

        {/* FPS & Latency */}
        <div className="hud-pill">
          <span>{fps || 0} FPS</span>
          <span style={{ opacity: 0.35 }}>|</span>
          <span>{latencyMs || 0}ms</span>
        </div>

        {/* WS Connection Pill */}
        <div className={`hud-pill ${isConnected ? 'online' : 'offline'}`}>
          <div className={`status-dot ${isConnected ? '' : 'red'}`} />
          <span>{isConnected ? 'ONLINE' : isConnecting ? 'CONNECTING' : 'OFFLINE'}</span>
        </div>

        {/* Enlarged Settings Toggle Button */}
        <button
          className="btn-icon-tactical"
          onClick={onOpenSettings}
          title="Open Settings & Calibration"
        >
          <Sliders size={20} />
        </button>
      </div>
    </header>
  );
};

import React from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ArrowUpLeft, ArrowDownRight, ArrowDownLeft, Crosshair } from 'lucide-react';

export const TargetReticle = ({ tracking }) => {
  if (!tracking) return null;

  const { locked, state, dx = 0, dy = 0, direction = 'CENTERED', hardware_command } = tracking;

  // Render directional arrow icon based on direction string
  const renderDirectionIcon = () => {
    switch (direction) {
      case 'UP': return <ArrowUp size={22} />;
      case 'DOWN': return <ArrowDown size={22} />;
      case 'LEFT': return <ArrowLeft size={22} />;
      case 'RIGHT': return <ArrowRight size={22} />;
      case 'UP_RIGHT': return <ArrowUpRight size={22} />;
      case 'UP_LEFT': return <ArrowUpLeft size={22} />;
      case 'DOWN_RIGHT': return <ArrowDownRight size={22} />;
      case 'DOWN_LEFT': return <ArrowDownLeft size={22} />;
      case 'CENTERED': default: return <Crosshair size={20} />;
    }
  };

  // Target pip position in gimbal radar (clamp -1..1 to 10%..90%)
  const pipLeft = `${50 + (dx * 38)}%`;
  const pipTop = `${50 + (dy * 38)}%`;

  return (
    <div className="gimbal-hud-container">
      <div className="gimbal-compass">
        {/* Radar crosshairs */}
        <div className="gimbal-crosshair-h" />
        <div className="gimbal-crosshair-v" />
        
        {/* Center deadzone target ring */}
        <div className="gimbal-deadband-circle" />

        {/* Dynamic target tracking pip */}
        {locked && (
          <div
            className="gimbal-target-pip"
            style={{ left: pipLeft, top: pipTop }}
          />
        )}

        {/* Center direction arrow */}
        <div
          className="gimbal-pointer-arrow"
          style={{
            color: locked ? (direction === 'CENTERED' ? 'var(--hud-cyan)' : 'var(--hud-green)') : 'var(--text-muted)',
            filter: locked ? 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))' : 'none'
          }}
        >
          {renderDirectionIcon()}
        </div>
      </div>

      {/* Numerical dx/dy and Servo telemetry */}
      <div className="gimbal-telemetry-text">
        {locked ? (
          <>
            {tracking.predicted && (
              <span style={{ color: '#ffffff', fontWeight: 800, marginRight: 6, letterSpacing: '0.04em' }}>
                [PREDICTED {tracking.lost_count || 1}/{tracking.max_lost_threshold || 10}]
              </span>
            )}
            dx: {dx >= 0 ? `+${dx.toFixed(2)}` : dx.toFixed(2)} | dy: {dy >= 0 ? `+${dy.toFixed(2)}` : dy.toFixed(2)}
          </>
        ) : (
          <span>SWEEP RADAR</span>
        )}
      </div>

      {hardware_command && (
        <div className="gimbal-telemetry-text" style={{ fontSize: '9px', color: 'var(--hud-cyan)' }}>
          PAN: {hardware_command.pan_angle}° | TILT: {hardware_command.tilt_angle}°
        </div>
      )}
    </div>
  );
};

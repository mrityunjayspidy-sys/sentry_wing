import React from 'react';
import { Activity, Clock, User, Scale, Eye, AlertTriangle } from 'lucide-react';

export const AttributeCard = ({ attributes, targetClass, isLocked }) => {
  if (!isLocked || !attributes) return null;

  const {
    age,
    sex,
    body_size,
    weight_range,
    behaviour,
    details,
    quality_flags = [],
  } = attributes;

  return (
    <div className="attribute-card">
      <div className="attr-header">
        <div className="attr-title">
          <Activity size={18} color="#ffffff" />
          <span>TARGET: <strong className="attr-target-tag">{targetClass?.toUpperCase() || 'ANIMAL'}</strong></span>
        </div>
        <div className="attr-stage-badge">
          STAGE 2 // ATTRIBUTE ENGINE
        </div>
      </div>

      <div className="attr-grid">
        <div className="attr-item">
          <div className="attr-label">
            <Clock size={12} style={{ display: 'inline', marginRight: 6, color: '#ffffff' }} />
            Age Estimate
          </div>
          <div className="attr-value">{age || 'Analyzing...'}</div>
        </div>

        <div className="attr-item">
          <div className="attr-label">
            <User size={12} style={{ display: 'inline', marginRight: 6, color: '#ffffff' }} />
            Sex Estimate
          </div>
          <div className="attr-value">{sex ? sex.charAt(0).toUpperCase() + sex.slice(1) : 'Unknown'}</div>
        </div>

        <div className="attr-item">
          <div className="attr-label">
            <Scale size={12} style={{ display: 'inline', marginRight: 6, color: '#ffffff' }} />
            Weight & Body Size
          </div>
          <div className="attr-value" style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>
            {attributes.estimated_weight_kg ? (
              <span>{attributes.estimated_weight_kg} kg {body_size ? `(${body_size})` : ''}</span>
            ) : weight_range ? (
              <span>{weight_range} {body_size ? `(${body_size})` : ''}</span>
            ) : (
              <span>{body_size ? body_size.charAt(0).toUpperCase() + body_size.slice(1) : '—'}</span>
            )}
          </div>
        </div>

        <div className="attr-item">
          <div className="attr-label">
            <Eye size={12} style={{ display: 'inline', marginRight: 6, color: '#ffffff' }} />
            Behaviour
          </div>
          <div className="attr-value" style={{ fontSize: '12px' }}>
            {behaviour ? behaviour.replace(/_/g, ' ') : '—'}
          </div>
        </div>
      </div>

      {/* Quality flags warnings */}
      {quality_flags && quality_flags.length > 0 && (
        <div className="attr-details" style={{ borderLeftColor: '#ffffff', background: 'rgba(255, 255, 255, 0.05)' }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: '#ffffff' }} />
          <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '11px' }}>
            {quality_flags.map(f => f.replace(/_/g, ' ')).join(' · ')}
          </span>
        </div>
      )}

      {details && (
        <div className="attr-details">
          {details}
        </div>
      )}
    </div>
  );
};

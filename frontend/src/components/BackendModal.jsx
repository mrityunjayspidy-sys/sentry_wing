import React, { useState, useEffect } from 'react';
import { Server, Activity, CheckCircle2, AlertCircle, RefreshCw, X, Terminal, ExternalLink } from 'lucide-react';
import { getCustomBackendUrl, setCustomBackendUrl, testBackendPing } from '../utils/api';
import { soundFx } from '../utils/audio';

export const BackendModal = ({ isOpen, onClose, isConnected }) => {
  const [urlInput, setUrlInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(getCustomBackendUrl());
      setTestResult(null);
      setSavedSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    soundFx.playTapClick();
    setTesting(true);
    setTestResult(null);
    setSavedSuccess(false);

    const result = await testBackendPing(urlInput);
    setTesting(false);
    setTestResult(result);
    if (result.success) {
      soundFx.playLockAcquired();
    } else {
      soundFx.playLockLost();
    }
  };

  const handleSave = () => {
    soundFx.playTapClick();
    setCustomBackendUrl(urlInput);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 600);
  };

  const handleResetLocal = () => {
    soundFx.playTapClick();
    setUrlInput('');
    setCustomBackendUrl('');
    setTestResult(null);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 600);
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div
        className="auth-modal-content"
        style={{ maxWidth: '560px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="auth-modal-close" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="auth-header" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={22} className="brand-shield-icon" />
            <h2 className="auth-title">AI ENGINE BACKEND LINK</h2>
          </div>
          <p className="auth-subtitle">
            Configure the Python FastAPI & YOLO inference server URL for this deployment.
          </p>
        </div>

        {/* Engine Status Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: isConnected ? 'rgba(0, 255, 100, 0.08)' : 'rgba(255, 60, 60, 0.08)',
            border: `1px solid ${isConnected ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 60, 60, 0.3)'}`,
            borderRadius: '6px',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: isConnected ? '#00ff66' : '#ff4444',
                boxShadow: isConnected ? '0 0 8px #00ff66' : '0 0 8px #ff4444'
              }}
            />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>
                {isConnected ? 'SURVEILLANCE ENGINE CONNECTED' : 'BACKEND ENGINE DISCONNECTED'}
              </div>
              <div style={{ fontSize: '11px', color: '#888' }}>
                {window.location.hostname.includes('vercel.app')
                  ? 'Running on Vercel Cloud (Static Frontend)'
                  : `Running on ${window.location.host}`}
              </div>
            </div>
          </div>
        </div>

        {/* Deployment Context Hint */}
        {window.location.hostname.includes('vercel.app') && (
          <div
            style={{
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#ccc',
              marginBottom: '16px',
              lineHeight: '1.5'
            }}
          >
            <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={14} /> Quick Link to Local AI Model:
            </div>
            <span>Vercel hosts the web UI, while your Python AI engine runs on your machine (Port 8000). Expose your local backend via HTTPS by running:</span>
            <div
              style={{
                background: '#050505',
                padding: '8px 10px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#00ff66',
                margin: '8px 0',
                userSelect: 'all'
              }}
            >
              npx localtunnel --port 8000
            </div>
            <span>Copy the generated <code style={{ color: '#00ff66' }}>https://...</code> tunnel URL and paste it below.</span>
          </div>
        )}

        {/* URL Input Form */}
        <div className="auth-form" style={{ gap: '12px' }}>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>BACKEND API ENDPOINT URL</span>
              <span style={{ fontSize: '10px', color: '#888' }}>e.g. https://xxxx.loca.lt or http://localhost:8000</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Leave blank for localhost dev server (/api)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          {/* Test Connection Feedback */}
          {testResult && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: testResult.success ? 'rgba(0, 255, 100, 0.1)' : 'rgba(255, 50, 50, 0.1)',
                color: testResult.success ? '#00ff66' : '#ff6666',
                border: `1px solid ${testResult.success ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 50, 50, 0.3)'}`
              }}
            >
              {testResult.success ? (
                <>
                  <CheckCircle2 size={16} />
                  <span>Connection successful! Latency: {testResult.latency}ms</span>
                </>
              ) : (
                <>
                  <AlertCircle size={16} />
                  <span>Ping failed: {testResult.error}</span>
                </>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn-auth-submit"
              style={{ flex: 1, background: '#1a1a1a', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />}
              {testing ? 'PINGING...' : 'TEST PING'}
            </button>

            <button
              type="button"
              className="btn-auth-submit"
              style={{ flex: 1.5 }}
              onClick={handleSave}
            >
              {savedSuccess ? 'SAVED & CONNECTING...' : 'SAVE & APPLY'}
            </button>
          </div>

          {urlInput && (
            <button
              type="button"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#888',
                fontSize: '11px',
                cursor: 'pointer',
                marginTop: '4px',
                textDecoration: 'underline'
              }}
              onClick={handleResetLocal}
            >
              Reset to Localhost Dev Proxy
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

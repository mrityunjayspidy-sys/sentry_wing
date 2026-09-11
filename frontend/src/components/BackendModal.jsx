import React, { useState, useEffect } from 'react';
import { Server, Database, Activity, CheckCircle2, AlertCircle, RefreshCw, X, Terminal, ExternalLink, Key, Globe, Shield } from 'lucide-react';
import { getCustomBackendUrl, setCustomBackendUrl, testBackendPing } from '../utils/api';
import { getSupabaseConfig, setSupabaseConfig, testSupabasePing, isSupabaseConfigured } from '../utils/supabase';
import { soundFx } from '../utils/audio';

export const BackendModal = ({ isOpen, onClose, isConnected }) => {
  const [activeTab, setActiveTab] = useState('supabase'); // 'backend' | 'supabase'

  // Backend state
  const [urlInput, setUrlInput] = useState('');
  const [testingBackend, setTestingBackend] = useState(false);
  const [testBackendResult, setTestBackendResult] = useState(null);

  // Supabase state
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [testSupabaseResult, setTestSupabaseResult] = useState(null);
  const [supabaseStatus, setSupabaseStatus] = useState(false);

  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(getCustomBackendUrl());
      setTestBackendResult(null);

      const sb = getSupabaseConfig();
      setSupabaseUrlInput(sb.url);
      setSupabaseKeyInput(sb.key);
      setTestSupabaseResult(null);
      setSupabaseStatus(isSupabaseConfigured());

      setSavedSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Backend test & save
  const handleTestBackend = async () => {
    soundFx.playTapClick();
    setTestingBackend(true);
    setTestBackendResult(null);
    setSavedSuccess(false);

    const result = await testBackendPing(urlInput);
    setTestingBackend(false);
    setTestBackendResult(result);
    if (result.success) soundFx.playLockAcquired();
    else soundFx.playLockLost();
  };

  const handleSaveBackend = () => {
    soundFx.playTapClick();
    setCustomBackendUrl(urlInput);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 600);
  };

  const handleResetBackend = () => {
    soundFx.playTapClick();
    setUrlInput('');
    setCustomBackendUrl('');
    setTestBackendResult(null);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 600);
  };

  // Supabase test & save
  const handleTestSupabase = async () => {
    soundFx.playTapClick();
    setTestingSupabase(true);
    setTestSupabaseResult(null);
    setSavedSuccess(false);

    const result = await testSupabasePing(supabaseUrlInput, supabaseKeyInput);
    setTestingSupabase(false);
    setTestSupabaseResult(result);
    if (result.success) soundFx.playLockAcquired();
    else soundFx.playLockLost();
  };

  const handleSaveSupabase = () => {
    soundFx.playTapClick();
    setSupabaseConfig(supabaseUrlInput, supabaseKeyInput);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 600);
  };

  const handleResetSupabase = () => {
    soundFx.playTapClick();
    setSupabaseUrlInput('');
    setSupabaseKeyInput('');
    setSupabaseConfig('', '');
    setTestSupabaseResult(null);
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
        style={{ maxWidth: '600px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="auth-modal-close" onClick={onClose}>
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="auth-header" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={22} className="brand-shield-icon" />
            <h2 className="auth-title">CLOUD & SYSTEM INTEGRATIONS</h2>
          </div>
          <p className="auth-subtitle">
            Configure Supabase Cloud Database and Python AI Vision Engine endpoints.
          </p>
        </div>

        {/* Tactical Nav Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          <button
            type="button"
            style={{
              flex: 1,
              padding: '8px 12px',
              background: activeTab === 'supabase' ? 'rgba(0, 255, 136, 0.12)' : 'transparent',
              border: `1px solid ${activeTab === 'supabase' ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '4px',
              color: activeTab === 'supabase' ? '#00ff88' : '#888',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onClick={() => { soundFx.playTapClick(); setActiveTab('supabase'); }}
          >
            <Database size={14} />
            <span>SUPABASE CLOUD LINK</span>
            {supabaseStatus && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00ff88' }} />}
          </button>

          <button
            type="button"
            style={{
              flex: 1,
              padding: '8px 12px',
              background: activeTab === 'backend' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              border: `1px solid ${activeTab === 'backend' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '4px',
              color: activeTab === 'backend' ? '#fff' : '#888',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onClick={() => { soundFx.playTapClick(); setActiveTab('backend'); }}
          >
            <Server size={14} />
            <span>AI VISION BACKEND</span>
            {isConnected && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00ff88' }} />}
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: SUPABASE CLOUD DATABASE                                           */}
        {/* ========================================================================= */}
        {activeTab === 'supabase' && (
          <div className="auth-form" style={{ gap: '12px' }}>
            {/* Supabase Status Banner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: supabaseStatus ? 'rgba(0, 255, 100, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${supabaseStatus ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: '6px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: supabaseStatus ? '#00ff88' : '#888',
                    boxShadow: supabaseStatus ? '0 0 8px #00ff88' : 'none'
                  }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>
                    {supabaseStatus ? 'SUPABASE CLOUD DATABASE LINKED' : 'SUPABASE NOT LINKED'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>
                    {supabaseStatus ? 'Cloud auth, notification sync, and detection persistence active' : 'Using local browser/database storage'}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Step-by-Step Instructions */}
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#aaa',
                lineHeight: '1.5'
              }}
            >
              <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ExternalLink size={12} /> Where to find your credentials:
              </div>
              <div>1. Open your project on <strong style={{ color: '#fff' }}>supabase.com/dashboard</strong></div>
              <div>2. Click <strong style={{ color: '#fff' }}>Project Settings</strong> (gear icon) &rarr; <strong style={{ color: '#fff' }}>API</strong></div>
              <div>3. Copy <strong style={{ color: '#00ff88' }}>Project URL</strong> and <strong style={{ color: '#00ff88' }}>anon/public Key</strong> and paste below:</div>
            </div>

            {/* URL Input */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>PROJECT URL</span>
                <span style={{ fontSize: '10px', color: '#888' }}>https://[your-project-ref].supabase.co</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="https://xyzcompany.supabase.co"
                value={supabaseUrlInput}
                onChange={(e) => setSupabaseUrlInput(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>

            {/* Anon Key Input */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>ANON / PUBLIC API KEY</span>
                <span style={{ fontSize: '10px', color: '#888' }}>eyJhbGciOiJIUzI1NiIsIn...</span>
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="Paste your anon public key"
                value={supabaseKeyInput}
                onChange={(e) => setSupabaseKeyInput(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>

            {/* Test Ping Feedback */}
            {testSupabaseResult && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: testSupabaseResult.success ? 'rgba(0, 255, 100, 0.1)' : 'rgba(255, 50, 50, 0.1)',
                  color: testSupabaseResult.success ? '#00ff88' : '#ff6666',
                  border: `1px solid ${testSupabaseResult.success ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 50, 50, 0.3)'}`
                }}
              >
                {testSupabaseResult.success ? (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Supabase Connected! Ping Latency: {testSupabaseResult.latency}ms</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} />
                    <span>Connection failed: {testSupabaseResult.error}</span>
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
                onClick={handleTestSupabase}
                disabled={testingSupabase || !supabaseUrlInput || !supabaseKeyInput}
              >
                {testingSupabase ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />}
                {testingSupabase ? 'PINGING...' : 'TEST PING'}
              </button>

              <button
                type="button"
                className="btn-auth-submit"
                style={{ flex: 1.5, background: '#00ff88', color: '#000', fontWeight: 800 }}
                onClick={handleSaveSupabase}
                disabled={!supabaseUrlInput || !supabaseKeyInput}
              >
                {savedSuccess ? 'SAVED & LINKED!' : 'SAVE & LINK SUPABASE'}
              </button>
            </div>

            {supabaseUrlInput && (
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
                onClick={handleResetSupabase}
              >
                Disconnect Supabase Cloud
              </button>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: AI VISION BACKEND                                                 */}
        {/* ========================================================================= */}
        {activeTab === 'backend' && (
          <div className="auth-form" style={{ gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: isConnected ? 'rgba(0, 255, 100, 0.08)' : 'rgba(255, 60, 60, 0.08)',
                border: `1px solid ${isConnected ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 60, 60, 0.3)'}`,
                borderRadius: '6px'
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

            {window.location.hostname.includes('vercel.app') && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#ccc',
                  lineHeight: '1.4'
                }}
              >
                <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={12} /> Local Tunnel Command:
                </div>
                <span>Expose local machine to Vercel via: <code style={{ color: '#00ff66', background: '#000', padding: '2px 4px', borderRadius: '3px' }}>npx localtunnel --port 8000</code></span>
              </div>
            )}

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

            {testBackendResult && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: testBackendResult.success ? 'rgba(0, 255, 100, 0.1)' : 'rgba(255, 50, 50, 0.1)',
                  color: testBackendResult.success ? '#00ff66' : '#ff6666',
                  border: `1px solid ${testBackendResult.success ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 50, 50, 0.3)'}`
                }}
              >
                {testBackendResult.success ? (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Connection successful! Latency: {testBackendResult.latency}ms</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} />
                    <span>Ping failed: {testBackendResult.error}</span>
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn-auth-submit"
                style={{ flex: 1, background: '#1a1a1a', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
                onClick={handleTestBackend}
                disabled={testingBackend}
              >
                {testingBackend ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />}
                {testingBackend ? 'PINGING...' : 'TEST PING'}
              </button>

              <button
                type="button"
                className="btn-auth-submit"
                style={{ flex: 1.5 }}
                onClick={handleSaveBackend}
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
                onClick={handleResetBackend}
              >
                Reset to Localhost Dev Proxy
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

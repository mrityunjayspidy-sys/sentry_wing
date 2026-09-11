import React, { useState } from 'react';
import { Shield, Lock, Mail, User, X, Check, ArrowRight, Stethoscope, Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { soundFx } from '../utils/audio';

export const AuthModal = ({ isOpen, onClose }) => {
  const { login, register, isSupabase } = useAuth();
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('user'); // 'user' | 'vet' | 'admin'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    soundFx.playTapClick();

    try {
      if (tab === 'login') {
        await login(email, password, role);
      } else {
        await register(name, email, password, role);
      }
      soundFx.playLockAcquired();
      if (onClose) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = async (demoEmail, demoPass, demoRole) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setRole(demoRole);
    setError('');
    setLoading(true);
    soundFx.playTapClick();

    try {
      await login(demoEmail, demoPass, demoRole);
      soundFx.playLockAcquired();
      if (onClose) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="tactical-modal-box auth-modal-box">
        <div className="modal-header">
          <div className="auth-header-brand">
            <Shield size={20} />
            <div>
              <h4>SENTRYWING ACCESS CONTROL</h4>
              <small style={{ fontSize: '10px', color: '#888888', letterSpacing: '0.05em' }}>
                {isSupabase ? '⚡ SUPABASE CLOUD AUTH' : '🛡️ LOCAL PERSISTENT AUTH'}
              </small>
            </div>
          </div>
          {onClose && (
            <button className="btn-icon-close" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Tab switch */}
        <div className="auth-tabs">
          <button
            className={`auth-tab-btn ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            SIGN IN
          </button>
          <button
            className={`auth-tab-btn ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError(''); }}
          >
            CREATE ACCOUNT
          </button>
        </div>

        {error && <div className="auth-error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          {tab === 'register' && (
            <div className="input-field">
              <label><User size={12} /> Full Name</label>
              <input
                type="text"
                placeholder="Ranger Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="input-field">
            <label><Mail size={12} /> Email Address</label>
            <input
              type="email"
              placeholder="e.g. ranger@forest.gov.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-field">
            <label><Lock size={12} /> Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* Role Selector */}
          <div className="input-field">
            <label>Select User Role</label>
            <div className="auth-role-cards">
              <div
                className={`role-select-card ${role === 'user' ? 'selected' : ''}`}
                onClick={() => setRole('user')}
              >
                <div className="role-card-text">
                  <strong>Normal User</strong>
                  <span>Photo & Video Upload</span>
                </div>
                {role === 'user' && <Check size={14} className="check" />}
              </div>

              <div
                className={`role-select-card ${role === 'vet' ? 'selected' : ''}`}
                onClick={() => setRole('vet')}
              >
                <div className="role-card-text">
                  <strong>Veterinarian</strong>
                  <span>Live Feed & Triage</span>
                </div>
                {role === 'vet' && <Check size={14} className="check" />}
              </div>

              <div
                className={`role-select-card ${role === 'admin' ? 'selected' : ''}`}
                onClick={() => setRole('admin')}
              >
                <div className="role-card-text">
                  <strong>Forest Officer</strong>
                  <span>Map Telemetry & Admins</span>
                </div>
                {role === 'admin' && <Check size={14} className="check" />}
              </div>
            </div>
          </div>

          <button type="submit" className="btn-auth-submit" disabled={loading}>
            <span>{loading ? 'AUTHENTICATING...' : tab === 'login' ? 'SIGN IN' : 'REGISTER ACCOUNT'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        {/* Demo Fast Login Buttons */}
        <div className="demo-credentials-section">
          <div className="demo-title">QUICK 1-CLICK DEMO LOGIN:</div>
          <div className="demo-buttons-grid">
            <button
              type="button"
              className="btn-demo-pill"
              onClick={() => handleQuickDemo('user@forest.gov.in', 'user123', 'user')}
            >
              <span>Normal User</span>
              <small>user@forest.gov.in</small>
            </button>

            <button
              type="button"
              className="btn-demo-pill"
              onClick={() => handleQuickDemo('vet@forest.gov.in', 'vet123', 'vet')}
            >
              <span>Veterinarian</span>
              <small>vet@forest.gov.in</small>
            </button>

            <button
              type="button"
              className="btn-demo-pill"
              onClick={() => handleQuickDemo('admin@forest.gov.in', 'admin123', 'admin')}
            >
              <span>Forest Officer</span>
              <small>admin@forest.gov.in</small>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;

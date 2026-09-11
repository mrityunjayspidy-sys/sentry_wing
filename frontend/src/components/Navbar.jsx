import React from 'react';
import { Shield, Radio, Bell, LogOut, User, Stethoscope, Compass, Server } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { soundFx } from '../utils/audio';

export const Navbar = ({
  isConnected,
  unreadCount = 0,
  onOpenNotifications,
  onOpenBackendModal
}) => {
  const { currentUser, logout, setIsAuthModalOpen } = useAuth();

  const getRoleBadge = (role) => {
    switch (role) {
      case 'vet':
        return { label: 'VETERINARIAN', icon: 'STETHOSCOPE' };
      case 'admin':
        return { label: 'FOREST OFFICER (ADMIN)', icon: 'SHIELD' };
      default:
        return { label: 'NORMAL USER (SCOUT)', icon: 'SCOUT' };
    }
  };

  const badge = currentUser ? getRoleBadge(currentUser.role) : null;

  return (
    <header className="tactical-navbar">
      {/* Brand & Status */}
      <div className="nav-brand-section">
        <div className="brand-logo-wrap">
          <span className="brand-title">SENTRY<span className="brand-highlight">WING</span></span>
          <span className="brand-version-badge">v2.1 MONOCHROME</span>
        </div>

        <button
          className={`status-pill-mono ${isConnected ? 'online' : 'offline'}`}
          onClick={() => {
            soundFx.playTapClick();
            if (onOpenBackendModal) onOpenBackendModal();
          }}
          title="Click to configure AI Engine Backend Server Link"
          style={{ cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
        >
          <div className={`status-dot-mono ${isConnected ? 'pulsing' : ''}`} />
          <span>{isConnected ? 'SURVEILLANCE ENGINE ONLINE' : 'ENGINE CONNECTING...'}</span>
          <Server size={11} style={{ opacity: 0.7, marginLeft: '4px' }} />
        </button>
      </div>

      {/* Right Controls: Notification Bell, Profile, Switch/Logout */}
      <div className="nav-controls-section">
        {/* Notification Bell for Vet, Admin & Users */}
        {currentUser && (
          <button
            className={`btn-notification-bell ${unreadCount > 0 ? 'has-unread' : ''}`}
            onClick={onOpenNotifications}
            title="Open Wildlife Sighting Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="notif-badge">{unreadCount}</span>
            )}
          </button>
        )}

        {/* Current User Pill & Switch / Logout */}
        {currentUser ? (
          <div className="user-profile-badge">
            <div className="profile-text">
              <span className="profile-name">{currentUser.name}</span>
              <span className="profile-role">{badge.label}</span>
            </div>
            <button
              className="btn-switch-account"
              onClick={() => {
                soundFx.playTapClick();
                logout();
              }}
              title="Switch Account / Sign Out"
            >
              <LogOut size={14} />
              <span>SWITCH</span>
            </button>
          </div>
        ) : (
          <button
            className="btn-login-trigger"
            onClick={() => setIsAuthModalOpen(true)}
          >
            <User size={14} />
            <span>SIGN IN</span>
          </button>
        )}
      </div>
    </header>
  );
};

export default Navbar;

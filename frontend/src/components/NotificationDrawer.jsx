import React, { useState } from 'react';
import {
  X,
  Bell,
  AlertTriangle,
  MapPin,
  CheckCircle,
  Clock,
  Eye,
  CheckCheck,
  Shield,
  Compass,
  ArrowUpRight,
  Crosshair,
  Scale,
  Trash2
} from 'lucide-react';
import { soundFx } from '../utils/audio';

export const NotificationDrawer = ({
  isOpen,
  onClose,
  notifications = [],
  onMarkRead,
  onSelectNotification,
  onDeleteNotification,
  onClearAllNotifications
}) => {
  const [filterTab, setFilterTab] = useState('ALL'); // 'ALL' | 'UNREAD'

  if (!isOpen) return null;

  const filteredNotifs = notifications.filter((n) => {
    if (filterTab === 'UNREAD') return !n.read;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="notification-drawer-overlay" onClick={onClose}>
      <div className="notification-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <Bell size={18} />
            <h3>WILDLIFE DETECTION DISPATCHES</h3>
            <span className="drawer-count-badge">{unreadCount} UNREAD</span>
          </div>
          <button className="btn-icon-close" onClick={onClose} title="Close notifications">
            <X size={16} />
          </button>
        </div>

        {/* Filter & Actions Bar */}
        <div className="drawer-filter-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="filter-pill-group">
            <button
              className={`btn-filter-pill ${filterTab === 'ALL' ? 'active' : ''}`}
              onClick={() => setFilterTab('ALL')}
            >
              ALL ({notifications.length})
            </button>
            <button
              className={`btn-filter-pill ${filterTab === 'UNREAD' ? 'active' : ''}`}
              onClick={() => setFilterTab('UNREAD')}
            >
              UNREAD ({unreadCount})
            </button>
          </div>

          {notifications.length > 0 && (
            <button
              type="button"
              className="btn-clear-all-notifs"
              onClick={(e) => {
                e.stopPropagation();
                soundFx.playTapClick();
                if (window.confirm('Clear all notification dispatches from the system?')) {
                  if (onClearAllNotifications) onClearAllNotifications();
                }
              }}
              title="Delete all notifications"
            >
              <Trash2 size={12} />
              <span>CLEAR ALL</span>
            </button>
          )}
        </div>

        {/* Scrollable Notifications Feed */}
        <div className="drawer-content-scroll">
          {filteredNotifs.length === 0 ? (
            <div className="empty-notif-state">
              <CheckCircle size={36} />
              <h4>NO ACTIVE WILDLIFE ALERTS</h4>
              <p>All monitored sectors are currently clear. New sightings from photo, video, or field units will appear here in real time.</p>
            </div>
          ) : (
            filteredNotifs.map((notif) => {
              const speciesTitle = (notif.species || 'Wildlife').toUpperCase();
              const isUnread = !notif.read;
              const sourceLabel = (notif.source_type || 'upload').toUpperCase();
              const locName = notif.location_name || notif.location?.name || 'Corbett Reserve Sector';
              const latCoord = notif.lat || notif.location?.lat || 29.5312;
              const lngCoord = notif.lng || notif.location?.lng || 78.7744;
              const uploaderName = notif.uploader || notif.uploader_name || 'Field Ranger';

              return (
                <div
                  key={notif.id}
                  className={`notif-card-mono ${isUnread ? 'unread' : 'read'}`}
                  onClick={() => {
                    if (isUnread && onMarkRead) onMarkRead(notif.id);
                    if (onSelectNotification) onSelectNotification(notif);
                  }}
                >
                  <div className="notif-top-meta">
                    <span className={`status-pill-small ${isUnread ? 'pill-alert' : 'pill-archived'}`}>
                      {isUnread ? 'NEW SIGHTING' : 'ACKNOWLEDGED'}
                    </span>
                    <span className="notif-source-pill">[{sourceLabel}]</span>
                    <span className="notif-time-stamp">
                      <Clock size={11} />
                      {notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                    </span>
                  </div>

                  <div className="notif-body-grid">
                    {/* Thumbnail if available */}
                    {notif.thumbnail && (
                      <div className="notif-thumb-box">
                        <img src={notif.thumbnail} alt={speciesTitle} className="notif-thumb-img" />
                      </div>
                    )}

                    <div className="notif-content-block">
                      <h4 className="notif-species-title">{speciesTitle} DETECTED</h4>

                      {/* Prominent Geolocation Information */}
                      <div className="notif-location-card">
                        <MapPin size={13} className="loc-pin-icon" />
                        <div className="loc-text-col">
                          <strong className="loc-sector-name">{locName}</strong>
                          <span className="loc-gps-coords">{latCoord}° N, {lngCoord}° E</span>
                        </div>
                      </div>

                      {/* Estimated Weight Badge */}
                      {(notif.attributes?.estimated_weight_kg || notif.attributes?.weight_range || notif.estimated_weight_kg) && (
                        <div className="notif-weight-badge">
                          <Scale size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                          <span>Weight: <strong>{notif.attributes?.estimated_weight_kg || notif.estimated_weight_kg ? `${notif.attributes?.estimated_weight_kg || notif.estimated_weight_kg} kg` : notif.attributes?.weight_range}</strong></span>
                        </div>
                      )}

                      {/* Stage 3 Dart Dosage Badge */}
                      {notif.dosage && (
                        <div className="notif-dosage-card">
                          <div className="notif-dosage-row">
                            <Crosshair size={12} className="notif-dosage-icon" />
                            <span className="notif-dosage-text">
                              Dart: <strong>{(notif.dosage.drug || notif.dosage.drug_recommendation || 'Tranquilizer').split(' ')[0]}</strong> ({notif.dosage.dosage_mg} mg)
                            </span>
                            {notif.dosage.confidence !== undefined && (
                              <span className="notif-dosage-conf">{Math.round((notif.dosage.confidence || 0.9) * 100)}%</span>
                            )}
                          </div>
                          <div className="notif-dosage-disclaimer">
                            AI-estimated dosage — verify before administering
                          </div>
                        </div>
                      )}

                      <div className="notif-footer-row">
                        <span className="notif-uploader-tag">Reported by: {uploaderName}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isUnread && (
                            <button
                              type="button"
                              className="btn-acknowledge-mono"
                              onClick={(e) => {
                                e.stopPropagation();
                                soundFx.playTapClick();
                                if (onMarkRead) onMarkRead(notif.id);
                              }}
                            >
                              ACKNOWLEDGE
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-delete-notif"
                            title="Delete this notification dispatch"
                            onClick={(e) => {
                              e.stopPropagation();
                              soundFx.playTapClick();
                              if (onDeleteNotification) onDeleteNotification(notif.id);
                            }}
                          >
                            <Trash2 size={11} />
                            <span>DELETE</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationDrawer;

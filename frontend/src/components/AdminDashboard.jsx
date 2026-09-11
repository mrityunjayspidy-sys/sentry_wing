import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield,
  Map as MapIcon,
  Users,
  BarChart3,
  CheckCircle,
  AlertTriangle,
  MapPin,
  Clock,
  UserX,
  UserCheck,
  Filter,
  Eye,
  Trash2,
  RefreshCw,
  Search,
  Radio,
  Database
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { soundFx } from '../utils/audio';
import { LiveFeedViewer } from './LiveFeedViewer';
import { PipelineDataManager } from './PipelineDataManager';
import { apiFetch } from '../utils/api';

export const AdminDashboard = () => {
  const [adminTab, setAdminTab] = useState('map'); // 'map' | 'users' | 'stats' | 'live_feed' | 'pipeline'
  const [detections, setDetections] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const fetchAdminData = useCallback(async () => {
    try {
      const [detResp, userResp, statResp] = await Promise.all([
        apiFetch('/api/detections?limit=200'),
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/stats')
      ]);
      const detData = await detResp.json();
      const userData = await userResp.json();
      const statData = await statResp.json();

      if (detData.events) setDetections(detData.events);
      if (userData.users) setUsers(userData.users);
      if (statData.stats) setStats(statData.stats);
    } catch (err) {
      console.warn('Admin data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fast auto-refresh every 4s so new sightings plot automatically on the map
  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 4000);
    return () => clearInterval(interval);
  }, [fetchAdminData]);

  // Leaflet Dark Monochrome Map
  useEffect(() => {
    if (adminTab !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [29.5312, 78.7744],
        zoom: 12,
        zoomControl: true
      });

      // CartoDB Dark Matter tiles for ultra-premium black & white aesthetic
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO &copy; OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    setTimeout(() => { map.invalidateSize(); }, 200);

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    // Custom monochrome pulse marker icon
    const createMonochromeIcon = (species) => {
      return L.divIcon({
        className: 'custom-mono-marker',
        html: `
          <div class="marker-pin-mono">
            <div class="marker-pulse-ring"></div>
            <div class="marker-center-dot"></div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
    };

    // Add markers for detections with valid coordinates
    detections.forEach((d) => {
      if (d.lat && d.lng) {
        const marker = L.marker([d.lat, d.lng], {
          icon: createMonochromeIcon(d.species)
        }).addTo(map);

        const thumbHtml = d.media_ref
          ? `<img src="${d.media_ref}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 4px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.2);" />`
          : '';

        const dosageHtml = (d.dosage_mg || d.dosage?.dosage_mg)
          ? `
            <div style="margin-top: 8px; padding: 6px 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px;">
              <div style="font-size: 10px; font-weight: 800; color: #fff; letter-spacing: 0.05em; display: flex; justify-content: space-between;">
                <span>🎯 DART DOSAGE:</span>
                <span>${d.dosage?.dosage_mg || d.dosage_mg} mg</span>
              </div>
              <div style="font-size: 9px; color: #aaa; margin-top: 2px;">
                ${((d.dosage?.drug_recommendation || d.drug_recommendation || '').split('+')[0] || '').trim()}
              </div>
              <div style="font-size: 8px; color: #ffb020; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 2px;">
                AI-estimated dosage — verify before administering
              </div>
            </div>
          `
          : '';

        const popupContent = `
          <div class="leaflet-popup-mono">
            ${thumbHtml}
            <h4>${d.species.toUpperCase()} (${Math.round(d.confidence * 100)}%)</h4>
            <div class="popup-loc-line">${d.location_name || 'Corbett Reserve'}</div>
            <div class="popup-coords">${d.lat}° N, ${d.lng}° E</div>
            ${dosageHtml}
            <div class="popup-meta" style="margin-top: 6px;">
              <span>Source: ${d.source_type?.toUpperCase()}</span> &bull; 
              <span>${d.uploader_name || 'Scout'}</span>
            </div>
            <div class="popup-status-pill ${d.status}">${d.status?.toUpperCase()}</div>
          </div>
        `;

        marker.bindPopup(popupContent);
      }
    });
  }, [adminTab, detections]);

  // Toggle user activation status
  const handleToggleDeactivate = async (userId, currentStatus) => {
    soundFx.playTapClick();
    try {
      const resp = await apiFetch(`/api/admin/users/${userId}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        soundFx.playLockAcquired();
        fetchAdminData();
      }
    } catch (err) {
      console.error('Failed to toggle user:', err);
    }
  };

  // Change user role
  const handleChangeRole = async (userId, newRole) => {
    soundFx.playTapClick();
    try {
      const resp = await apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        soundFx.playLockAcquired();
        fetchAdminData();
      }
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  // Delete detection record
  const handleDeleteDetection = async (detId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this sighting from the reserve repository?')) return;
    soundFx.playTapClick();
    try {
      const resp = await apiFetch(`/api/detections/${detId}`, { method: 'DELETE' });
      if (resp.ok) {
        soundFx.playLockAcquired();
        setDetections((prev) => prev.filter((d) => d.id !== detId));
      }
    } catch (err) {
      console.warn('Delete sighting error:', err);
    }
  };

  return (
    <div className="admin-dashboard-page">
      {/* Top Banner */}
      <div className="admin-header-banner">
        <div className="banner-left">
          <div className="icon-badge-mono">
            <Shield size={22} />
          </div>
          <div>
            <h2>FOREST OFFICER INTELLIGENCE COMMAND</h2>
            <p>Geospatial telemetry &bull; OpenStreetMap CartoDB dark tracking &bull; User access control</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="admin-tabs-bar">
          <button
            className={`admin-tab-btn ${adminTab === 'map' ? 'active' : ''}`}
            onClick={() => { soundFx.playTapClick(); setAdminTab('map'); }}
          >
            <MapIcon size={14} />
            <span>GEOSPATIAL MAP</span>
          </button>
          <button
            className={`admin-tab-btn ${adminTab === 'users' ? 'active' : ''}`}
            onClick={() => { soundFx.playTapClick(); setAdminTab('users'); }}
          >
            <Users size={14} />
            <span>USER DIRECTORY ({users.length})</span>
          </button>
          <button
            className={`admin-tab-btn ${adminTab === 'stats' ? 'active' : ''}`}
            onClick={() => { soundFx.playTapClick(); setAdminTab('stats'); }}
          >
            <BarChart3 size={14} />
            <span>RESERVE METRICS</span>
          </button>
          <button
            className={`admin-tab-btn ${adminTab === 'live_feed' ? 'active' : ''}`}
            onClick={() => { soundFx.playTapClick(); setAdminTab('live_feed'); }}
          >
            <Radio size={14} />
            <span>LIVE SENTRY FEED</span>
          </button>
          <button
            className={`admin-tab-btn ${adminTab === 'pipeline' ? 'active' : ''}`}
            onClick={() => { soundFx.playTapClick(); setAdminTab('pipeline'); }}
          >
            <Database size={14} />
            <span>PIPELINE DATA & FILTER</span>
          </button>
        </div>
      </div>

      {/* TAB: PIPELINE MODEL RESULTS & FALSE DETECTION MANAGER */}
      {adminTab === 'pipeline' && (
        <div style={{ marginBottom: 20 }}>
          <PipelineDataManager />
        </div>
      )}

      {/* TAB 0: LIVE SENTRY FEED VIEWER */}
      {adminTab === 'live_feed' && (
        <div style={{ marginBottom: 20 }}>
          <LiveFeedViewer title="FOREST OFFICER LIVE SENTRY STREAM" />
        </div>
      )}

      {/* TAB 1: GEOSPATIAL MAP */}
      {adminTab === 'map' && (
        <div className="admin-map-split-view">
          {/* Left Column: Leaflet OpenStreetMap */}
          <div className="map-view-column">
            <div className="map-column-header">
              <div className="map-title-row">
                <MapPin size={15} />
                <span>ACTIVE SIGHTING FIXES ({detections.filter(d => d.lat && d.lng).length} PLOTTED)</span>
              </div>
              <span className="carto-badge">CARTODB DARK MATTER TILES</span>
            </div>
            <div ref={mapContainerRef} className="leaflet-dark-container" />
          </div>

          {/* Right Column: Sighting Feed with Coordinates */}
          <div className="map-sidebar-column">
            <div className="sidebar-header">
              <h4>GEOLOCATED SIGHTINGS</h4>
              <span className="count-pill">{detections.length} LOGGED</span>
            </div>

            <div className="sidebar-items-scroll">
              {detections.map((det) => (
                <div
                  key={det.id}
                  className="sidebar-det-card"
                  onClick={() => {
                    if (mapInstanceRef.current && det.lat && det.lng) {
                      mapInstanceRef.current.flyTo([det.lat, det.lng], 14, { duration: 1.2 });
                      soundFx.playTapClick();
                    }
                  }}
                >
                  <div className="sidebar-det-thumb">
                    {det.media_ref ? (
                      <img src={det.media_ref} alt={det.species} />
                    ) : (
                      <div className="no-img">-</div>
                    )}
                  </div>
                  <div className="sidebar-det-info">
                    <div className="info-top">
                      <strong>{det.species.toUpperCase()}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="conf">{Math.round(det.confidence * 100)}%</span>
                        <button
                          type="button"
                          className="btn-card-delete-mini"
                          onClick={(e) => handleDeleteDetection(det.id, e)}
                          title="Delete sighting"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="info-loc">
                      <MapPin size={11} />
                      <span>{det.location_name || 'Corbett Reserve'}</span>
                    </div>
                    <div className="info-coords">{det.lat}° N, {det.lng}° E</div>
                    <div className="info-sub">
                      <span>{det.source_type?.toUpperCase()}</span> &bull; 
                      <span>{new Date(det.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER DIRECTORY & ACCESS CONTROL */}
      {adminTab === 'users' && (
        <div className="admin-content-card">
          <div className="card-header-bar">
            <div>
              <h3>RESERVE PERSONNEL & ACCESS CONTROL</h3>
              <p>Manage ranger, veterinarian, and admin accounts &bull; Modify roles and deactivate unauthorized users</p>
            </div>
          </div>

          <div className="table-responsive-wrapper">
            <table className="monochrome-table">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>EMAIL ADDRESS</th>
                  <th>CURRENT ROLE</th>
                  <th>CHANGE ROLE</th>
                  <th>ACCOUNT STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong className="user-name-cell">{u.name}</strong>
                    </td>
                    <td>
                      <span className="mono-email">{u.email}</span>
                    </td>
                    <td>
                      <span className="role-badge-mono">{u.role.toUpperCase()}</span>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                        className="role-select-mono"
                      >
                        <option value="user">Normal User (Scout)</option>
                        <option value="vet">Veterinarian</option>
                        <option value="admin">Forest Officer (Admin)</option>
                      </select>
                    </td>
                    <td>
                      <span className={`status-capsule ${u.is_active ? 'reviewed' : 'new'}`}>
                        {u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`btn-deactivate-mono ${!u.is_active ? 'btn-activate' : ''}`}
                        onClick={() => handleToggleDeactivate(u.id, u.is_active)}
                      >
                        {u.is_active ? (
                          <>
                            <UserX size={13} />
                            <span>DEACTIVATE</span>
                          </>
                        ) : (
                          <>
                            <UserCheck size={13} />
                            <span>ACTIVATE</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: RESERVE METRICS */}
      {adminTab === 'stats' && stats && (
        <div className="admin-content-card">
          <div className="card-header-bar">
            <div>
              <h3>CORBETT TIGER RESERVE TELEMETRY OVERVIEW</h3>
              <p>Aggregate counts across photo uploads, video sampling, and field surveillance</p>
            </div>
          </div>

          <div className="stats-kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">TOTAL SIGHTINGS LOGGED</span>
              <strong className="kpi-value">{stats.total_detections}</strong>
              <small className="kpi-sub">Across all 3 detection sources</small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">PENDING VET REVIEWS</span>
              <strong className="kpi-value">{stats.pending_reviews}</strong>
              <small className="kpi-sub">Awaiting clinical assessment</small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">REGISTERED FIELD AGENTS</span>
              <strong className="kpi-value">{stats.total_users}</strong>
              <small className="kpi-sub">Active scouts, vets & officers</small>
            </div>
          </div>

          {stats.species_breakdown && (
            <div className="breakdown-section">
              <h4>SPECIES SIGHTING DISTRIBUTION</h4>
              <div className="species-breakdown-grid">
                {Object.entries(stats.species_breakdown).map(([sp, count]) => (
                  <div key={sp} className="species-stat-card">
                    <span className="sp-name">{sp.toUpperCase()}</span>
                    <strong className="sp-count">{count}</strong>
                    <div className="sp-bar-track">
                      <div
                        className="sp-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(12, (count / (stats.total_detections || 1)) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

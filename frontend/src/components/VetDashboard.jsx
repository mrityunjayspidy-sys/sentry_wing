import React, { useState, useEffect, useCallback } from 'react';
import {
  Stethoscope,
  CheckCircle2,
  Clock,
  MapPin,
  Filter,
  Eye,
  FileEdit,
  X,
  Shield,
  Activity,
  User,
  Layers,
  Sparkles,
  Check,
  Search,
  Radio,
  Crosshair,
  AlertTriangle,
  Scale,
  Trash2
} from 'lucide-react';
import { soundFx } from '../utils/audio';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { LiveFeedViewer } from './LiveFeedViewer';

export const VetDashboard = () => {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('records'); // 'records' | 'live_feed'
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [speciesFilter, setSpeciesFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'new' | 'reviewed'
  const [searchTerm, setSearchTerm] = useState('');

  // Modal / Detail state
  const [selectedDet, setSelectedDet] = useState(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchDetections = useCallback(async () => {
    try {
      let url = '/api/detections?limit=200';
      if (speciesFilter !== 'ALL') url += `&species=${speciesFilter.toLowerCase()}`;
      if (statusFilter !== 'ALL') url += `&status=${statusFilter.toLowerCase()}`;

      const resp = await apiFetch(url);
      const data = await resp.json();
      if (data.events) {
        setDetections(data.events);
      }
    } catch (err) {
      console.warn('Vet detections fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [speciesFilter, statusFilter]);

  // Fast auto-refresh every 3s so new sightings immediately appear for the Doctor
  useEffect(() => {
    fetchDetections();
    const timer = setInterval(fetchDetections, 3000);
    return () => clearInterval(timer);
  }, [fetchDetections]);

  const handleOpenReview = (det, e) => {
    if (e) e.stopPropagation();
    soundFx.playTapClick();
    setSelectedDet(det);
    setReviewNote(det.review_note || '');
    setIsReviewModalOpen(true);
  };

  const handleDeleteDetection = async (detId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this wildlife sighting record from the reserve registry? This action cannot be undone.')) {
      return;
    }
    soundFx.playTapClick();
    try {
      const resp = await apiFetch(`/api/detections/${detId}`, { method: 'DELETE' });
      if (resp.ok) {
        soundFx.playLockAcquired();
        setDetections((prev) => prev.filter((d) => d.id !== detId));
        if (selectedDet && selectedDet.id === detId) {
          setIsReviewModalOpen(false);
          setSelectedDet(null);
        }
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(`Failed to delete record: ${err.detail || 'Server error'}`);
      }
    } catch (err) {
      console.warn('Error deleting detection:', err);
      alert('Network error while attempting to delete sighting.');
    }
  };

  const handleClearAllDetections = async () => {
    if (!window.confirm(`Clear all ${detections.length} sighting records from the reserve registry? This action cannot be undone.`)) {
      return;
    }
    soundFx.playTapClick();
    try {
      const resp = await apiFetch('/api/detections', { method: 'DELETE' });
      if (resp.ok) {
        soundFx.playLockAcquired();
        setDetections([]);
        setIsReviewModalOpen(false);
        setSelectedDet(null);
      } else {
        alert('Failed to clear sightings from repository.');
      }
    } catch (err) {
      console.warn('Error clearing detections:', err);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedDet) return;
    setSubmittingReview(true);
    soundFx.playTapClick();

    try {
      const resp = await apiFetch(`/api/detections/${selectedDet.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_note: reviewNote,
          reviewer_name: currentUser?.name || 'Dr. Rajiv Sen (Veterinarian)'
        })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        soundFx.playLockAcquired();
        setIsReviewModalOpen(false);
        fetchDetections();
      }
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const filteredDetections = detections.filter((d) => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (speciesFilter !== 'ALL' && d.species?.toUpperCase() !== speciesFilter) return false;
    if (!searchTerm) return true;
    return (
      d.species.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.location_name && d.location_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (d.uploader_name && d.uploader_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  const pendingCount = detections.filter((d) => d.status === 'new').length;
  const reviewedCount = detections.filter((d) => d.status === 'reviewed').length;

  return (
    <div className="vet-dashboard-page">
      {/* Top Banner */}
      <div className="vet-header-banner">
        <div className="banner-left">
          <div className="icon-badge-mono">
            <Stethoscope size={22} />
          </div>
          <div>
            <h2>VETERINARY CLINICAL SURVEILLANCE</h2>
            <p>Live wildlife sighting feed across all reserve sectors &bull; Clinical triaging and health annotation</p>
          </div>
        </div>

        <div className="banner-stats-group">
          <div className="banner-stat-box">
            <span>PENDING REVIEW</span>
            <strong>{pendingCount}</strong>
          </div>
          <div className="banner-stat-box">
            <span>REVIEWED</span>
            <strong>{reviewedCount}</strong>
          </div>
          <div className="banner-stat-box">
            <span>TOTAL MONITORED</span>
            <strong>{detections.length}</strong>
          </div>
          <div className="banner-stat-box" style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '14px' }}>
            <span style={{ color: '#ffffff', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Crosshair size={11} /> DOSAGE MODEL
            </span>
            <strong style={{ fontSize: '11px', letterSpacing: '0.04em', color: '#ffffff' }}>DART_DOSE_MODEL</strong>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="admin-tabs-bar" style={{ margin: '14px 0 16px 0' }}>
        <button
          className={`admin-tab-btn ${activeTab === 'records' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveTab('records'); }}
        >
          <Layers size={14} />
          <span>CLINICAL TRIAGE RECORDS ({detections.length})</span>
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'live_feed' ? 'active' : ''}`}
          onClick={() => { soundFx.playTapClick(); setActiveTab('live_feed'); }}
        >
          <Radio size={14} />
          <span>LIVE PATROL FEED VIEWER</span>
        </button>
      </div>

      {/* TAB 1: LIVE FEED VIEWER */}
      {activeTab === 'live_feed' && (
        <div style={{ marginBottom: 20 }}>
          <LiveFeedViewer title="VETERINARY LIVE PATROL STREAM" />
        </div>
      )}

      {/* TAB 2: CLINICAL RECORDS TABLE */}
      {activeTab === 'records' && (
        <>
          {/* Filter and Search Bar */}
          <div className="vet-controls-bar">
            <div className="search-wrap">
              <Search size={14} className="search-icon-inside" />
              <input
                type="text"
                placeholder="Search species, reserve location, scout..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="vet-search-input"
              />
            </div>

            <div className="filter-pill-group">
              <button
                className={`btn-filter-pill ${statusFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setStatusFilter('ALL')}
              >
                ALL STATUS ({detections.length})
              </button>
              <button
                className={`btn-filter-pill ${statusFilter === 'new' ? 'active' : ''}`}
                onClick={() => setStatusFilter('new')}
              >
                NEW ({pendingCount})
              </button>
              <button
                className={`btn-filter-pill ${statusFilter === 'reviewed' ? 'active' : ''}`}
                onClick={() => setStatusFilter('reviewed')}
              >
                REVIEWED ({reviewedCount})
              </button>
              {detections.length > 0 && (
                <button
                  type="button"
                  className="btn-clear-all-notifs"
                  onClick={handleClearAllDetections}
                  title="Clear all sightings from database"
                >
                  <Trash2 size={12} />
                  <span>CLEAR ALL</span>
                </button>
              )}
            </div>
          </div>

          {/* Detections List / Table */}
          <div className="vet-table-container">
            {loading ? (
              <div className="loading-state-box">
                <div className="mini-spinner" />
            <span>SYNCING WILDLIFE SURVEILLANCE FEED...</span>
          </div>
        ) : filteredDetections.length === 0 ? (
          <div className="empty-history-box">
            <CheckCircle2 size={36} />
            <h4>NO SIGHTINGS FOUND</h4>
            <p>No active wildlife events match the selected criteria.</p>
          </div>
        ) : (
          <table className="monochrome-table">
            <thead>
              <tr>
                <th>PREVIEW</th>
                <th>SPECIES</th>
                <th>CONFIDENCE</th>
                <th>EST. WEIGHT</th>
                <th>LOCATION & GEOLOCATION</th>
                <th>RECOMMENDED DART DOSAGE</th>
                <th>SOURCE</th>
                <th>REPORTER / SCOUT</th>
                <th>TIMESTAMP</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetections.map((det) => (
                <tr
                  key={det.id}
                  className={`table-row-interactive ${det.status === 'new' ? 'row-unread' : ''}`}
                  onClick={() => handleOpenReview(det)}
                >
                  <td>
                    {det.media_ref ? (
                      <img src={det.media_ref} alt={det.species} className="table-thumb" />
                    ) : (
                      <div className="table-thumb-empty">-</div>
                    )}
                  </td>
                  <td>
                    <strong className="species-cell-text">{det.species.toUpperCase()}</strong>
                  </td>
                  <td>
                    <span className="conf-pill">{Math.round(det.confidence * 100)}%</span>
                  </td>
                  <td>
                    <div className="weight-table-cell">
                      {det.attributes?.estimated_weight_kg ? (
                        <>
                          <span className="weight-badge-pill">
                            <Scale size={11} />
                            <strong>{det.attributes.estimated_weight_kg} kg</strong>
                          </span>
                          {det.attributes?.weight_range && (
                            <small className="species-weight-subtxt">{det.attributes.weight_range}</small>
                          )}
                        </>
                      ) : det.attributes?.weight_range ? (
                        <span className="weight-badge-pill">
                          <Scale size={11} />
                          <strong>{det.attributes.weight_range}</strong>
                        </span>
                      ) : (
                        <span className="text-muted-dash">—</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="loc-cell">
                      <span className="loc-name-txt">{det.location_name || 'Corbett Reserve'}</span>
                      <small className="loc-coords-txt">{det.lat}° N, {det.lng}° E</small>
                    </div>
                  </td>
                  <td>
                    {(det.dosage_mg || det.dosage?.dosage_mg) ? (
                      <div className="dosage-table-cell">
                        <span className="dosage-badge-pill">
                          <Crosshair size={11} />
                          <strong>{det.dosage?.dosage_mg || det.dosage_mg} mg</strong>
                        </span>
                        <small className="dosage-drug-subtxt">
                          {((det.dosage?.drug_recommendation || det.drug_recommendation || '').split('+')[0] || '').trim()}
                        </small>
                      </div>
                    ) : (
                      <span className="text-muted-dash">-</span>
                    )}
                  </td>
                  <td>
                    <span className="source-tag-mono">{det.source_type?.toUpperCase()}</span>
                  </td>
                  <td>
                    <span className="uploader-txt">{det.uploader_name || 'Scout'}</span>
                  </td>
                  <td>
                    <span className="time-txt">
                      {new Date(det.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <br />
                      <small>{new Date(det.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`status-capsule ${det.status === 'reviewed' ? 'reviewed' : 'new'}`}>
                      {det.status === 'reviewed' ? 'REVIEWED' : 'NEW'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        className="btn-table-inspect"
                        onClick={(e) => handleOpenReview(det, e)}
                      >
                        <FileEdit size={13} />
                        <span>{det.status === 'reviewed' ? 'VIEW / EDIT' : 'REVIEW'}</span>
                      </button>
                      <button
                        type="button"
                        className="btn-table-delete-mono"
                        onClick={(e) => handleDeleteDetection(det.id, e)}
                        title="Delete sighting record"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {/* Review & Biometrics Modal */}
      {isReviewModalOpen && selectedDet && (
        <div className="modal-backdrop" onClick={() => setIsReviewModalOpen(false)}>
          <div className="tactical-modal-box detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <Stethoscope size={18} />
                <h4>CLINICAL EXAMINATION: {selectedDet.species.toUpperCase()}</h4>
              </div>
              <button className="btn-icon-close" onClick={() => setIsReviewModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="detail-modal-body">
              <div className="detail-media-col">
                {selectedDet.media_ref ? (
                  <img
                    src={selectedDet.media_ref}
                    alt={selectedDet.species}
                    className="modal-full-thumb"
                  />
                ) : (
                  <div className="modal-no-thumb">NO IMAGE PREVIEW RECORDED</div>
                )}
                <div className="modal-meta-pills">
                  <span className="meta-pill">SOURCE: {selectedDet.source_type?.toUpperCase()}</span>
                  <span className="meta-pill">CONFIDENCE: {Math.round(selectedDet.confidence * 100)}%</span>
                  <span className={`meta-pill ${selectedDet.status}`}>STATUS: {selectedDet.status?.toUpperCase()}</span>
                </div>
              </div>

              <div className="detail-info-col">
                <div className="info-block">
                  <span className="info-label">EXACT GEOLOCATION & SECTOR</span>
                  <strong className="info-val">{selectedDet.location_name || 'Corbett Reserve'}</strong>
                  <span className="info-subval">GPS Coordinates: {selectedDet.lat}° N, {selectedDet.lng}° E</span>
                </div>

                <div className="info-block">
                  <span className="info-label">SCOUT & SIGHTING TIME</span>
                  <strong className="info-val">{selectedDet.uploader_name || 'Scout Ranger'}</strong>
                  <span className="info-subval">{new Date(selectedDet.timestamp).toLocaleString()}</span>
                </div>

                {selectedDet.attributes && (
                  <div className="info-block">
                    <span className="info-label">AUTOMATED STAGE 2 BIOMETRICS</span>
                    <div className="bio-modal-grid">
                      {selectedDet.attributes.vitality_status && (
                        <div className="bio-unit">
                          <span>VITALITY</span>
                          <strong>{selectedDet.attributes.vitality_status}</strong>
                        </div>
                      )}
                      {selectedDet.attributes.estimated_weight_kg && (
                        <div className="bio-unit">
                          <span>EST. WEIGHT</span>
                          <strong>{selectedDet.attributes.estimated_weight_kg} kg</strong>
                        </div>
                      )}
                      {selectedDet.attributes.behavior_posture && (
                        <div className="bio-unit">
                          <span>BEHAVIOR</span>
                          <strong>{selectedDet.attributes.behavior_posture}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Stage 3 Tranquilizer Dart Dosage Guidance */}
                {(selectedDet.dosage || selectedDet.drug_recommendation) && (() => {
                  const dos = selectedDet.dosage || {
                    drug_recommendation: selectedDet.drug_recommendation,
                    dosage_mg: selectedDet.dosage_mg,
                    dosage_per_kg: selectedDet.dosage_per_kg,
                    confidence: selectedDet.dosage_confidence,
                    notes: selectedDet.dosage_notes,
                    disclaimer: "AI-estimated dosage — verify before administering"
                  };
                  return (
                    <div className="info-block dosage-highlight-block">
                      <div className="dosage-header-row">
                        <div className="dosage-title-wrap">
                          <Crosshair size={15} className="dosage-accent-icon" />
                          <span className="info-label dosage-accent-label">RECOMMENDED DART DOSAGE (STAGE 3 AI GUIDANCE)</span>
                        </div>
                        {dos.confidence !== undefined && (
                          <span className="dosage-conf-pill">{Math.round((dos.confidence || 0.9) * 100)}% AI CONFIDENCE</span>
                        )}
                      </div>

                      <div className="dosage-drug-card">
                        <div className="dosage-drug-name-row">
                          <span className="drug-label-prefix">PRIMARY FORMULARY:</span>
                          <strong className="drug-name-txt">{dos.drug_recommendation || 'Standard Wildlife Immobilization'}</strong>
                        </div>

                        <div className="dosage-metrics-grid">
                          <div className="dosage-metric-item">
                            <span className="metric-k">TOTAL DART MASS</span>
                            <strong className="metric-v highlight">{dos.dosage_mg !== undefined ? `${dos.dosage_mg} mg` : 'Calculated in field'}</strong>
                          </div>
                          <div className="dosage-metric-item">
                            <span className="metric-k">UNIT DOSING</span>
                            <strong className="metric-v">{dos.dosage_per_kg !== undefined ? `${dos.dosage_per_kg} mg/kg` : 'Protocol standard'}</strong>
                          </div>
                          <div className="dosage-metric-item">
                            <span className="metric-k">CALCULATED FOR</span>
                            <strong className="metric-v">{selectedDet.attributes?.estimated_weight_kg ? `${selectedDet.attributes.estimated_weight_kg} kg est.` : 'Species baseline'}</strong>
                          </div>
                        </div>

                        {dos.notes && (
                          <div className="dosage-notes-row">
                            <span className="notes-heading">CLINICAL & REVERSAL PROTOCOL:</span>
                            <p className="notes-body-txt">{dos.notes}</p>
                          </div>
                        )}

                        {/* Persistent disclaimer banner */}
                        <div className="dosage-disclaimer-banner">
                          <AlertTriangle size={13} className="disclaimer-alert-icon" />
                          <span>{dos.disclaimer || "AI-estimated dosage — verify before administering"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="info-block">
                  <span className="info-label">VETERINARIAN CLINICAL OBSERVATION NOTES</span>
                  <textarea
                    rows={4}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="Enter veterinary triage notes (e.g. Normal gait, healthy plumage, no visible lacerations, monitor waterhole sector)..."
                    className="vet-textarea"
                  />
                </div>
              </div>
            </div>

            <div className="modal-actions-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-delete-record"
                onClick={() => handleDeleteDetection(selectedDet.id)}
                title="Delete this sighting record from the database"
              >
                <Trash2 size={13} />
                <span>DELETE SIGHTING</span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setIsReviewModalOpen(false)}
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  className="btn-primary-action"
                  disabled={submittingReview}
                  onClick={handleSubmitReview}
                >
                  {submittingReview ? 'SUBMITTING NOTE...' : 'CONFIRM & MARK AS REVIEWED'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VetDashboard;

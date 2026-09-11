import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  CheckCircle2,
  AlertOctagon,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  Eye,
  SlidersHorizontal,
  Sparkles,
  ShieldAlert,
  Layers,
  Activity,
  Check,
  X
} from 'lucide-react';
import { soundFx } from '../utils/audio';
import { apiFetch } from '../utils/api';

export const PipelineDataManager = () => {
  const [viewMode, setViewMode] = useState('valid'); // 'valid' | 'false'
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [speciesFilter, setSpeciesFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeSuccessMsg, setPurgeSuccessMsg] = useState('');

  const fetchPipelineData = useCallback(async () => {
    try {
      const isValidParam = viewMode === 'valid' ? 'true' : 'false';
      let url = `/api/pipeline/model-results?is_valid=${isValidParam}&limit=150`;
      if (speciesFilter !== 'ALL') {
        url += `&species=${speciesFilter.toLowerCase()}`;
      }

      const [resResp, statsResp] = await Promise.all([
        apiFetch(url),
        apiFetch('/api/pipeline/model-results/stats')
      ]);

      const resData = await resResp.json();
      const statsData = await statsResp.json();

      if (resData.results) {
        setResults(resData.results);
      }
      if (statsData.stats) {
        setStats(statsData.stats);
      }
    } catch (err) {
      console.warn('Failed to fetch pipeline model results:', err);
    } finally {
      setLoading(false);
    }
  }, [viewMode, speciesFilter]);

  useEffect(() => {
    fetchPipelineData();
    const interval = setInterval(fetchPipelineData, 4000);
    return () => clearInterval(interval);
  }, [fetchPipelineData]);

  const handlePurgeUnwanted = async () => {
    if (!window.confirm('Purge all false detections and unwanted clutter from the database? This keeps model storage clean and lightweight.')) {
      return;
    }
    soundFx.playTapClick();
    setIsPurging(true);
    try {
      const resp = await apiFetch('/api/pipeline/model-results/unwanted?purge_all_invalid=true', {
        method: 'DELETE'
      });
      const data = await resp.json();
      if (data.status === 'success') {
        soundFx.playLockAcquired();
        setPurgeSuccessMsg(`Successfully purged ${data.purged_count} unwanted detections!`);
        setTimeout(() => setPurgeSuccessMsg(''), 4000);
        fetchPipelineData();
      }
    } catch (err) {
      console.error('Purge error:', err);
    } finally {
      setIsPurging(false);
    }
  };

  const handleFlagFalse = async (recordId) => {
    soundFx.playTapClick();
    try {
      const resp = await apiFetch(`/api/pipeline/model-results/${recordId}/flag-false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'MANUALLY_FLAGGED_BY_OFFICER' })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        soundFx.playLockAcquired();
        fetchPipelineData();
        if (selectedRecord && selectedRecord.id === recordId) {
          setSelectedRecord(null);
        }
      }
    } catch (err) {
      console.error('Flag false error:', err);
    }
  };

  const filteredResults = results.filter((item) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.species?.toLowerCase().includes(term) ||
      item.id?.toLowerCase().includes(term) ||
      item.filter_reason?.toLowerCase().includes(term) ||
      item.location_name?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="pipeline-data-manager" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top Banner & Telemetry Cards */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: 'rgba(0, 255, 136, 0.12)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#00ff88'
            }}>
              <Database size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, letterSpacing: '0.08em', color: '#fff' }}>
                MODEL PIPELINE DATABASE & FALSE DETECTION FILTER
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>
                Dedicated SQLite schema for pipeline models &bull; Auto-sanitized bounding boxes &bull; Anomaly rejection engine
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handlePurgeUnwanted}
              disabled={isPurging || (stats?.false_detection_count === 0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 6,
                background: 'rgba(255, 75, 75, 0.15)',
                border: '1px solid rgba(255, 75, 75, 0.35)',
                color: '#ff6b6b',
                fontSize: 12,
                fontWeight: 600,
                cursor: (isPurging || stats?.false_detection_count === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: (stats?.false_detection_count === 0) ? 0.5 : 1
              }}
              title="Remove false detections and unwanted clutter to save disk storage"
            >
              <Trash2 size={14} />
              <span>PURGE FALSE DETECTIONS ({stats?.false_detection_count || 0})</span>
            </button>

            <button
              onClick={() => { soundFx.playTapClick(); fetchPipelineData(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>

        {purgeSuccessMsg && (
          <div style={{
            background: 'rgba(0, 255, 136, 0.1)',
            border: '1px solid rgba(0, 255, 136, 0.3)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 12,
            color: '#00ff88',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <Check size={14} />
            <span>{purgeSuccessMsg}</span>
          </div>
        )}

        {/* Telemetry Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12
        }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 6,
            padding: '12px 14px'
          }}>
            <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', letterSpacing: '0.05em' }}>TOTAL INGESTED</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {stats?.total_results || 0}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)' }}>Model detections processed</span>
          </div>

          <div style={{
            background: 'rgba(0, 255, 136, 0.05)',
            border: '1px solid rgba(0, 255, 136, 0.2)',
            borderRadius: 6,
            padding: '12px 14px'
          }}>
            <span style={{ fontSize: 11, color: '#00ff88', letterSpacing: '0.05em' }}>VALID PIPELINE RECORDS</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#00ff88', marginTop: 4 }}>
              {stats?.valid_count || 0}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(0, 255, 136, 0.7)' }}>
              {stats?.valid_rate_percent || 100}% Clean Pass Rate
            </span>
          </div>

          <div style={{
            background: 'rgba(255, 107, 107, 0.05)',
            border: '1px solid rgba(255, 107, 107, 0.2)',
            borderRadius: 6,
            padding: '12px 14px'
          }}>
            <span style={{ fontSize: 11, color: '#ff6b6b', letterSpacing: '0.05em' }}>INTERCEPTED FALSE DETECTIONS</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#ff6b6b', marginTop: 4 }}>
              {stats?.false_detection_count || 0}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255, 107, 107, 0.7)' }}>
              Filtered &amp; isolated from pipeline
            </span>
          </div>

          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 6,
            padding: '12px 14px'
          }}>
            <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', letterSpacing: '0.05em' }}>PRIMARY REJECTION REASONS</span>
            <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.8)', marginTop: 6 }}>
              {stats?.rejection_reasons && Object.keys(stats.rejection_reasons).length > 0 ? (
                Object.entries(stats.rejection_reasons).slice(0, 2).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ color: '#ffaa00' }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))
              ) : (
                <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>No active false detections</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and View Toggle Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12
      }}>
        {/* Toggle Pills */}
        <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 6, padding: 3 }}>
          <button
            onClick={() => { soundFx.playTapClick(); setViewMode('valid'); }}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: 'none',
              background: viewMode === 'valid' ? 'rgba(0, 255, 136, 0.2)' : 'transparent',
              color: viewMode === 'valid' ? '#00ff88' : 'rgba(255, 255, 255, 0.6)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <CheckCircle2 size={13} />
            <span>CLEAN PIPELINE DATA ({stats?.valid_count || 0})</span>
          </button>

          <button
            onClick={() => { soundFx.playTapClick(); setViewMode('false'); }}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: 'none',
              background: viewMode === 'false' ? 'rgba(255, 107, 107, 0.2)' : 'transparent',
              color: viewMode === 'false' ? '#ff6b6b' : 'rgba(255, 255, 255, 0.6)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <AlertOctagon size={13} />
            <span>INTERCEPTED FALSE DETECTIONS ({stats?.false_detection_count || 0})</span>
          </button>
        </div>

        {/* Species & Search Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <Filter size={13} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
            <select
              value={speciesFilter}
              onChange={(e) => setSpeciesFilter(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="ALL" style={{ background: '#181818' }}>ALL SPECIES</option>
              <option value="TIGER" style={{ background: '#181818' }}>TIGER</option>
              <option value="LEOPARD" style={{ background: '#181818' }}>LEOPARD</option>
              <option value="ELEPHANT" style={{ background: '#181818' }}>ELEPHANT</option>
              <option value="LION" style={{ background: '#181818' }}>LION</option>
              <option value="BEAR" style={{ background: '#181818' }}>BEAR</option>
              <option value="CHEETAH" style={{ background: '#181818' }}>CHEETAH</option>
              <option value="FOX" style={{ background: '#181818' }}>FOX</option>
              <option value="HYENA" style={{ background: '#181818' }}>HYENA</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <Search size={13} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
            <input
              type="text"
              placeholder="Search ID, reason, trail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
                width: 170
              }}
            />
          </div>
        </div>
      </div>

      {/* Results List */}
      {filteredResults.length === 0 ? (
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px dashed rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          padding: '40px 20px',
          textAlign: 'center',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: 13
        }}>
          {viewMode === 'valid'
            ? 'No valid pipeline model results found matching current criteria.'
            : 'Zero false detections currently logged. Database is 100% clean!'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 12
        }}>
          {filteredResults.map((item) => {
            const isItemValid = item.is_valid === 1;
            return (
              <div
                key={item.id}
                onClick={() => { soundFx.playTapClick(); setSelectedRecord(item); }}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: isItemValid
                    ? '1px solid rgba(0, 255, 136, 0.2)'
                    : '1px solid rgba(255, 107, 107, 0.25)',
                  borderRadius: 6,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease, border-color 0.15s ease'
                }}
              >
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: 14, color: '#fff', letterSpacing: '0.04em' }}>
                        {item.species?.toUpperCase()}
                      </strong>
                      <span style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: 'rgba(255, 255, 255, 0.7)'
                      }}>
                        {Math.round(item.confidence * 100)}% Conf
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'monospace' }}>
                      {item.id}
                    </span>
                  </div>

                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: isItemValid ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 107, 107, 0.18)',
                    color: isItemValid ? '#00ff88' : '#ff6b6b',
                    border: isItemValid ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid rgba(255, 107, 107, 0.35)'
                  }}>
                    {item.filter_reason || (isItemValid ? 'PASSED' : 'REJECTED')}
                  </span>
                </div>

                {/* Content preview */}
                <div style={{ display: 'flex', gap: 10 }}>
                  {item.media_ref ? (
                    <img
                      src={item.media_ref}
                      alt="detection crop"
                      style={{
                        width: 60,
                        height: 60,
                        objectFit: 'cover',
                        borderRadius: 4,
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        flexShrink: 0
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 60,
                      height: 60,
                      borderRadius: 4,
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255, 255, 255, 0.3)',
                      fontSize: 10,
                      flexShrink: 0
                    }}>
                      NO CROP
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.7)', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
                    <div>
                      <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>BBox: </span>
                      <span style={{ fontFamily: 'monospace' }}>
                        [{item.bbox_x1}, {item.bbox_y1}, {item.bbox_x2}, {item.bbox_y2}]
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Attributes: </span>
                      <span>{item.age || 'adult'} &bull; {item.sex || 'unknown'} &bull; {item.body_size || 'medium'}</span>
                    </div>
                    <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Loc: </span>
                      <span>{item.location_name}</span>
                    </div>
                  </div>
                </div>

                {/* Footer timestamp & quick action */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 6,
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: 11,
                  color: 'rgba(255, 255, 255, 0.4)'
                }}>
                  <span>{new Date(item.timestamp).toLocaleTimeString()} &bull; {item.source_type}</span>
                  {isItemValid && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFlagFalse(item.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ffaa00',
                        cursor: 'pointer',
                        fontSize: 10,
                        textDecoration: 'underline'
                      }}
                    >
                      Flag as False
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record Inspection Modal */}
      {selectedRecord && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#141414',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 8,
            width: '90%',
            maxWidth: 540,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: '85vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>
                  MODEL RESULT DETAILS ({selectedRecord.species?.toUpperCase()})
                </h3>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: selectedRecord.is_valid ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 107, 107, 0.2)',
                  color: selectedRecord.is_valid ? '#00ff88' : '#ff6b6b'
                }}>
                  {selectedRecord.filter_reason}
                </span>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {selectedRecord.media_ref && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={selectedRecord.media_ref}
                  alt="Detection Crop"
                  style={{
                    maxHeight: 180,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  }}
                />
              </div>
            )}

            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12
            }}>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Record ID:</strong> {selectedRecord.id}</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Confidence:</strong> {Math.round(selectedRecord.confidence * 100)}%</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Normalized BBox:</strong> [{selectedRecord.bbox_x1}, {selectedRecord.bbox_y1}, {selectedRecord.bbox_x2}, {selectedRecord.bbox_y2}]</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Area / Aspect:</strong> {selectedRecord.bbox_area} / {selectedRecord.aspect_ratio}</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Age &amp; Sex:</strong> {selectedRecord.age} ({selectedRecord.sex})</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Size &amp; Weight:</strong> {selectedRecord.body_size} ({selectedRecord.weight_range})</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Location:</strong> {selectedRecord.location_name} ({selectedRecord.lat}° N, {selectedRecord.lng}° E)</div>
              <div><strong style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Model:</strong> {selectedRecord.model_version}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {selectedRecord.is_valid === 1 && (
                <button
                  onClick={() => handleFlagFalse(selectedRecord.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    background: 'rgba(255, 170, 0, 0.15)',
                    border: '1px solid rgba(255, 170, 0, 0.4)',
                    color: '#ffaa00',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Flag as False Detection
                </button>
              )}
              <button
                onClick={() => setSelectedRecord(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

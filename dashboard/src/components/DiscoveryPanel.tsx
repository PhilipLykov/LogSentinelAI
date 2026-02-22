import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchDiscoveryConfig,
  updateDiscoveryConfig,
  fetchDiscoverySuggestions,
  acceptDiscoverySuggestion,
  mergeDiscoverySuggestion,
  dismissDiscoverySuggestion,
  fetchSystems,
  type DiscoveryConfig,
  type DiscoverySuggestion,
  type MonitoredSystem,
} from '../api';

interface DiscoveryPanelProps {
  onAuthError: () => void;
  onNavigateToSystem?: (systemId: string) => void;
}

export function DiscoveryPanel({ onAuthError, onNavigateToSystem }: DiscoveryPanelProps) {
  const [config, setConfig] = useState<DiscoveryConfig | null>(null);
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [systems, setSystems] = useState<MonitoredSystem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedSamples, setExpandedSamples] = useState<Set<string>>(new Set());
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [ignoreText, setIgnoreText] = useState('');
  const [acceptedSystem, setAcceptedSystem] = useState<{ id: string; name: string } | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await fetchDiscoveryConfig();
      setConfig(cfg);
      setIgnoreText((cfg.ignore_patterns ?? []).join('\n'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError('Failed to load discovery config.');
    }
  }, [onAuthError]);

  const loadSuggestions = useCallback(async () => {
    try {
      const data = await fetchDiscoverySuggestions(statusFilter);
      setSuggestions(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError('Failed to load suggestions.');
    }
  }, [statusFilter, onAuthError]);

  const loadSystems = useCallback(async () => {
    try {
      const data = await fetchSystems();
      setSystems(data);
    } catch { /* ignore */ }
  }, []);

  const isInitialMount = useRef(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadConfig(), loadSuggestions(), loadSystems()])
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    loadSuggestions();
  }, [loadSuggestions]);

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    setSuccess('');
    setAcceptedSystem(null);
    try {
      const patterns = ignoreText
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      const updated = await updateDiscoveryConfig({ ...config, ignore_patterns: patterns });
      setConfig(updated);
      setSuccess('Configuration saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to save config.');
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async (s: DiscoverySuggestion) => {
    setError('');
    setAcceptedSystem(null);
    try {
      const name = editingNames[s.id] || s.suggested_name;
      const result = await acceptDiscoverySuggestion(s.id, { name, replay_events: false });
      setAcceptedSystem({ id: result.system_id, name: result.name });
      setSuccess(`System "${result.name}" created successfully.`);
      await loadSuggestions();
      await loadSystems();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to accept suggestion.');
    }
  };

  const handleMerge = async (s: DiscoverySuggestion) => {
    const targetId = mergeTargets[s.id];
    if (!targetId) { setError('Select a system to merge into.'); return; }
    setError('');
    try {
      const result = await mergeDiscoverySuggestion(s.id, targetId);
      setSuccess(`Merged into "${result.name}".`);
      setTimeout(() => setSuccess(''), 3000);
      await loadSuggestions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to merge suggestion.');
    }
  };

  const handleDismiss = async (s: DiscoverySuggestion, duration: '24h' | '7d' | 'forever') => {
    setError('');
    try {
      await dismissDiscoverySuggestion(s.id, duration);
      await loadSuggestions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to dismiss suggestion.');
    }
  };

  const toggleSamples = (id: string) => {
    setExpandedSamples(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading discovery settings...</div>;

  const splitByProgram = config?.split_by_program ?? false;

  return (
    <div className="discovery-panel">
      {error && (
        <div className="error-msg" role="alert">
          {error}
          <button className="error-dismiss" onClick={() => setError('')}>&times;</button>
        </div>
      )}
      {success && (
        <div className="success-msg" role="status">
          {success}
          {acceptedSystem && onNavigateToSystem && (
            <button
              className="btn btn-sm"
              style={{ marginLeft: '12px' }}
              onClick={() => {
                onNavigateToSystem(acceptedSystem.id);
                setAcceptedSystem(null);
                setSuccess('');
              }}
            >
              Configure System
            </button>
          )}
        </div>
      )}

      {/* ── Configuration ── */}
      <div className="discovery-config-section">
        <h3>Auto-Discovery Configuration</h3>
        {config && (
          <div className="discovery-config-grid">
            <div className="discovery-config-col">
              <label className="discovery-toggle">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={e => setConfig({ ...config, enabled: e.target.checked })}
                />
                <span className="discovery-toggle-label">Enable Auto-Discovery</span>
              </label>
              <label className="discovery-toggle">
                <input
                  type="checkbox"
                  checked={config.group_by_host}
                  onChange={e => setConfig({ ...config, group_by_host: e.target.checked })}
                  disabled={!config.enabled}
                />
                Group by hostname
              </label>
              <label className="discovery-toggle">
                <input
                  type="checkbox"
                  checked={config.group_by_ip}
                  onChange={e => setConfig({ ...config, group_by_ip: e.target.checked })}
                  disabled={!config.enabled}
                />
                Group by source IP
              </label>
              <label className="discovery-toggle">
                <input
                  type="checkbox"
                  checked={config.split_by_program}
                  onChange={e => setConfig({ ...config, split_by_program: e.target.checked })}
                  disabled={!config.enabled}
                />
                Split by program
              </label>
              <label className="discovery-toggle">
                <input
                  type="checkbox"
                  checked={config.auto_accept}
                  onChange={e => setConfig({ ...config, auto_accept: e.target.checked })}
                  disabled={!config.enabled}
                />
                Auto-accept suggestions
                {config.auto_accept && (
                  <span className="discovery-auto-accept-warn">(creates systems automatically)</span>
                )}
              </label>
            </div>
            <div className="discovery-config-col">
              <div className="form-group">
                <label>Min events threshold</label>
                <input
                  className="input-short"
                  type="number"
                  min={1}
                  value={config.min_events_threshold}
                  onChange={e => setConfig({ ...config, min_events_threshold: Number(e.target.value) || 1 })}
                  disabled={!config.enabled}
                />
              </div>
              <div className="form-group">
                <label>Min rate per hour</label>
                <input
                  className="input-short"
                  type="number"
                  min={0}
                  value={config.min_rate_per_hour}
                  onChange={e => setConfig({ ...config, min_rate_per_hour: Number(e.target.value) || 0 })}
                  disabled={!config.enabled}
                />
              </div>
              <div className="form-group">
                <label>Buffer TTL (hours)</label>
                <input
                  className="input-short"
                  type="number"
                  min={1}
                  value={config.buffer_ttl_hours}
                  onChange={e => setConfig({ ...config, buffer_ttl_hours: Number(e.target.value) || 1 })}
                  disabled={!config.enabled}
                />
              </div>
            </div>
            <div className="discovery-config-full">
              <div className="form-group">
                <label>Ignore patterns (one regex per line)</label>
                <textarea
                  rows={3}
                  value={ignoreText}
                  onChange={e => setIgnoreText(e.target.value)}
                  disabled={!config.enabled}
                  className="discovery-ignore-textarea"
                  placeholder={'^scanner-.*\n10\\.0\\.0\\.1'}
                />
              </div>
              <button className="btn" onClick={handleSaveConfig} disabled={saving}>
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Suggestions ── */}
      <div className="discovery-suggestions-section">
        <div className="discovery-suggestions-header">
          <h3>Discovered Sources</h3>
          <div className="discovery-status-filters">
            {['pending', 'accepted', 'dismissed', 'all'].map(st => (
              <button
                key={st}
                className={`btn btn-sm${statusFilter === st ? '' : ' btn-outline'}`}
                onClick={() => setStatusFilter(st)}
              >
                {st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-outline" onClick={loadSuggestions}>Refresh</button>
        </div>

        {suggestions.length === 0 ? (
          <div className="discovery-empty">
            {statusFilter === 'pending'
              ? 'No pending suggestions. Unmatched events will appear here after the grouping engine runs.'
              : `No ${statusFilter} suggestions.`}
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="data-table discovery-table">
                <thead>
                  <tr>
                    <th>Suggested Name</th>
                    <th>Host / IP</th>
                    <th>{splitByProgram ? 'Programs' : 'Programs (observed)'}</th>
                    <th>Events</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map(s => (
                    <tr key={s.id}>
                      <td>
                        {statusFilter === 'pending' ? (
                          <input
                            type="text"
                            className="discovery-name-input"
                            value={editingNames[s.id] ?? s.suggested_name}
                            onChange={e => setEditingNames(prev => ({ ...prev, [s.id]: e.target.value }))}
                          />
                        ) : (
                          <span>{s.suggested_name}</span>
                        )}
                      </td>
                      <td>
                        {s.host_pattern && <span title="Hostname">{s.host_pattern}</span>}
                        {s.host_pattern && s.ip_pattern && ' / '}
                        {s.ip_pattern && <span className="discovery-ip" title="Source IP">{s.ip_pattern}</span>}
                      </td>
                      <td className="discovery-programs-cell">
                        {(s.program_patterns ?? []).length > 0 ? (
                          <span className={splitByProgram ? '' : 'discovery-programs-info'}>
                            {(s.program_patterns ?? []).join(', ')}
                            {!splitByProgram && (
                              <span className="discovery-programs-hint">observed on this host</span>
                            )}
                          </span>
                        ) : '\u2014'}
                      </td>
                      <td>
                        {s.event_count}
                        {s.sample_messages?.length > 0 && (
                          <button
                            className="btn btn-sm btn-outline discovery-samples-btn"
                            onClick={() => toggleSamples(s.id)}
                          >
                            {expandedSamples.has(s.id) ? 'Hide' : 'Samples'}
                          </button>
                        )}
                      </td>
                      <td className="discovery-date-cell">
                        {s.first_seen_at ? new Date(s.first_seen_at).toLocaleString() : '\u2014'}
                      </td>
                      <td className="discovery-date-cell">
                        {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : '\u2014'}
                      </td>
                      <td>
                        {s.status === 'pending' && (
                          <div className="discovery-actions">
                            <button className="btn btn-sm" onClick={() => handleAccept(s)}>Accept</button>
                            <select
                              className="discovery-merge-select"
                              value={mergeTargets[s.id] ?? ''}
                              onChange={e => setMergeTargets(prev => ({ ...prev, [s.id]: e.target.value }))}
                            >
                              <option value="">Merge into...</option>
                              {systems.map(sys => (
                                <option key={sys.id} value={sys.id}>{sys.name}</option>
                              ))}
                            </select>
                            {mergeTargets[s.id] && (
                              <button className="btn btn-sm btn-outline" onClick={() => handleMerge(s)}>Merge</button>
                            )}
                            <select
                              className="discovery-dismiss-select"
                              onChange={e => { if (e.target.value) handleDismiss(s, e.target.value as '24h' | '7d' | 'forever'); e.target.value = ''; }}
                              defaultValue=""
                            >
                              <option value="" disabled>Dismiss...</option>
                              <option value="24h">24 hours</option>
                              <option value="7d">7 days</option>
                              <option value="forever">Forever</option>
                            </select>
                          </div>
                        )}
                        {s.status === 'accepted' && <span className="badge badge-success">Accepted</span>}
                        {s.status === 'dismissed' && <span className="badge badge-muted">Dismissed</span>}
                        {s.status === 'merged' && <span className="badge badge-info">Merged</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {suggestions.map(s => expandedSamples.has(s.id) && s.sample_messages?.length > 0 && (
              <div key={`samples-${s.id}`} className="discovery-samples-panel">
                <strong>{s.suggested_name} &mdash; Sample Messages:</strong>
                {s.sample_messages.map((msg, i) => (
                  <pre key={i} className="discovery-sample-msg">{msg}</pre>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

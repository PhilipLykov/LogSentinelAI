import { useState, useEffect, useCallback } from 'react';
import {
  type AuditLogEntry,
  type AuditLogResponse,
  fetchAuditLog,
  fetchAuditLogActions,
  getAuditExportUrl,
  getStoredApiKey,
} from '../api';

interface Props {
  onAuthError: () => void;
}

export function AuditLogSection({ onAuthError }: Props) {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Filter options
  const [actions, setActions] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchAuditLog({
        page,
        limit,
        action: actionFilter || undefined,
        resource_type: resourceFilter || undefined,
        search: searchTerm || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) onAuthError();
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, limit, actionFilter, resourceFilter, searchTerm, fromDate, toDate, onAuthError]);

  const loadFilters = useCallback(async () => {
    try {
      const result = await fetchAuditLogActions();
      setActions(result.actions);
      setResourceTypes(result.resource_types);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { load(); }, [load]);

  const fmtDate = (d: string) => {
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const handleExport = (format: 'csv' | 'json') => {
    const url = getAuditExportUrl({
      format,
      from: fromDate || undefined,
      to: toDate || undefined,
    });
    // Open in new tab with auth header workaround (download via fetch + blob)
    const token = getStoredApiKey();
    fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit_log.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => setError('Export failed.'));
  };

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>Audit Log</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-sm btn-outline" onClick={() => handleExport('csv')}>Export CSV</button>
          <button className="btn btn-sm btn-outline" onClick={() => handleExport('json')}>Export JSON</button>
        </div>
      </div>

      {error && <div className="error-msg" role="alert">{error}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <label style={{ fontSize: '0.75em', display: 'block', marginBottom: '2px' }}>Search</label>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            style={{ width: '180px' }}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.75em', display: 'block', marginBottom: '2px' }}>Action</label>
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
            <option value="">All Actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.75em', display: 'block', marginBottom: '2px' }}>Resource</label>
          <select value={resourceFilter} onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }}>
            <option value="">All Resources</option>
            {resourceTypes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.75em', display: 'block', marginBottom: '2px' }}>From</label>
          <input type="datetime-local" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label style={{ fontSize: '0.75em', display: 'block', marginBottom: '2px' }}>To</label>
          <input type="datetime-local" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
        </div>
        <button className="btn btn-xs btn-outline" onClick={() => {
          setSearchTerm('');
          setActionFilter('');
          setResourceFilter('');
          setFromDate('');
          setToDate('');
          setPage(1);
        }}>
          Clear
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /> Loading audit log…</div>
      ) : data ? (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Actor</th>
                  <th>IP</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry: AuditLogEntry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.85em' }}>{fmtDate(entry.at)}</td>
                    <td>
                      <span className={`badge ${
                        entry.action.includes('fail') ? 'badge-danger' :
                        entry.action.includes('delete') || entry.action.includes('revoke') || entry.action.includes('purge') ? 'badge-warning' :
                        entry.action.includes('create') || entry.action.includes('login') ? 'badge-success' :
                        'badge-info'
                      }`}>
                        {entry.action}
                      </span>
                    </td>
                    <td>{entry.resource_type}{entry.resource_id ? ` (${entry.resource_id.slice(0, 8)}…)` : ''}</td>
                    <td>{entry.actor ?? entry.user_id?.slice(0, 8) ?? '—'}</td>
                    <td style={{ fontSize: '0.85em' }}>{entry.ip ?? '—'}</td>
                    <td>
                      {entry.details ? (
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        >
                          {expandedId === entry.id ? 'Hide' : 'Show'}
                        </button>
                      ) : '—'}
                      {expandedId === entry.id && entry.details && (
                        <pre style={{ fontSize: '0.75em', marginTop: '0.5rem', maxWidth: '400px', overflow: 'auto', background: 'var(--bg)', padding: '0.5rem', borderRadius: '4px' }}>
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No audit log entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--muted)' }}>
              Page {data.page} of {data.total_pages} ({data.total} total entries)
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-xs btn-outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                className="btn btn-xs btn-outline"
                disabled={page >= (data.total_pages || 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

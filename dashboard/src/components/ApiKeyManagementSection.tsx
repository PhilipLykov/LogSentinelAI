import { useState, useEffect, useCallback } from 'react';
import {
  type ApiKeyInfo,
  type CreateApiKeyResponse,
  fetchApiKeys,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} from '../api';

const SCOPES = [
  { value: 'admin', label: 'Admin (full access)' },
  { value: 'ingest', label: 'Ingest (event ingestion only)' },
  { value: 'read', label: 'Read (dashboard + events read-only)' },
  { value: 'dashboard', label: 'Dashboard (dashboard read-only)' },
];

interface Props {
  onAuthError: () => void;
}

export function ApiKeyManagementSection({ onAuthError }: Props) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState('ingest');
  const [newDescription, setNewDescription] = useState('');
  const [newExpires, setNewExpires] = useState('');
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApiKeys();
      setKeys(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) onAuthError();
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setCreating(true);
    try {
      const result = await createApiKey({
        name: newName.trim(),
        scope: newScope,
        description: newDescription.trim() || undefined,
        expires_at: newExpires || undefined,
      });
      setCreatedKey(result);
      setShowCreate(false);
      setNewName('');
      setNewScope('ingest');
      setNewDescription('');
      setNewExpires('');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKeyInfo) => {
    if (!confirm(`Revoke API key "${key.name}"? This cannot be undone.`)) return;
    setError('');
    setSuccess('');
    try {
      await revokeApiKey(key.id);
      setSuccess(`API key "${key.name}" revoked.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleActive = async (key: ApiKeyInfo) => {
    setError('');
    setSuccess('');
    try {
      await updateApiKey(key.id, { is_active: !key.is_active });
      setSuccess(`API key "${key.name}" ${key.is_active ? 'disabled' : 'enabled'}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading API keys…</div>;

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>API Key Management</h3>
        <button className="btn btn-sm" onClick={() => { setShowCreate(!showCreate); setCreatedKey(null); }}>
          {showCreate ? 'Cancel' : '+ Create API Key'}
        </button>
      </div>

      {error && <div className="error-msg" role="alert">{error}</div>}
      {success && <div className="success-msg" role="status">{success}</div>}

      {/* Show newly created key */}
      {createdKey && (
        <div className="success-msg" style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--success-bg, #d4edda)', border: '2px solid var(--success-border, #28a745)', borderRadius: '8px' }}>
          <strong>API Key Created — Copy it now! It will not be shown again.</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <code style={{ flex: 1, padding: '0.5rem', background: 'var(--bg)', borderRadius: '4px', wordBreak: 'break-all', fontSize: '0.85em' }}>
              {createdKey.plain_key}
            </code>
            <button className="btn btn-sm" onClick={() => copyToClipboard(createdKey.plain_key)}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button className="btn btn-xs btn-outline" style={{ marginTop: '0.5rem' }} onClick={() => setCreatedKey(null)}>
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <form className="settings-form" onSubmit={handleCreate} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h4>Create New API Key</h4>
          <div className="form-row">
            <label>Name *</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="e.g., Syslog Forwarder" />
          </div>
          <div className="form-row">
            <label>Scope *</label>
            <select value={newScope} onChange={(e) => setNewScope(e.target.value)}>
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Description</label>
            <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="form-row">
            <label>Expires At</label>
            <input type="datetime-local" value={newExpires} onChange={(e) => setNewExpires(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'Create API Key'}
          </button>
        </form>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Description</th>
              <th>Status</th>
              <th>Created By</th>
              <th>Expires</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ opacity: k.is_active ? 1 : 0.5 }}>
                <td><strong>{k.name}</strong></td>
                <td><span className="badge badge-info">{k.scope}</span></td>
                <td>{k.description || '—'}</td>
                <td>
                  <span className={`badge ${k.is_active ? 'badge-success' : 'badge-muted'}`}>
                    {k.is_active ? 'Active' : 'Revoked'}
                  </span>
                  {k.expires_at && new Date(k.expires_at) < new Date() && (
                    <span className="badge badge-warning" style={{ marginLeft: '0.3rem' }}>Expired</span>
                  )}
                </td>
                <td>{k.created_by_username || '—'}</td>
                <td>{fmtDate(k.expires_at)}</td>
                <td>{fmtDate(k.last_used_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <button
                      className={`btn btn-xs ${k.is_active ? 'btn-outline' : 'btn-success-outline'}`}
                      onClick={() => handleToggleActive(k)}
                    >
                      {k.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {k.is_active && (
                      <button className="btn btn-xs btn-danger-outline" onClick={() => handleRevoke(k)}>
                        Revoke
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No API keys found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

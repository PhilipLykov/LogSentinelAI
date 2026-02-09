import { useState, useEffect, useCallback } from 'react';
import {
  type UserInfo,
  type CurrentUser,
  fetchUsers,
  createUser,
  updateUser,
  resetUserPassword,
  toggleUserActive,
  deleteUser,
} from '../api';

const ROLES = [
  { value: 'administrator', label: 'Administrator' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'monitoring_agent', label: 'Monitoring Agent' },
];

interface Props {
  onAuthError: () => void;
  currentUser?: CurrentUser | null;
}

export function UserManagementSection({ onAuthError, currentUser }: Props) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('monitoring_agent');
  const [creating, setCreating] = useState(false);

  // Edit user
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset password
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchUsers();
      setUsers(data);
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
      await createUser({
        username: newUsername.trim(),
        password: newPassword,
        display_name: newDisplayName.trim() || undefined,
        email: newEmail.trim() || undefined,
        role: newRole,
        must_change_password: true,
      });
      setSuccess(`User "${newUsername.trim()}" created successfully.`);
      setShowCreate(false);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewEmail('');
      setNewRole('monitoring_agent');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (u: UserInfo) => {
    setEditingId(u.id);
    setEditDisplayName(u.display_name ?? '');
    setEditEmail(u.email ?? '');
    setEditRole(u.role);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await updateUser(editingId, {
        display_name: editDisplayName.trim() || undefined,
        email: editEmail.trim() || undefined,
        role: editRole,
      });
      setSuccess('User updated.');
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isSelf = (u: UserInfo) => currentUser?.id === u.id;

  const handleToggleActive = async (u: UserInfo) => {
    if (isSelf(u)) {
      setError('You cannot disable your own account.');
      return;
    }
    setError('');
    setSuccess('');
    try {
      await toggleUserActive(u.id);
      setSuccess(`User "${u.username}" ${u.is_active ? 'disabled' : 'enabled'}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (u: UserInfo) => {
    if (isSelf(u)) {
      setError('You cannot delete your own account.');
      return;
    }
    if (!confirm(`Deactivate user "${u.username}"? This will invalidate all their sessions.`)) return;
    setError('');
    setSuccess('');
    try {
      await deleteUser(u.id);
      setSuccess(`User "${u.username}" deactivated.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetPw = async () => {
    if (!resetId || !resetPw) return;
    setError('');
    setSuccess('');
    setResetting(true);
    try {
      const result = await resetUserPassword(resetId, resetPw);
      setSuccess(result.message);
      setResetId(null);
      setResetPw('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading users…</div>;

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>User Management</h3>
        <button className="btn btn-sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ Create User'}
        </button>
      </div>

      {error && <div className="error-msg" role="alert">{error}</div>}
      {success && <div className="success-msg" role="status">{success}</div>}

      {showCreate && (
        <form className="settings-form" onSubmit={handleCreate} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h4>Create New User</h4>
          <div className="form-row">
            <label>Username *</label>
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required minLength={3} placeholder="min 3 characters" />
          </div>
          <div className="form-row">
            <label>Password *</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} placeholder="min 12 chars, 1 upper, 1 lower, 1 digit, 1 special" />
          </div>
          <div className="form-row">
            <label>Display Name</label>
            <input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-row">
            <label>Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <button type="submit" className="btn" disabled={creating || !newUsername.trim() || !newPassword}>
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </form>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                <td><strong>{u.username}</strong></td>
                <td>
                  {editingId === u.id ? (
                    <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} style={{ width: '100%' }} />
                  ) : (
                    u.display_name || '—'
                  )}
                </td>
                <td>
                  {editingId === u.id ? (
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className={`badge badge-${u.role === 'administrator' ? 'danger' : u.role === 'auditor' ? 'warning' : 'info'}`}>
                      {u.role.replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge ${u.is_active ? 'badge-success' : 'badge-muted'}`}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                  {u.locked_until && new Date(u.locked_until) > new Date() && (
                    <span className="badge badge-warning" style={{ marginLeft: '0.3rem' }}>Locked</span>
                  )}
                </td>
                <td>{fmtDate(u.last_login_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {editingId === u.id ? (
                      <>
                        <button className="btn btn-xs" onClick={handleSaveEdit} disabled={saving}>Save</button>
                        <button className="btn btn-xs btn-outline" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-xs btn-outline" onClick={() => handleEdit(u)}>Edit</button>
                        <button className="btn btn-xs btn-outline" onClick={() => { setResetId(u.id); setResetPw(''); }}>Reset PW</button>
                        {!isSelf(u) && (
                          <button
                            className={`btn btn-xs ${u.is_active ? 'btn-outline' : 'btn-success-outline'}`}
                            onClick={() => handleToggleActive(u)}
                          >
                            {u.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                        {u.is_active && !isSelf(u) && (
                          <button className="btn btn-xs btn-danger-outline" onClick={() => handleDelete(u)}>Delete</button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reset password modal */}
      {resetId && (
        <div className="modal-overlay" onClick={() => setResetId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h4>Reset Password</h4>
            <p>User: <strong>{users.find((u) => u.id === resetId)?.username}</strong></p>
            <input
              type="password"
              placeholder="New password (min 12 chars)"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              minLength={12}
              autoFocus
              style={{ width: '100%', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-outline" onClick={() => setResetId(null)}>Cancel</button>
              <button className="btn btn-sm" onClick={handleResetPw} disabled={resetting || resetPw.length < 12}>
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

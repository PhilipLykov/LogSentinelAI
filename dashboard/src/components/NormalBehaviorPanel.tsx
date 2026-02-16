import { useEffect, useState, useCallback } from 'react';
import {
  type NormalBehaviorTemplate,
  fetchNormalBehaviorTemplates,
  updateNormalBehaviorTemplate,
  deleteNormalBehaviorTemplate,
} from '../api';

interface NormalBehaviorPanelProps {
  onAuthError: () => void;
}

export function NormalBehaviorPanel({ onAuthError }: NormalBehaviorPanelProps) {
  const [templates, setTemplates] = useState<NormalBehaviorTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editHostPattern, setEditHostPattern] = useState('');
  const [editProgramPattern, setEditProgramPattern] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchNormalBehaviorTemplates();
      setTemplates(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleToggleEnabled = useCallback(async (id: string, currentEnabled: boolean) => {
    try {
      const updated = await updateNormalBehaviorTemplate(id, { enabled: !currentEnabled });
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError(msg);
    }
  }, [onAuthError]);

  const handleStartEdit = useCallback((t: NormalBehaviorTemplate) => {
    setEditingId(t.id);
    setEditPattern(t.pattern);
    setEditHostPattern(t.host_pattern ?? '');
    setEditProgramPattern(t.program_pattern ?? '');
    setEditNotes(t.notes ?? '');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateNormalBehaviorTemplate(editingId, {
        pattern: editPattern,
        host_pattern: editHostPattern.trim() || null,
        program_pattern: editProgramPattern.trim() || null,
        notes: editNotes.trim() || null,
      });
      setTemplates((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
      setEditingId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [editingId, editPattern, editHostPattern, editProgramPattern, editNotes, onAuthError]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteNormalBehaviorTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setDeleteConfirm(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Authentication')) { onAuthError(); return; }
      setError(msg);
    }
  }, [onAuthError]);

  const safeDate = (ts: string): string => {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${minutes}`;
    } catch {
      return ts;
    }
  };

  return (
    <div className="normal-behavior-panel">
      <h3>Normal Behavior Templates</h3>
      <p className="nb-description">
        Events matching these patterns are treated as normal behavior and excluded
        from AI scoring and meta-analysis. Use the <strong>Mark OK</strong> button
        on any event in the drill-down view to create a new template.
      </p>

      {error && (
        <div className="error-msg" role="alert">
          {error}
          <button className="error-dismiss" onClick={() => setError('')} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {loading && (
        <div className="settings-loading"><div className="spinner" /> Loading templates…</div>
      )}

      {!loading && templates.length === 0 && (
        <div className="nb-empty">
          <p>No normal behavior templates defined yet.</p>
          <p>
            Open any system&apos;s drill-down view, expand an event, and click{' '}
            <strong>Mark OK</strong> to create a template.
          </p>
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="table-responsive">
          <table className="nb-table" aria-label="Normal behavior templates">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Pattern (regex)</th>
                <th>Host</th>
                <th>Program</th>
                <th>Original Message</th>
                <th>Created By</th>
                <th>Created</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className={t.enabled ? '' : 'nb-row-disabled'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={() => handleToggleEnabled(t.id, t.enabled)}
                      title={t.enabled ? 'Click to disable this template' : 'Click to enable this template'}
                    />
                  </td>
                  <td className="nb-pattern-cell">
                    {editingId === t.id ? (
                      <textarea
                        className="nb-edit-pattern"
                        value={editPattern}
                        onChange={(ev) => setEditPattern(ev.target.value)}
                        rows={2}
                      />
                    ) : (
                      <code className="nb-pattern-code">{t.pattern}</code>
                    )}
                  </td>
                  <td className="nb-filter-cell">
                    {editingId === t.id ? (
                      <input
                        type="text"
                        className="nb-edit-filter"
                        value={editHostPattern}
                        onChange={(ev) => setEditHostPattern(ev.target.value)}
                        placeholder="(any)"
                      />
                    ) : (
                      <code className="nb-filter-code">{t.host_pattern ?? <span className="nb-any">(any)</span>}</code>
                    )}
                  </td>
                  <td className="nb-filter-cell">
                    {editingId === t.id ? (
                      <input
                        type="text"
                        className="nb-edit-filter"
                        value={editProgramPattern}
                        onChange={(ev) => setEditProgramPattern(ev.target.value)}
                        placeholder="(any)"
                      />
                    ) : (
                      <code className="nb-filter-code">{t.program_pattern ?? <span className="nb-any">(any)</span>}</code>
                    )}
                  </td>
                  <td className="nb-original-cell" title={t.original_message}>
                    <span className="nb-original-text">{t.original_message}</span>
                  </td>
                  <td>{t.created_by}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{safeDate(t.created_at)}</td>
                  <td>
                    {editingId === t.id ? (
                      <input
                        type="text"
                        className="nb-edit-notes"
                        value={editNotes}
                        onChange={(ev) => setEditNotes(ev.target.value)}
                        placeholder="Optional notes…"
                      />
                    ) : (
                      t.notes ?? '—'
                    )}
                  </td>
                  <td className="nb-actions-cell">
                    {editingId === t.id ? (
                      <>
                        <button
                          className="btn btn-xs btn-primary"
                          onClick={handleSaveEdit}
                          disabled={saving || !editPattern.trim()}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </>
                    ) : deleteConfirm === t.id ? (
                      <>
                        <span className="nb-delete-confirm-text">Delete?</span>
                        <button
                          className="btn btn-xs btn-danger"
                          onClick={() => handleDelete(t.id)}
                        >
                          Yes
                        </button>
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => handleStartEdit(t)}
                          title="Edit pattern and notes"
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-xs btn-danger-outline"
                          onClick={() => setDeleteConfirm(t.id)}
                          title="Delete this template"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

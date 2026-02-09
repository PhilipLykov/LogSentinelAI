import { useState, useRef, useEffect } from 'react';

interface SystemFormProps {
  title: string;
  initialName?: string;
  initialDescription?: string;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
  saving: boolean;
}

export function SystemForm({
  title,
  initialName = '',
  initialDescription = '',
  onSave,
  onCancel,
  saving,
}: SystemFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('System name is required.');
      nameRef.current?.focus();
      return;
    }
    setNameError('');
    onSave(trimmed, description.trim());
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="system-name">Name *</label>
            <input
              ref={nameRef}
              id="system-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="e.g. Production Web Server"
              maxLength={255}
              aria-required="true"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'system-name-error' : undefined}
            />
            {nameError && <span id="system-name-error" className="field-error">{nameError}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="system-description">Description</label>
            <textarea
              id="system-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of what this system is"
              rows={3}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

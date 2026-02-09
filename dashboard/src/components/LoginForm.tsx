import { useState } from 'react';
import { setApiKey, validateApiKey } from '../api';

interface LoginFormProps {
  onLogin: () => void;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setError('');
    setValidating(true);

    try {
      const valid = await validateApiKey(trimmed);
      if (valid) {
        setApiKey(trimmed);
        onLogin();
      } else {
        setError('Invalid API key. Please check and try again.');
      }
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>SyslogCollectorAI</h2>
        <p className="login-subtitle">
          Enter your API key to access the dashboard.
        </p>

        {error && <div id="login-error-msg" className="login-error" role="alert">{error}</div>}

        <label htmlFor="api-key-input" className="sr-only">API Key</label>
        <input
          id="api-key-input"
          type="password"
          placeholder="API Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          aria-describedby={error ? 'login-error-msg' : undefined}
        />
        <button type="submit" className="btn" disabled={validating || !key.trim()}>
          {validating ? 'Verifying…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

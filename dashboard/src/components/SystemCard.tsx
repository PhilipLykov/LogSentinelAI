import { type DashboardSystem } from '../api';
import { ScoreBars } from './ScoreBar';

interface SystemCardProps {
  system: DashboardSystem;
  onClick: () => void;
}

export function SystemCard({ system, onClick }: SystemCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const eventCount = Number.isFinite(system.event_count) ? system.event_count : 0;
  const lastWindowTime = system.latest_window
    ? formatEuTime(system.latest_window.to)
    : null;

  return (
    <div
      className="system-card"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="listitem"
      tabIndex={0}
      aria-label={`View details for ${system.name}`}
    >
      <h3>{system.name}</h3>
      <div className="meta">
        {system.source_count} source{system.source_count !== 1 ? 's' : ''}
        {' · '}
        {eventCount.toLocaleString()} events
        {lastWindowTime && (
          <>
            {' · '}
            Last window: {lastWindowTime}
          </>
        )}
      </div>
      {/* Active findings badge */}
      {system.active_findings && system.active_findings.total > 0 && (
        <div className="active-findings-badge">
          <span className="active-findings-count">{system.active_findings.total} active issue{system.active_findings.total !== 1 ? 's' : ''}</span>
          <span className="active-findings-breakdown">
            {system.active_findings.critical > 0 && <span className="af-critical">{system.active_findings.critical} critical</span>}
            {system.active_findings.high > 0 && <span className="af-high">{system.active_findings.high} high</span>}
            {system.active_findings.medium > 0 && <span className="af-medium">{system.active_findings.medium} medium</span>}
            {(system.active_findings.low > 0 || system.active_findings.info > 0) && (
              <span className="af-low">{(system.active_findings.low || 0) + (system.active_findings.info || 0)} low/info</span>
            )}
          </span>
        </div>
      )}
      {Object.keys(system.scores).length > 0 ? (
        <ScoreBars scores={system.scores} />
      ) : (
        <div className="no-scores-msg">
          No scores yet — awaiting pipeline run
        </div>
      )}
    </div>
  );
}

/** Format a timestamp as DD-MM-YYYY HH:MM:SS (EU format). */
function formatEuTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return ts;
  }
}

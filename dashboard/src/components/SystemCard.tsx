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

  const eventCount = Number.isFinite(system.event_count_24h) ? system.event_count_24h : 0;
  const lastWindowTime = system.latest_window
    ? safeTime(system.latest_window.to)
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
        {eventCount.toLocaleString()} events (24h)
        {lastWindowTime && (
          <>
            {' · '}
            Last window: {lastWindowTime}
          </>
        )}
      </div>
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

/** Safely format a time, returning raw string if the date is invalid. */
function safeTime(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

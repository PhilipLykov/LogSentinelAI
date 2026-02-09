import type { Knex } from 'knex';

export type SeverityLabel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface SeverityBands {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

const DEFAULT_BANDS: SeverityBands = {
  critical: 0.75,
  high: 0.5,
  medium: 0.25,
  low: 0,
};

/**
 * Map a 0–1 score to a severity label based on configurable bands.
 */
export function scoreToSeverity(score: number, bands?: SeverityBands): SeverityLabel {
  const b = bands ?? DEFAULT_BANDS;
  if (score >= b.critical) return 'CRITICAL';
  if (score >= b.high) return 'HIGH';
  if (score >= b.medium) return 'MEDIUM';
  return 'LOW';
}

/**
 * Load severity bands from app_config if available.
 */
export async function loadSeverityBands(db: Knex): Promise<SeverityBands> {
  try {
    const row = await db('app_config').where({ key: 'severity_bands' }).first();
    if (row) {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return { ...DEFAULT_BANDS, ...value };
    }
  } catch {
    // Table may not exist yet
  }
  return DEFAULT_BANDS;
}

import { localTimestamp } from '../../config/index.js';
import { CRITERIA_SLUGS, type CriterionSlug, type MetaScores } from '../../types/index.js';

// ── Types ────────────────────────────────────────────────────

export interface ScoreResult {
  it_security: number;
  performance_degradation: number;
  failure_prediction: number;
  anomaly: number;
  compliance_audit: number;
  operational_risk: number;
  reason_codes?: Record<CriterionSlug, string[]>;
}

/** Structured finding returned by the LLM. */
export interface StructuredFinding {
  text: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  criterion?: string;  // criterion slug, e.g. 'it_security'
}

/** Context from previous analysis runs, fed to LLM for continuity. */
export interface MetaAnalysisContext {
  /** Summaries of the most recent N windows (newest first). */
  previousSummaries: Array<{ windowTime: string; summary: string }>;
  /** Currently open (unacknowledged, unresolved) findings with their DB index. */
  openFindings: Array<{ index: number; text: string; severity: string; criterion?: string }>;
}

export interface MetaAnalysisResult {
  meta_scores: MetaScores;
  summary: string;
  /** Structured findings (new ones produced by this analysis). */
  findings: StructuredFinding[];
  /** Legacy: flat finding strings (kept for backward compat with old meta_results). */
  findingsFlat: string[];
  /** Indices (from openFindings) the LLM considers resolved. */
  resolvedFindingIndices: number[];
  recommended_action?: string;
  key_event_ids?: string[];
}

export interface LlmUsageInfo {
  model: string;
  token_input: number;
  token_output: number;
  request_count: number;
}

export interface ScoreEventsResult {
  scores: ScoreResult[];
  usage: LlmUsageInfo;
}

export interface MetaAnalyzeResult {
  result: MetaAnalysisResult;
  usage: LlmUsageInfo;
}

// ── LLM Adapter Interface ────────────────────────────────────

export interface LlmAdapter {
  scoreEvents(
    events: Array<{ message: string; severity?: string; host?: string; program?: string }>,
    systemDescription: string,
    sourceLabels: string[],
    options?: { systemPrompt?: string },
  ): Promise<ScoreEventsResult>;

  metaAnalyze(
    eventsWithScores: Array<{
      message: string;
      severity?: string;
      scores?: ScoreResult;
      occurrenceCount?: number;
    }>,
    systemDescription: string,
    sourceLabels: string[],
    context?: MetaAnalysisContext,
    options?: { systemPrompt?: string },
  ): Promise<MetaAnalyzeResult>;
}

// ── Default system prompts (exported for UI display / reset) ─

export const DEFAULT_SCORE_SYSTEM_PROMPT = `You are an expert IT log analyst. You will receive events from a specific monitored system along with its SYSTEM SPECIFICATION — a description that explains what the system does, its purpose, and what aspects are important. USE the system specification to contextualise every event: what is normal for this system, what is suspicious, what constitutes a real risk, and what can be safely ignored.

Analyze each log event and return a JSON object with a "scores" key containing an array of objects, one per event.

Each object must have exactly these 6 keys (float 0.0 to 1.0):
- it_security: likelihood of security threat
- performance_degradation: indicators of slowness, resource exhaustion
- failure_prediction: signs of impending failure
- anomaly: unusual patterns deviating from normal behavior
- compliance_audit: relevance to compliance/audit
- operational_risk: general service health risk

Example response for 2 events:
{"scores": [{"it_security": 0.8, "performance_degradation": 0.1, "failure_prediction": 0.0, "anomaly": 0.3, "compliance_audit": 0.7, "operational_risk": 0.2}, {"it_security": 0.0, "performance_degradation": 0.6, "failure_prediction": 0.4, "anomaly": 0.1, "compliance_audit": 0.0, "operational_risk": 0.5}]}

Return ONLY valid JSON with the "scores" array.`;

export const DEFAULT_META_SYSTEM_PROMPT = `You are an expert IT log analyst performing a meta-analysis of a batch of log events from a single monitored system over a time window.

IMPORTANT: You will receive a SYSTEM SPECIFICATION that describes the monitored system — its purpose, architecture, services, and what to watch for. Treat this specification as authoritative context: use it to understand which events are routine, which indicate real problems, and what the operational priorities are for this specific system.

You will also receive the current window's events AND context from previous analysis windows (summaries and currently open findings). Use the previous context to:
1. Spot trends that span multiple windows (e.g. recurring errors, escalating problems).
2. Decide whether previously reported findings are still relevant or can be resolved.
3. Avoid repeating findings that are still open — only create NEW findings for genuinely new observations.

Return a JSON object with:
- meta_scores: object with 6 keys (it_security, performance_degradation, failure_prediction, anomaly, compliance_audit, operational_risk), each a float 0.0–1.0
- summary: 2-4 sentence summary of the window's findings, referencing trends if visible
- new_findings: array of NEW finding objects, each with:
    - text: specific finding description (actionable, concise)
    - severity: one of "critical", "high", "medium", "low", "info"
    - criterion: most relevant criterion slug (it_security, performance_degradation, failure_prediction, anomaly, compliance_audit, operational_risk) or null
- resolved_indices: array of integer indices from the "Previously open findings" list that are NO LONGER relevant based on the current window (e.g. an issue that has stopped occurring). Only include indices that clearly should be closed.
- recommended_action: one short recommended action (optional)

Important: produce at least 3-5 findings per analysis when there are notable events. Be specific and actionable. Reference event patterns, hosts, programs, or error messages where relevant.

Return ONLY valid JSON.`;

// ── OpenAI Adapter ───────────────────────────────────────────

export class OpenAiAdapter implements LlmAdapter {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(cfg?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = cfg?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = cfg?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.baseUrl = cfg?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

    if (!this.apiKey) {
      console.warn(`[${localTimestamp()}] WARNING: OPENAI_API_KEY not set. LLM scoring will fail.`);
    }
  }

  /** Update adapter config at runtime (e.g. when user changes settings via UI). */
  updateConfig(cfg: { apiKey?: string; model?: string; baseUrl?: string }): void {
    if (cfg.apiKey !== undefined) this.apiKey = cfg.apiKey;
    if (cfg.model !== undefined) this.model = cfg.model;
    if (cfg.baseUrl !== undefined) this.baseUrl = cfg.baseUrl;
  }

  /** Check whether the adapter has a valid API key configured. */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async scoreEvents(
    events: Array<{ message: string; severity?: string; host?: string; program?: string }>,
    systemDescription: string,
    sourceLabels: string[],
    options?: { systemPrompt?: string },
  ): Promise<ScoreEventsResult> {
    const sections: string[] = [];

    // System specification — prominent section so the LLM treats it as key context
    if (systemDescription && systemDescription.trim()) {
      sections.push('=== SYSTEM SPECIFICATION ===');
      sections.push(systemDescription.trim());
      sections.push('=== END SYSTEM SPECIFICATION ===');
      sections.push('');
    }

    sections.push(`Log sources: ${sourceLabels.join(', ')}`);
    sections.push(`Number of events: ${events.length}`);
    sections.push('');
    sections.push('Events to analyze:');
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      sections.push(
        `[${i + 1}] ${e.severity ? `[${e.severity}]` : ''} ${e.host ? `host=${e.host}` : ''} ${e.program ? `prog=${e.program}` : ''} ${e.message}`,
      );
    }

    const userContent = sections.join('\n');
    const prompt = options?.systemPrompt ?? DEFAULT_SCORE_SYSTEM_PROMPT;
    const response = await this.chatCompletion(prompt, userContent);

    let scores: ScoreResult[];
    try {
      const parsed = JSON.parse(response.content);
      // Handle both {"scores": [...]} and direct array (if provider doesn't use json_object)
      const rawScores = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.scores)
          ? parsed.scores
          : [parsed];
      scores = rawScores.map(normalizeScoreResult);

      // Pad scores array if LLM returned fewer than expected
      while (scores.length < events.length) {
        scores.push(emptyScoreResult());
      }
    } catch (err) {
      console.error(`[${localTimestamp()}] Failed to parse LLM score response:`, err);
      console.error(`[${localTimestamp()}] Raw response: ${response.content.slice(0, 500)}`);
      // Return zero scores rather than crash
      scores = events.map(() => emptyScoreResult());
    }

    return { scores, usage: response.usage };
  }

  async metaAnalyze(
    eventsWithScores: Array<{
      message: string;
      severity?: string;
      scores?: ScoreResult;
      occurrenceCount?: number;
    }>,
    systemDescription: string,
    sourceLabels: string[],
    context?: MetaAnalysisContext,
    options?: { systemPrompt?: string },
  ): Promise<MetaAnalyzeResult> {
    const sections: string[] = [];

    // System specification — prominent section so the LLM treats it as key context
    if (systemDescription && systemDescription.trim()) {
      sections.push('=== SYSTEM SPECIFICATION ===');
      sections.push(systemDescription.trim());
      sections.push('=== END SYSTEM SPECIFICATION ===');
      sections.push('');
    }

    sections.push(`Log sources: ${sourceLabels.join(', ')}`);

    // ── Historical context (sliding window, like a conversation context) ──
    if (context?.previousSummaries?.length) {
      sections.push('');
      sections.push('=== Previous analysis context (most recent first) ===');
      for (const ps of context.previousSummaries) {
        sections.push(`[${ps.windowTime}] ${ps.summary}`);
      }
    }

    if (context?.openFindings?.length) {
      sections.push('');
      sections.push('=== Previously open findings (reference by index to resolve) ===');
      for (const f of context.openFindings) {
        sections.push(`  [${f.index}] [${f.severity}]${f.criterion ? ` (${f.criterion})` : ''} ${f.text}`);
      }
    }

    // ── Current window events ──
    sections.push('');
    sections.push(`=== Current window events (${eventsWithScores.length} total) ===`);
    for (let i = 0; i < eventsWithScores.length; i++) {
      const e = eventsWithScores[i];
      let line = `[${i + 1}] ${e.severity ? `[${e.severity}]` : ''} ${e.message}`;
      if (e.occurrenceCount && e.occurrenceCount > 1) {
        line += ` (×${e.occurrenceCount})`;
      }
      if (e.scores) {
        const maxScore = Math.max(
          e.scores.it_security, e.scores.performance_degradation,
          e.scores.failure_prediction, e.scores.anomaly,
          e.scores.compliance_audit, e.scores.operational_risk,
        );
        line += ` [max_score=${maxScore.toFixed(2)}]`;
      }
      sections.push(line);
    }

    const userContent = sections.join('\n');
    const prompt = options?.systemPrompt ?? DEFAULT_META_SYSTEM_PROMPT;
    const response = await this.chatCompletion(prompt, userContent);

    try {
      const parsed = JSON.parse(response.content);

      const metaScores: MetaScores = {
        it_security: clamp(parsed.meta_scores?.it_security ?? 0),
        performance_degradation: clamp(parsed.meta_scores?.performance_degradation ?? 0),
        failure_prediction: clamp(parsed.meta_scores?.failure_prediction ?? 0),
        anomaly: clamp(parsed.meta_scores?.anomaly ?? 0),
        compliance_audit: clamp(parsed.meta_scores?.compliance_audit ?? 0),
        operational_risk: clamp(parsed.meta_scores?.operational_risk ?? 0),
      };

      // Parse structured findings (new format)
      const rawNewFindings = Array.isArray(parsed.new_findings) ? parsed.new_findings : [];
      const structuredFindings: StructuredFinding[] = rawNewFindings.map((f: any) => ({
        text: typeof f.text === 'string' ? f.text : String(f),
        severity: (['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) ? f.severity : 'medium') as StructuredFinding['severity'],
        criterion: typeof f.criterion === 'string' && CRITERIA_SLUGS.includes(f.criterion as CriterionSlug) ? f.criterion : undefined,
      }));

      // Backward compat: also accept plain "findings" array of strings
      let flatFindings: string[] = [];
      if (structuredFindings.length > 0) {
        flatFindings = structuredFindings.map((f) => f.text);
      } else if (Array.isArray(parsed.findings)) {
        // Old-format response (plain string array)
        flatFindings = parsed.findings.filter((f: unknown) => typeof f === 'string');
        // Convert to structured with defaults
        for (const text of flatFindings) {
          structuredFindings.push({ text, severity: 'medium' });
        }
      }

      // Parse resolved indices
      const rawResolved = Array.isArray(parsed.resolved_indices) ? parsed.resolved_indices : [];
      const resolvedFindingIndices = rawResolved
        .filter((v: unknown) => typeof v === 'number' && Number.isFinite(v))
        .map((v: number) => Math.round(v));

      return {
        result: {
          meta_scores: metaScores,
          summary: parsed.summary ?? '',
          findings: structuredFindings,
          findingsFlat: flatFindings,
          resolvedFindingIndices,
          recommended_action: parsed.recommended_action,
          key_event_ids: parsed.key_event_ids,
        },
        usage: response.usage,
      };
    } catch (err) {
      console.error(`[${localTimestamp()}] Failed to parse LLM meta response:`, err);
      console.error(`[${localTimestamp()}] Raw response: ${response.content.slice(0, 500)}`);
      throw new Error('Failed to parse meta-analysis LLM response');
    }
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
  ): Promise<{ content: string; usage: LlmUsageInfo }> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' as const },
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.warn(`[${localTimestamp()}] LLM returned empty content (model=${this.model})`);
    }
    const usage: LlmUsageInfo = {
      model: this.model,
      token_input: data.usage?.prompt_tokens ?? 0,
      token_output: data.usage?.completion_tokens ?? 0,
      request_count: 1,
    };

    return { content: content ?? '{}', usage };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function clamp(v: unknown): number {
  const n = typeof v === 'number' ? v : 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalize a raw LLM score object: ensure all 6 fields exist, clamp 0-1. */
function normalizeScoreResult(raw: Record<string, unknown>): ScoreResult {
  const result: Record<string, number> = {};
  for (const slug of CRITERIA_SLUGS) {
    result[slug] = clamp(raw[slug]);
  }
  return result as unknown as ScoreResult;
}

function emptyScoreResult(): ScoreResult {
  return {
    it_security: 0,
    performance_degradation: 0,
    failure_prediction: 0,
    anomaly: 0,
    compliance_audit: 0,
    operational_risk: 0,
  };
}

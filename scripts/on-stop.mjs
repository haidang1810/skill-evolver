#!/usr/bin/env node
// Stop hook handler
// Finalizes the active skill run with metrics from the transcript
// Also detects cancellations (H4 fix)

import { getDb, closeDb } from '../lib/db.mjs';
import { parseTranscriptMetrics } from '../lib/transcript-parser.mjs';

// If a run completes with very few tokens and short duration, likely cancelled
const CANCEL_TOKEN_THRESHOLD = 50;
const CANCEL_DURATION_MS = 3000;

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const sessionId = data.session_id || data.sessionId || 'unknown';
  const transcriptPath = data.transcript_path || data.transcriptPath || null;
  const stopReason = data.stop_reason || data.stopReason || null;

  const db = getDb();

  try {
    const activeRun = db.prepare(`
      SELECT id, triggered_at FROM skill_runs
      WHERE session_id = ? AND completed = 0
      ORDER BY triggered_at DESC
      LIMIT 1
    `).get(sessionId);

    if (!activeRun) return;

    const metrics = parseTranscriptMetrics(transcriptPath, sessionId);

    let durationMs = metrics.durationMs;
    if (!durationMs && activeRun.triggered_at) {
      const startTime = new Date(activeRun.triggered_at + 'Z').getTime();
      durationMs = Date.now() - startTime;
    }

    db.prepare(`
      UPDATE skill_runs SET
        completed = 1,
        tokens_used = ?,
        output_tokens = ?,
        tool_calls = ?,
        duration_ms = ?,
        model = COALESCE(?, model),
        files_involved = ?
      WHERE id = ?
    `).run(
      metrics.tokensUsed,
      metrics.outputTokens,
      metrics.toolCalls,
      durationMs,
      metrics.model,
      metrics.filesInvolved.length > 0 ? JSON.stringify(metrics.filesInvolved) : null,
      activeRun.id
    );

    // H4 fix: Detect cancellation and auto-record reaction
    const isCancelled = stopReason === 'interrupted' ||
      stopReason === 'cancelled' ||
      (metrics.tokensUsed < CANCEL_TOKEN_THRESHOLD && durationMs < CANCEL_DURATION_MS);

    if (isCancelled) {
      // Check no reaction already recorded
      const existing = db.prepare(
        'SELECT id FROM reactions WHERE skill_run_id = ?'
      ).get(activeRun.id);

      if (!existing) {
        db.prepare(`
          INSERT INTO reactions (skill_run_id, reaction_type, time_after_skill_ms)
          VALUES (?, 'cancel', ?)
        `).run(activeRun.id, durationMs);
      }
    }
  } finally {
    closeDb();
  }
}

main().catch(() => process.exit(0));

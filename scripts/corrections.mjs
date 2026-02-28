#!/usr/bin/env node
// /skill-corrections command — show raw corrections + keyword clusters
// Usage: node corrections.mjs <skill-name>

import { getDb, closeDb } from '../lib/db.mjs';
import { extractKeywords, clusterKeywords } from '../lib/keywords.mjs';

function main() {
  const skillName = process.argv[2];
  if (!skillName) {
    console.log('Usage: /skill-corrections <skill-name>');
    return;
  }

  const db = getDb();

  try {
    // Get recent corrections and follow-ups
    const reactions = db.prepare(`
      SELECT r.reaction_type, r.user_message, r.detected_at, r.time_after_skill_ms
      FROM reactions r
      JOIN skill_runs sr ON sr.id = r.skill_run_id
      WHERE sr.skill_name = ?
        AND r.reaction_type IN ('correction', 'follow_up')
        AND r.user_message IS NOT NULL
        AND sr.triggered_at >= datetime('now', '-30 days')
      ORDER BY r.detected_at DESC
      LIMIT 50
    `).all(skillName);

    if (reactions.length === 0) {
      console.log(`No corrections found for /${skillName} in the last 30 days.`);
      return;
    }

    // Print keyword clusters
    const messages = reactions.map(r => r.user_message);
    const keywords = extractKeywords(messages, 8);
    const clusters = clusterKeywords(keywords);

    if (clusters.length > 0) {
      console.log(`/${skillName} — Correction patterns (last 30 days)\n`);
      console.log('  Keyword clusters:\n');
      for (const c of clusters) {
        const bar = '#'.repeat(Math.max(1, Math.round(c.pct / 5)));
        console.log(`  "${c.cluster}":  ${c.count} times (${c.pct}%) ${bar}`);
      }
    }

    // Print recent corrections (raw)
    console.log(`\n  Recent corrections/follow-ups (${reactions.length} total):\n`);

    const corrCount = reactions.filter(r => r.reaction_type === 'correction').length;
    const followCount = reactions.filter(r => r.reaction_type === 'follow_up').length;
    console.log(`  Corrections: ${corrCount}  |  Follow-ups: ${followCount}\n`);

    for (const r of reactions.slice(0, 15)) {
      const type = r.reaction_type === 'correction' ? 'CORR' : 'FLUP';
      const date = r.detected_at?.slice(0, 10) || '?';
      const msg = r.user_message.length > 100
        ? r.user_message.slice(0, 100) + '...'
        : r.user_message;
      console.log(`  [${type}] ${date}  ${msg}`);
    }

    if (reactions.length > 15) {
      console.log(`\n  ... and ${reactions.length - 15} more. Use /skill-export ${skillName} for full data.`);
    }
  } finally {
    closeDb();
  }
}

main();

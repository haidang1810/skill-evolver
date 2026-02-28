#!/usr/bin/env node
// /skill-export command — export skill data to CSV or JSON
// Usage: node export.mjs <skill-name> [--format csv|json] [--days 30]

import { getDb, closeDb } from '../lib/db.mjs';

function main() {
  const args = process.argv.slice(2);
  const skillName = args.find(a => !a.startsWith('--'));
  const format = getFlag(args, '--format') || 'json';
  // Sanitize days to integer, clamp to 1-365
  const rawDays = parseInt(getFlag(args, '--days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 365));

  if (!skillName) {
    console.log('Usage: /skill-export <skill-name> [--format csv|json] [--days 30]');
    return;
  }

  const db = getDb();

  try {
    // Parameterized query — days passed as param not interpolated
    const dateThreshold = `-${days} days`;
    const runs = db.prepare(`
      SELECT
        sr.id, sr.skill_name, sr.session_id, sr.triggered_at, sr.trigger_type,
        sr.arguments, sr.tokens_used, sr.tool_calls, sr.duration_ms,
        sr.files_involved, sr.output_tokens, sr.skill_version_hash, sr.model,
        r.reaction_type, r.user_message, r.time_after_skill_ms
      FROM skill_runs sr
      LEFT JOIN reactions r ON r.skill_run_id = sr.id
      WHERE sr.skill_name = ? AND sr.completed = 1
        AND sr.triggered_at >= datetime('now', ?)
      ORDER BY sr.triggered_at DESC
    `).all(skillName, dateThreshold);

    if (runs.length === 0) {
      console.log(`No data for /${skillName} in the last ${days} days.`);
      return;
    }

    if (format === 'csv') {
      printCsv(runs);
    } else {
      printJson(runs);
    }
  } finally {
    closeDb();
  }
}

function printCsv(runs) {
  const headers = [
    'id', 'skill_name', 'triggered_at', 'trigger_type', 'tokens_used',
    'tool_calls', 'duration_ms', 'output_tokens', 'model',
    'skill_version_hash', 'reaction_type', 'time_after_skill_ms',
  ];
  console.log(headers.join(','));

  for (const r of runs) {
    const row = headers.map(h => escapeCsvField(r[h]));
    console.log(row.join(','));
  }
}

/** Properly escape CSV field: handle commas, quotes, newlines */
function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function printJson(runs) {
  console.log(JSON.stringify(runs, null, 2));
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

main();

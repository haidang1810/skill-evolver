#!/usr/bin/env node
// /skill-history command — show version timeline with metrics
// Usage: node history.mjs <skill-name>

import { getDb, closeDb } from '../lib/db.mjs';
import { getVersions } from './versioning.mjs';

function main() {
  const skillName = process.argv[2];
  if (!skillName) {
    console.log('Usage: /skill-history <skill-name>');
    return;
  }

  const db = getDb();

  try {
    const versions = getVersions(skillName);
    if (versions.length === 0) {
      console.log(`No version history for /${skillName}. Use the skill first to start tracking.`);
      return;
    }

    console.log(`/${skillName} history:\n`);

    // Reverse to show oldest first
    const ordered = [...versions].reverse();

    for (let i = 0; i < ordered.length; i++) {
      const v = ordered[i];
      const vNum = i + 1;
      const date = v.created_at?.slice(0, 10) || '?';
      const isBaseline = i === 0;

      // Calculate line delta from previous
      const lineDelta = i > 0
        ? `${v.line_count - ordered[i - 1].line_count >= 0 ? '+' : ''}${v.line_count - ordered[i - 1].line_count} lines`
        : '(baseline)';

      // Get satisfaction rate for runs using this version
      const metrics = db.prepare(`
        SELECT
          COUNT(sr.id) as runs,
          SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied,
          COUNT(r.id) as total_reactions
        FROM skill_runs sr
        LEFT JOIN reactions r ON r.skill_run_id = sr.id
        WHERE sr.skill_name = ? AND sr.skill_version_hash = ? AND sr.completed = 1
      `).get(skillName, v.version_hash);

      const satRate = metrics?.total_reactions > 0
        ? Math.round((metrics.satisfied / metrics.total_reactions) * 100)
        : null;

      const satStr = satRate !== null ? `${satRate}% satisfied` : 'no data';

      console.log(`  v${vNum}  ${date}  ${padRight(lineDelta, 14)} ${padRight(`${v.line_count} lines`, 10)} ${satStr}`);

      // Show satisfaction warning if it dropped
      if (i > 0 && satRate !== null) {
        const prevMetrics = db.prepare(`
          SELECT
            SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied,
            COUNT(r.id) as total_reactions
          FROM skill_runs sr
          LEFT JOIN reactions r ON r.skill_run_id = sr.id
          WHERE sr.skill_name = ? AND sr.skill_version_hash = ? AND sr.completed = 1
        `).get(skillName, ordered[i - 1].version_hash);

        const prevSatRate = prevMetrics?.total_reactions > 0
          ? Math.round((prevMetrics.satisfied / prevMetrics.total_reactions) * 100)
          : null;

        if (prevSatRate !== null && satRate < prevSatRate - 10) {
          console.log(`      !! Satisfaction dropped after this change`);
        }
      }
    }

    console.log(`\n  Hash of latest: ${ordered[ordered.length - 1].version_hash}`);
  } finally {
    closeDb();
  }
}

function padRight(str, len) { return String(str).padEnd(len); }

main();

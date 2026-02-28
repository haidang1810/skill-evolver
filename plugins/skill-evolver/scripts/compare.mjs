#!/usr/bin/env node
// /skill-compare command — compare two versions of a skill side-by-side
// Usage: node compare.mjs <skill-name> [hash-a] [hash-b]

import { getDb, closeDb } from '../lib/db.mjs';
import { getVersions, getVersionContent } from './versioning.mjs';

function main() {
  const skillName = process.argv[2];
  const hashA = process.argv[3];
  const hashB = process.argv[4];

  if (!skillName) {
    console.log('Usage: /skill-compare <skill-name> [hash-a] [hash-b]');
    return;
  }

  const db = getDb();

  try {
    const versions = getVersions(skillName);
    if (versions.length < 2) {
      console.log(`/${skillName} has ${versions.length} version(s). Need at least 2 to compare.`);
      return;
    }

    // Default: compare latest two
    const resolvedA = hashA || versions[1].version_hash;
    const resolvedB = hashB || versions[0].version_hash;

    const contentA = getVersionContent(resolvedA);
    const contentB = getVersionContent(resolvedB);

    if (!contentA || !contentB) {
      console.log('One or both version hashes not found.');
      return;
    }

    console.log(`/${skillName} — Comparing versions\n`);
    console.log(`  Version A: ${resolvedA} (${contentA.created_at?.slice(0, 10)}, ${contentA.line_count} lines)`);
    console.log(`  Version B: ${resolvedB} (${contentB.created_at?.slice(0, 10)}, ${contentB.line_count} lines)`);

    // Metrics comparison
    const metricsA = getVersionMetrics(db, skillName, resolvedA);
    const metricsB = getVersionMetrics(db, skillName, resolvedB);

    console.log('\n  -- Metrics ----');
    console.log(`  ${''.padEnd(22)} ${'Version A'.padStart(12)} ${'Version B'.padStart(12)}`);
    printMetricRow('Runs', metricsA.runs, metricsB.runs);
    printMetricRow('Satisfaction', `${metricsA.satRate}%`, `${metricsB.satRate}%`);
    printMetricRow('Avg tokens', metricsA.avgTokens, metricsB.avgTokens);
    printMetricRow('Correction rate', `${metricsA.corrRate}%`, `${metricsB.corrRate}%`);

    // Simple diff: show added/removed lines
    const linesA = contentA.content.split('\n');
    const linesB = contentB.content.split('\n');
    const diff = simpleDiff(linesA, linesB);

    if (diff.added.length > 0 || diff.removed.length > 0) {
      console.log('\n  -- Changes (B vs A) ----');
      console.log(`  Added: ${diff.added.length} lines | Removed: ${diff.removed.length} lines`);

      if (diff.removed.length > 0 && diff.removed.length <= 20) {
        console.log('\n  Removed:');
        for (const line of diff.removed.slice(0, 10)) {
          console.log(`  - ${line.slice(0, 80)}`);
        }
      }
      if (diff.added.length > 0 && diff.added.length <= 20) {
        console.log('\n  Added:');
        for (const line of diff.added.slice(0, 10)) {
          console.log(`  + ${line.slice(0, 80)}`);
        }
      }
    } else {
      console.log('\n  No line-level differences detected.');
    }
  } finally {
    closeDb();
  }
}

function getVersionMetrics(db, skillName, versionHash) {
  const row = db.prepare(`
    SELECT
      COUNT(sr.id) as runs,
      AVG(sr.tokens_used) as avg_tokens,
      SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied,
      SUM(CASE WHEN r.reaction_type = 'correction' THEN 1 ELSE 0 END) as corrections,
      COUNT(r.id) as total_reactions
    FROM skill_runs sr
    LEFT JOIN reactions r ON r.skill_run_id = sr.id
    WHERE sr.skill_name = ? AND sr.skill_version_hash = ? AND sr.completed = 1
  `).get(skillName, versionHash);

  return {
    runs: row?.runs || 0,
    avgTokens: Math.round(row?.avg_tokens || 0),
    satRate: row?.total_reactions > 0 ? Math.round((row.satisfied / row.total_reactions) * 100) : 0,
    corrRate: row?.total_reactions > 0 ? Math.round((row.corrections / row.total_reactions) * 100) : 0,
  };
}

function printMetricRow(label, valA, valB) {
  console.log(`  ${label.padEnd(22)} ${String(valA).padStart(12)} ${String(valB).padStart(12)}`);
}

/** Simple line-based diff (not optimal but sufficient for comparison) */
function simpleDiff(linesA, linesB) {
  const setA = new Set(linesA.map(l => l.trim()).filter(Boolean));
  const setB = new Set(linesB.map(l => l.trim()).filter(Boolean));

  const removed = [...setA].filter(l => !setB.has(l));
  const added = [...setB].filter(l => !setA.has(l));

  return { added, removed };
}

main();

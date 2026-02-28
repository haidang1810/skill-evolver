#!/usr/bin/env node
// /skill-ab command — A/B testing for skills
// Usage:
//   node ab-test.mjs start <skill-name> <version-b-path>
//   node ab-test.mjs status
//   node ab-test.mjs result <skill-name>
//   node ab-test.mjs stop <skill-name>

import { readFileSync, existsSync } from 'node:fs';
import { getDb, closeDb } from '../lib/db.mjs';
import { hashContent } from '../lib/hash.mjs';
import { discoverSkills, getSkillFileInfo } from '../lib/skill-detector.mjs';
import { recordVersion, getVersionContent } from './versioning.mjs';

function main() {
  const subCommand = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  if (!subCommand) {
    printUsage();
    return;
  }

  const db = getDb();

  try {
    switch (subCommand) {
      case 'start': startTest(db, arg1, arg2); break;
      case 'status': showStatus(db); break;
      case 'result': showResult(db, arg1); break;
      case 'stop': stopTest(db, arg1); break;
      default: printUsage();
    }
  } finally {
    closeDb();
  }
}

function printUsage() {
  console.log('Usage:');
  console.log('  /skill-ab start <skill-name> <path-to-version-b>');
  console.log('  /skill-ab status');
  console.log('  /skill-ab result <skill-name>');
  console.log('  /skill-ab stop <skill-name>');
}

function startTest(db, skillName, versionBPath) {
  if (!skillName || !versionBPath) {
    console.log('Usage: /skill-ab start <skill-name> <path-to-version-b>');
    return;
  }

  // Check no active test for this skill
  const existing = db.prepare(
    "SELECT id FROM ab_tests WHERE skill_name = ? AND status = 'running'"
  ).get(skillName);

  if (existing) {
    console.log(`A/B test already running for /${skillName}. Stop it first with: /skill-ab stop ${skillName}`);
    return;
  }

  // Get version A (current)
  const skills = discoverSkills();
  const skillDir = skills.get(skillName);
  if (!skillDir) {
    console.log(`Skill /${skillName} not found.`);
    return;
  }

  const infoA = getSkillFileInfo(skillDir);
  if (!infoA) {
    console.log(`Cannot read SKILL.md for /${skillName}.`);
    return;
  }

  // Read version B
  if (!existsSync(versionBPath)) {
    console.log(`Version B file not found: ${versionBPath}`);
    return;
  }

  const contentB = readFileSync(versionBPath, 'utf-8');
  const hashB = hashContent(contentB);

  if (infoA.hash === hashB) {
    console.log('Version A and B are identical. No test needed.');
    return;
  }

  // Record version B in skill_versions
  recordVersion(skillName, contentB);

  // Create A/B test
  db.prepare(`
    INSERT INTO ab_tests (skill_name, version_a_hash, version_b_hash, target_runs)
    VALUES (?, ?, ?, 20)
  `).run(skillName, infoA.hash, hashB);

  console.log(`A/B test started for /${skillName}!`);
  console.log(`  Version A: ${infoA.hash} (current, ${infoA.lineCount} lines)`);
  console.log(`  Version B: ${hashB} (${contentB.split('\n').length} lines)`);
  console.log(`  Target: 20 runs (10 per version)`);
  console.log('\nEach skill invocation will randomly use version A or B.');
}

function showStatus(db) {
  const tests = db.prepare(`
    SELECT
      at.skill_name, at.version_a_hash, at.version_b_hash,
      at.started_at, at.target_runs, at.status,
      (SELECT COUNT(*) FROM ab_runs ar WHERE ar.ab_test_id = at.id AND ar.assigned_version = 'a') as runs_a,
      (SELECT COUNT(*) FROM ab_runs ar WHERE ar.ab_test_id = at.id AND ar.assigned_version = 'b') as runs_b
    FROM ab_tests at
    WHERE at.status = 'running'
    ORDER BY at.started_at DESC
  `).all();

  if (tests.length === 0) {
    console.log('No active A/B tests.');
    return;
  }

  console.log('Active A/B tests:\n');
  for (const t of tests) {
    const totalRuns = t.runs_a + t.runs_b;
    const pct = Math.round((totalRuns / t.target_runs) * 100);
    console.log(`  /${t.skill_name}  ${totalRuns}/${t.target_runs} runs (${pct}%)  A:${t.runs_a} B:${t.runs_b}`);
    console.log(`    Started: ${t.started_at?.slice(0, 10)}`);
  }
}

function showResult(db, skillName) {
  if (!skillName) {
    console.log('Usage: /skill-ab result <skill-name>');
    return;
  }

  const test = db.prepare(`
    SELECT * FROM ab_tests
    WHERE skill_name = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(skillName);

  if (!test) {
    console.log(`No A/B test found for /${skillName}.`);
    return;
  }

  // Get metrics for each version
  const metricsA = getAbMetrics(db, test.id, 'a');
  const metricsB = getAbMetrics(db, test.id, 'b');

  console.log(`/${skillName} — A/B Test Results\n`);
  console.log(`  Status: ${test.status}`);
  console.log(`  Started: ${test.started_at?.slice(0, 10)}`);
  if (test.ended_at) console.log(`  Ended: ${test.ended_at?.slice(0, 10)}`);

  console.log(`\n  ${''.padEnd(22)} ${'Version A'.padStart(12)} ${'Version B'.padStart(12)}`);
  console.log(`  ${'Hash'.padEnd(22)} ${test.version_a_hash.slice(0, 12).padStart(12)} ${test.version_b_hash.slice(0, 12).padStart(12)}`);
  printRow('Runs', metricsA.runs, metricsB.runs);
  printRow('Satisfaction', `${metricsA.satRate}%`, `${metricsB.satRate}%`);
  printRow('Avg tokens', metricsA.avgTokens, metricsB.avgTokens);
  printRow('Correction rate', `${metricsA.corrRate}%`, `${metricsB.corrRate}%`);
  printRow('Avg duration', `${metricsA.avgDuration}s`, `${metricsB.avgDuration}s`);

  // Recommendation
  const totalRuns = metricsA.runs + metricsB.runs;
  if (totalRuns < test.target_runs) {
    console.log(`\n  Note: Only ${totalRuns}/${test.target_runs} runs completed. Results may not be statistically significant.`);
  }

  if (metricsA.satRate !== metricsB.satRate) {
    const winner = metricsA.satRate > metricsB.satRate ? 'A' : 'B';
    const winnerHash = winner === 'A' ? test.version_a_hash : test.version_b_hash;
    console.log(`\n  Suggestion: Version ${winner} (${winnerHash.slice(0, 8)}) has higher satisfaction.`);
  }
}

function stopTest(db, skillName) {
  if (!skillName) {
    console.log('Usage: /skill-ab stop <skill-name>');
    return;
  }

  const result = db.prepare(`
    UPDATE ab_tests SET status = 'cancelled', ended_at = datetime('now')
    WHERE skill_name = ? AND status = 'running'
  `).run(skillName);

  if (result.changes > 0) {
    console.log(`A/B test stopped for /${skillName}. Use /skill-ab result ${skillName} to see collected data.`);
  } else {
    console.log(`No active A/B test found for /${skillName}.`);
  }
}

function getAbMetrics(db, testId, version) {
  const row = db.prepare(`
    SELECT
      COUNT(sr.id) as runs,
      AVG(sr.tokens_used) as avg_tokens,
      AVG(sr.duration_ms) as avg_duration_ms,
      SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied,
      SUM(CASE WHEN r.reaction_type = 'correction' THEN 1 ELSE 0 END) as corrections,
      COUNT(r.id) as total_reactions
    FROM ab_runs abr
    JOIN skill_runs sr ON sr.id = abr.skill_run_id
    LEFT JOIN reactions r ON r.skill_run_id = sr.id
    WHERE abr.ab_test_id = ? AND abr.assigned_version = ? AND sr.completed = 1
  `).get(testId, version);

  return {
    runs: row?.runs || 0,
    avgTokens: Math.round(row?.avg_tokens || 0),
    avgDuration: Math.round((row?.avg_duration_ms || 0) / 1000),
    satRate: row?.total_reactions > 0 ? Math.round((row.satisfied / row.total_reactions) * 100) : 0,
    corrRate: row?.total_reactions > 0 ? Math.round((row.corrections / row.total_reactions) * 100) : 0,
  };
}

function printRow(label, valA, valB) {
  console.log(`  ${label.padEnd(22)} ${String(valA).padStart(12)} ${String(valB).padStart(12)}`);
}

main();

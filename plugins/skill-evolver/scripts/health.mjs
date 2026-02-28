#!/usr/bin/env node
// /skill-health command — health check with alerts and possible causes
// Usage: node health.mjs [skill-name]

import { getDb, closeDb } from '../lib/db.mjs';
import { calculateTrends } from '../lib/trends.mjs';

// Health thresholds
const THRESHOLDS = {
  satisfactionDrop: 15,   // alert if satisfaction drops > 15%
  tokenCreep: 30,         // alert if tokens increase > 30% from baseline
  cancelRate: 10,         // alert if cancel rate > 10%
  correctionRate: 25,     // alert if correction rate > 25%
};

function main() {
  const skillName = process.argv[2] || null;
  const db = getDb();

  try {
    if (skillName) {
      printSkillHealth(db, skillName);
    } else {
      printAllHealth(db);
    }
  } finally {
    closeDb();
  }
}

function printAllHealth(db) {
  const skills = db.prepare(`
    SELECT DISTINCT skill_name FROM skill_runs
    WHERE completed = 1 AND triggered_at >= datetime('now', '-28 days')
    ORDER BY skill_name
  `).all();

  if (skills.length === 0) {
    console.log('No skill data in the last 28 days.');
    return;
  }

  console.log('Skill Health Report\n');

  let hasIssues = false;
  for (const { skill_name } of skills) {
    const issues = checkHealth(db, skill_name);
    const status = issues.length === 0 ? 'OK' : 'WARN';
    const icon = issues.length === 0 ? '+' : '!';

    console.log(`  [${icon}] /${skill_name}: ${status}`);
    for (const issue of issues) {
      console.log(`      ${issue.message}`);
      hasIssues = true;
    }
  }

  if (!hasIssues) {
    console.log('\n  All skills healthy!');
  }
}

function printSkillHealth(db, skillName) {
  const issues = checkHealth(db, skillName);

  console.log(`/${skillName} — Health Check\n`);

  if (issues.length === 0) {
    console.log('  Status: HEALTHY\n  No issues detected.');
    return;
  }

  console.log(`  Status: ${issues.some(i => i.severity === 'alert') ? 'ALERT' : 'WARNING'}\n`);

  for (const issue of issues) {
    const icon = issue.severity === 'alert' ? '!!' : '!';
    console.log(`  [${icon}] ${issue.metric}`);
    console.log(`      ${issue.message}`);
    if (issue.cause) {
      console.log(`      Possible cause: ${issue.cause}`);
    }
    console.log();
  }
}

function checkHealth(db, skillName) {
  const issues = [];
  const trends = calculateTrends(db, skillName);

  if (!trends) return issues;

  // 1. Satisfaction drop
  if (trends.satisfaction.direction === 'down' &&
      Math.abs(trends.satisfaction.delta) > THRESHOLDS.satisfactionDrop) {
    issues.push({
      metric: 'Satisfaction Trend',
      severity: 'alert',
      message: `Satisfaction dropped ${Math.abs(trends.satisfaction.delta)}% (${trends.raw.prev.total_reactions > 0 ? Math.round((trends.raw.prev.satisfied / trends.raw.prev.total_reactions) * 100) : 0}% -> ${trends.raw.curr.total_reactions > 0 ? Math.round((trends.raw.curr.satisfied / trends.raw.curr.total_reactions) * 100) : 0}%)`,
      cause: 'Skill instructions may be outdated or too complex. Check /skill-corrections for patterns.',
    });
  }

  // 2. Token creep
  const baselineTokens = getBaselineTokens(db, skillName);
  const currTokens = Math.round(trends.raw.curr.avg_tokens || 0);
  if (baselineTokens > 0 && currTokens > baselineTokens * (1 + THRESHOLDS.tokenCreep / 100)) {
    const pctIncrease = Math.round(((currTokens - baselineTokens) / baselineTokens) * 100);
    issues.push({
      metric: 'Token Creep',
      severity: 'warning',
      message: `Avg tokens increased ${pctIncrease}% from baseline (${baselineTokens} -> ${currTokens})`,
      cause: 'Skill may have grown too complex. Consider splitting or simplifying instructions.',
    });
  }

  // 3. Cancel rate
  const cancelRate = trends.raw.curr.total_reactions > 0
    ? (trends.raw.curr.cancels / trends.raw.curr.total_reactions) * 100 : 0;
  if (cancelRate > THRESHOLDS.cancelRate) {
    issues.push({
      metric: 'Cancel Rate',
      severity: 'warning',
      message: `Cancel rate is ${Math.round(cancelRate)}% (threshold: ${THRESHOLDS.cancelRate}%)`,
      cause: 'Skill may be triggering in wrong context or running too slowly.',
    });
  }

  // 4. Correction rate
  const corrRate = trends.raw.curr.total_reactions > 0
    ? (trends.raw.curr.corrections / trends.raw.curr.total_reactions) * 100 : 0;
  if (corrRate > THRESHOLDS.correctionRate) {
    issues.push({
      metric: 'Correction Rate',
      severity: 'alert',
      message: `Correction rate is ${Math.round(corrRate)}% (threshold: ${THRESHOLDS.correctionRate}%)`,
      cause: 'Skill output frequently wrong. Check /skill-corrections for specific patterns.',
    });
  }

  // 5. Model change detection
  const modelChange = detectModelChange(db, skillName);
  if (modelChange) {
    issues.push({
      metric: 'Model Change',
      severity: 'warning',
      message: `Model changed: ${modelChange.from} -> ${modelChange.to}`,
      cause: 'Model upgrades can change skill behavior. Monitor satisfaction after model switches.',
    });
  }

  // 6. Skill file change
  const versionChange = detectVersionChange(db, skillName);
  if (versionChange) {
    issues.push({
      metric: 'Skill File Changed',
      severity: 'warning',
      message: `SKILL.md changed on ${versionChange.date} (${versionChange.lineDelta} lines)`,
      cause: 'Recent edit may have affected quality. Compare with /skill-history.',
    });
  }

  return issues;
}

function getBaselineTokens(db, skillName) {
  const row = db.prepare(`
    SELECT baseline_avg_tokens FROM guard_configs WHERE skill_name = ?
  `).get(skillName);
  return row?.baseline_avg_tokens || 0;
}

function detectModelChange(db, skillName) {
  const rows = db.prepare(`
    SELECT DISTINCT model FROM skill_runs
    WHERE skill_name = ? AND completed = 1 AND model IS NOT NULL
      AND triggered_at >= datetime('now', '-14 days')
    ORDER BY triggered_at DESC
    LIMIT 2
  `).all(skillName);

  if (rows.length < 2) return null;
  return { from: rows[1].model, to: rows[0].model };
}

function detectVersionChange(db, skillName) {
  const rows = db.prepare(`
    SELECT version_hash, created_at, line_count FROM skill_versions
    WHERE skill_name = ?
    ORDER BY created_at DESC
    LIMIT 2
  `).all(skillName);

  if (rows.length < 2) return null;
  // Only report if change was in last 14 days
  const changeDate = new Date(rows[0].created_at + 'Z');
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
  if (changeDate < twoWeeksAgo) return null;

  return {
    date: rows[0].created_at?.slice(0, 10),
    lineDelta: `${rows[0].line_count - rows[1].line_count >= 0 ? '+' : ''}${rows[0].line_count - rows[1].line_count}`,
  };
}

main();

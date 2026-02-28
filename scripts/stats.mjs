#!/usr/bin/env node
// /skill-stats command — generate usage analytics
// Usage: node stats.mjs [skill-name]

import { getDb, closeDb } from '../lib/db.mjs';
import { calculateTrends } from '../lib/trends.mjs';

const DAYS = 30;
const TOP_N = 5;

function main() {
  const skillName = process.argv[2] || null;
  const db = getDb();

  try {
    if (skillName) {
      printSkillDetail(db, skillName);
    } else {
      printOverview(db);
    }
  } finally {
    closeDb();
  }
}

function printOverview(db) {
  // Parameterized query — DAYS is hardcoded constant, safe but using param for consistency
  const dateThreshold = `-${DAYS} days`;
  const rows = db.prepare(`
    SELECT
      sr.skill_name,
      COUNT(*) as runs,
      AVG(sr.tokens_used) as avg_tokens,
      SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied_count,
      COUNT(r.id) as reaction_count
    FROM skill_runs sr
    LEFT JOIN reactions r ON r.skill_run_id = sr.id
    WHERE sr.completed = 1
      AND sr.triggered_at >= datetime('now', ?)
    GROUP BY sr.skill_name
    ORDER BY runs DESC
    LIMIT ?
  `).all(dateThreshold, TOP_N);

  if (rows.length === 0) {
    console.log('No skill usage data yet. Use some skills and check back!');
    return;
  }

  console.log(`Top ${Math.min(rows.length, TOP_N)} skills by usage (last ${DAYS} days):\n`);

  for (const row of rows) {
    const satRate = row.reaction_count > 0
      ? Math.round((row.satisfied_count / row.reaction_count) * 100)
      : 0;
    const avgTokens = Math.round(row.avg_tokens || 0);

    console.log(
      `  /${padRight(row.skill_name, 18)} ${padLeft(row.runs, 4)} runs   ` +
      `${padLeft(satRate, 3)}% satisfied   ${padLeft(fmtNum(avgTokens), 6)} avg tokens`
    );
  }

  // Print alerts
  const alerts = getAlerts(db);
  if (alerts.length > 0) {
    console.log('\nAlerts:');
    for (const alert of alerts) {
      console.log(`  ${alert}`);
    }
  }
}

function printSkillDetail(db, skillName) {
  const dateThreshold = `-${DAYS} days`;

  const basic = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN trigger_type = 'explicit' THEN 1 ELSE 0 END) as explicit_runs,
      SUM(CASE WHEN trigger_type = 'auto' THEN 1 ELSE 0 END) as auto_runs,
      AVG(tokens_used) as avg_tokens,
      AVG(duration_ms) as avg_duration_ms
    FROM skill_runs
    WHERE skill_name = ? AND completed = 1
      AND triggered_at >= datetime('now', ?)
  `).get(skillName, dateThreshold);

  if (!basic || basic.total_runs === 0) {
    console.log(`No data for /${skillName} in the last ${DAYS} days.`);
    return;
  }

  const reactions = db.prepare(`
    SELECT r.reaction_type, COUNT(*) as count
    FROM reactions r
    JOIN skill_runs sr ON sr.id = r.skill_run_id
    WHERE sr.skill_name = ? AND sr.completed = 1
      AND sr.triggered_at >= datetime('now', ?)
    GROUP BY r.reaction_type
  `).all(skillName, dateThreshold);

  const reactionMap = {};
  let totalReactions = 0;
  for (const r of reactions) {
    reactionMap[r.reaction_type] = r.count;
    totalReactions += r.count;
  }

  // Use shared trends lib
  const trends = calculateTrends(db, skillName);

  const explicitPct = Math.round((basic.explicit_runs / basic.total_runs) * 100);
  const autoPct = 100 - explicitPct;
  const avgTokens = Math.round(basic.avg_tokens || 0);
  const avgDurationSec = Math.round((basic.avg_duration_ms || 0) / 1000);

  console.log(`/${skillName} — Last ${DAYS} days\n`);
  console.log(`  Invocations:        ${basic.total_runs}`);
  console.log(`  Explicit (/${skillName}): ${basic.explicit_runs} (${explicitPct}%)`);
  console.log(`  Auto-triggered:     ${basic.auto_runs} (${autoPct}%)`);

  console.log('\n  -- Reactions ----');
  printReactionLine('Satisfied', reactionMap.satisfied, totalReactions);
  printReactionLine('Correction needed', reactionMap.correction, totalReactions);
  printReactionLine('Follow-up needed', reactionMap.follow_up, totalReactions);
  printReactionLine('Retry', reactionMap.retry, totalReactions);
  printReactionLine('Cancelled', reactionMap.cancel, totalReactions);
  printReactionLine('Neutral', reactionMap.neutral, totalReactions);

  console.log('\n  -- Cost ----');
  console.log(`  Avg tokens:         ${fmtNum(avgTokens)}`);
  console.log(`  Avg duration:       ${avgDurationSec}s`);
  const estCost = estimateCost(avgTokens);
  console.log(`  Est. cost/run:      $${estCost.toFixed(2)}`);
  console.log(`  Monthly total:      $${(estCost * basic.total_runs).toFixed(2)}`);

  if (trends) {
    const sat = trends.satisfaction;
    const tok = trends.tokens;
    console.log('\n  -- Trends ----');
    console.log(`  Satisfaction: ${sat.delta >= 0 ? '+' : ''}${sat.delta}% (${sat.direction})`);
    console.log(`  Tokens: ${fmtNum(tok.delta >= 0 ? tok.delta : tok.delta)} (${tok.direction})`);
  }
}

function getAlerts(db) {
  const alerts = [];
  const skills = db.prepare(`
    SELECT DISTINCT skill_name FROM skill_runs
    WHERE completed = 1 AND triggered_at >= datetime('now', '-28 days')
  `).all();

  for (const { skill_name } of skills) {
    const trends = calculateTrends(db, skill_name);
    if (!trends) continue;

    if (trends.satisfaction.direction === 'down' && Math.abs(trends.satisfaction.delta) > 15) {
      alerts.push(`/${skill_name} — satisfaction dropping (${trends.satisfaction.pctChange}% in 2 weeks)`);
    }

    const avgTokens = Math.round(trends.raw.curr.avg_tokens || 0);
    if (avgTokens > 5000) {
      alerts.push(`/${skill_name} — high token usage (${fmtNum(avgTokens)} avg, consider optimizing)`);
    }
  }

  return alerts;
}

function printReactionLine(label, count, total) {
  const c = count || 0;
  const pct = total > 0 ? Math.round((c / total) * 100) : 0;
  console.log(`  ${padRight(label + ':', 22)} ${padLeft(c, 4)} (${pct}%)`);
}

function estimateCost(tokens) {
  const inputTokens = tokens * 0.7;
  const outputTokens = tokens * 0.3;
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

function padRight(str, len) { return String(str).padEnd(len); }
function padLeft(str, len) { return String(str).padStart(len); }
function fmtNum(n) { return n.toLocaleString('en-US'); }

main();

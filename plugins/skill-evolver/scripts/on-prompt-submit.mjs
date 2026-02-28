#!/usr/bin/env node
// UserPromptSubmit hook handler
// Three jobs per invocation:
// 1. Clean up orphaned incomplete runs
// 2. Classify reaction for the PREVIOUS skill run (if any pending)
// 3. Start tracking a NEW skill run (if prompt invokes a skill)
//    + Handle A/B test version assignment

import { getDb, closeDb } from '../lib/db.mjs';
import { detectSkillFromPrompt, discoverSkills, getSkillFileInfo, discoverOwnSkills } from '../lib/skill-detector.mjs';
import { classifyReaction } from '../lib/reaction-patterns.mjs';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const sessionId = data.session_id || data.sessionId || 'unknown';
  const prompt = data.prompt || data.message || '';
  if (!prompt) process.exit(0);

  const db = getDb();

  try {
    // Job 0: Mark orphaned incomplete runs as completed (H1 fix)
    cleanOrphanedRuns(db, sessionId);

    // Job 1: Classify reaction for previous completed run
    classifyPreviousRun(db, sessionId, prompt);

    // Job 2: Detect and track new skill invocation
    trackNewInvocation(db, sessionId, prompt);
  } finally {
    closeDb();
  }
}

/** Mark stale incomplete runs as completed to prevent accumulation (H1) */
function cleanOrphanedRuns(db, sessionId) {
  // Any incomplete run older than 5 minutes is considered orphaned
  db.prepare(`
    UPDATE skill_runs SET completed = 1
    WHERE session_id = ? AND completed = 0
      AND triggered_at < datetime('now', '-5 minutes')
  `).run(sessionId);
}

function classifyPreviousRun(db, sessionId, prompt) {
  const lastRun = db.prepare(`
    SELECT sr.id, sr.skill_name, sr.triggered_at
    FROM skill_runs sr
    LEFT JOIN reactions r ON r.skill_run_id = sr.id
    WHERE sr.session_id = ? AND sr.completed = 1 AND r.id IS NULL
    ORDER BY sr.triggered_at DESC
    LIMIT 1
  `).get(sessionId);

  if (!lastRun) return;

  const triggeredAt = new Date(lastRun.triggered_at + 'Z').getTime();
  const timeSince = Date.now() - triggeredAt;

  const reactionType = classifyReaction(prompt, lastRun.skill_name, timeSince);

  db.prepare(`
    INSERT INTO reactions (skill_run_id, reaction_type, user_message, time_after_skill_ms)
    VALUES (?, ?, ?, ?)
  `).run(
    lastRun.id,
    reactionType,
    (reactionType === 'correction' || reactionType === 'follow_up') ? prompt.slice(0, 2000) : null,
    timeSince
  );
}

function trackNewInvocation(db, sessionId, prompt) {
  const detected = detectSkillFromPrompt(prompt);
  if (!detected) return;

  const { skillName, namespace, args, triggerType } = detected;

  // Skip tracking plugin's own skills (e.g., /skill-evolver:skill-stats, /skill-stats)
  const ownSkills = discoverOwnSkills();
  if (namespace === 'skill-evolver' || ownSkills.has(skillName)) return;

  const skills = discoverSkills();
  const skillDir = skills.get(skillName);
  let versionHash = null;

  if (skillDir) {
    const info = getSkillFileInfo(skillDir);
    if (info) versionHash = info.hash;
  }

  // Insert the new run
  const result = db.prepare(`
    INSERT INTO skill_runs (skill_name, session_id, trigger_type, arguments, skill_version_hash, completed)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(skillName, sessionId, triggerType, args || null, versionHash);

  // H3 fix: Handle A/B test assignment
  assignAbVersion(db, skillName, result.lastInsertRowid);
}

/** Assign A/B test version if there's an active test for this skill (H3) */
function assignAbVersion(db, skillName, runId) {
  const activeTest = db.prepare(
    "SELECT id, version_a_hash, version_b_hash, target_runs FROM ab_tests WHERE skill_name = ? AND status = 'running'"
  ).get(skillName);

  if (!activeTest) return;

  // Check if target runs reached
  const runCount = db.prepare(
    'SELECT COUNT(*) as count FROM ab_runs WHERE ab_test_id = ?'
  ).get(activeTest.id);

  if (runCount.count >= activeTest.target_runs) {
    // Auto-complete the test
    db.prepare(
      "UPDATE ab_tests SET status = 'completed', ended_at = datetime('now') WHERE id = ?"
    ).run(activeTest.id);
    return;
  }

  // Random 50/50 assignment
  const version = Math.random() < 0.5 ? 'a' : 'b';

  db.prepare(
    'INSERT INTO ab_runs (ab_test_id, skill_run_id, assigned_version) VALUES (?, ?, ?)'
  ).run(activeTest.id, runId, version);

  // Update skill_run's version hash to the assigned version
  const assignedHash = version === 'a' ? activeTest.version_a_hash : activeTest.version_b_hash;
  db.prepare(
    'UPDATE skill_runs SET skill_version_hash = ? WHERE id = ?'
  ).run(assignedHash, runId);
}

main().catch(() => process.exit(0));

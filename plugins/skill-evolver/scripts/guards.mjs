// Skill guards — validate SKILL.md changes against drift thresholds
// Returns warnings (never blocks)

import { getDb } from '../lib/db.mjs';
import { getBaselineVersion } from './versioning.mjs';

const DEFAULT_LIMITS = {
  maxLines: 500,
  maxLineDriftPct: 0.3,
  maxStepDrift: 3,
  maxDescriptionLength: 200,
};

/**
 * Run all guards on a skill's current content.
 * @param {string} skillName
 * @param {string} content - Current SKILL.md content
 * @returns {{ level: 'warning'|'alert', guard: string, message: string }[]}
 */
export function runGuards(skillName, content) {
  const warnings = [];
  const lines = content.split('\n');
  const lineCount = lines.length;

  // Load custom config or use defaults
  const config = getGuardConfig(skillName);

  // Guard 1: Absolute line limit
  if (lineCount > DEFAULT_LIMITS.maxLines) {
    warnings.push({
      level: 'warning',
      guard: 'line-limit',
      message: `SKILL.md has ${lineCount} lines (limit: ${DEFAULT_LIMITS.maxLines})`,
    });
  }

  // Guard 2: Line drift from baseline
  const baseline = getBaselineVersion(skillName);
  if (baseline) {
    const drift = (lineCount - baseline.line_count) / baseline.line_count;
    const maxDrift = config?.max_line_drift_pct || DEFAULT_LIMITS.maxLineDriftPct;
    if (drift > maxDrift) {
      const pct = Math.round(drift * 100);
      warnings.push({
        level: 'warning',
        guard: 'line-drift',
        message: `SKILL.md grew ${pct}% from baseline (${baseline.line_count} -> ${lineCount}, threshold: ${Math.round(maxDrift * 100)}%)`,
      });
    }

    // Guard 4: Step count drift (uses baseline from guard_configs)
    if (config?.baseline_step_count) {
      const currentSteps = countSteps(content);
      const stepDiff = Math.abs(currentSteps - config.baseline_step_count);
      const maxStepDrift = config.max_step_drift || DEFAULT_LIMITS.maxStepDrift;
      if (stepDiff > maxStepDrift) {
        warnings.push({
          level: 'warning',
          guard: 'step-count-drift',
          message: `Step count changed by ${stepDiff} (baseline: ${config.baseline_step_count}, current: ${currentSteps}, threshold: ±${maxStepDrift})`,
        });
      }
    }
  }

  // Guard 5: Description length
  const description = extractDescription(content);
  if (description && description.length > DEFAULT_LIMITS.maxDescriptionLength) {
    warnings.push({
      level: 'warning',
      guard: 'description-length',
      message: `Description is ${description.length} chars (limit: ${DEFAULT_LIMITS.maxDescriptionLength})`,
    });
  }

  // Guard 3: Token budget (from guard_configs)
  if (config?.baseline_avg_tokens) {
    const db = getDb();
    const recent = db.prepare(`
      SELECT AVG(tokens_used) as avg_tokens FROM skill_runs
      WHERE skill_name = ? AND completed = 1
        AND triggered_at >= datetime('now', '-14 days')
    `).get(skillName);

    if (recent?.avg_tokens) {
      const maxDrift = config.max_token_drift_pct || DEFAULT_LIMITS.maxLineDriftPct;
      const drift = (recent.avg_tokens - config.baseline_avg_tokens) / config.baseline_avg_tokens;
      if (drift > maxDrift) {
        warnings.push({
          level: 'alert',
          guard: 'token-budget',
          message: `Avg tokens ${Math.round(recent.avg_tokens)} exceeds ${Math.round(maxDrift * 100)}% above baseline (${config.baseline_avg_tokens})`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Initialize or update guard baseline config for a skill.
 */
export function initGuardBaseline(skillName, content, avgTokens = null) {
  const db = getDb();
  const lineCount = content.split('\n').length;
  const stepCount = countSteps(content);

  db.prepare(`
    INSERT INTO guard_configs (skill_name, baseline_line_count, baseline_avg_tokens, baseline_step_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(skill_name) DO UPDATE SET
      baseline_line_count = COALESCE(excluded.baseline_line_count, baseline_line_count),
      baseline_avg_tokens = COALESCE(excluded.baseline_avg_tokens, baseline_avg_tokens),
      baseline_step_count = COALESCE(excluded.baseline_step_count, baseline_step_count)
  `).run(skillName, lineCount, avgTokens, stepCount);
}

function getGuardConfig(skillName) {
  const db = getDb();
  return db.prepare('SELECT * FROM guard_configs WHERE skill_name = ?').get(skillName) || null;
}

/** Count numbered steps and checkbox items in content */
function countSteps(content) {
  const numbered = (content.match(/^\d+\.\s/gm) || []).length;
  const checkboxes = (content.match(/^- \[[ x]\]/gm) || []).length;
  return numbered + checkboxes;
}

/** Extract description from YAML frontmatter */
function extractDescription(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const descMatch = match[1].match(/description:\s*(.+)/);
  return descMatch ? descMatch[1].trim() : null;
}

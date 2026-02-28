// Version tracking logic for SKILL.md files
// Stores snapshots with content, hash, line count, parent linkage

import { getDb } from '../lib/db.mjs';
import { hashContent } from '../lib/hash.mjs';

/**
 * Record a new version of a skill's SKILL.md if content changed.
 * @param {string} skillName
 * @param {string} content - Full SKILL.md content
 * @returns {{ isNew: boolean, versionHash: string, lineCount: number }}
 */
export function recordVersion(skillName, content) {
  const db = getDb();
  const versionHash = hashContent(content);
  const lineCount = content.split('\n').length;

  // Check if this hash already exists
  const existing = db.prepare(
    'SELECT id FROM skill_versions WHERE version_hash = ?'
  ).get(versionHash);

  if (existing) {
    return { isNew: false, versionHash, lineCount };
  }

  // Find parent version (most recent for this skill)
  const parent = db.prepare(
    'SELECT id FROM skill_versions WHERE skill_name = ? ORDER BY created_at DESC LIMIT 1'
  ).get(skillName);

  db.prepare(`
    INSERT INTO skill_versions (skill_name, version_hash, content, line_count, parent_version_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(skillName, versionHash, content, lineCount, parent?.id || null);

  return { isNew: true, versionHash, lineCount };
}

/**
 * Get all versions for a skill, ordered newest first.
 * @param {string} skillName
 * @returns {{ id, version_hash, line_count, created_at, parent_version_id }[]}
 */
export function getVersions(skillName) {
  const db = getDb();
  return db.prepare(`
    SELECT id, version_hash, line_count, created_at, parent_version_id
    FROM skill_versions
    WHERE skill_name = ?
    ORDER BY created_at DESC
  `).all(skillName);
}

/**
 * Get full content of a specific version by hash.
 * @param {string} versionHash
 * @param {string} [skillName] - Optional skill name filter to prevent cross-skill leaks
 * @returns {{ content, line_count, created_at } | null}
 */
export function getVersionContent(versionHash, skillName) {
  const db = getDb();
  if (skillName) {
    return db.prepare(
      'SELECT content, line_count, created_at FROM skill_versions WHERE version_hash = ? AND skill_name = ?'
    ).get(versionHash, skillName) || null;
  }
  return db.prepare(
    'SELECT content, line_count, created_at FROM skill_versions WHERE version_hash = ?'
  ).get(versionHash) || null;
}

/**
 * Get the first (baseline) version of a skill.
 * @param {string} skillName
 * @returns {{ id, version_hash, line_count, created_at } | null}
 */
export function getBaselineVersion(skillName) {
  const db = getDb();
  return db.prepare(`
    SELECT id, version_hash, line_count, created_at
    FROM skill_versions
    WHERE skill_name = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(skillName) || null;
}

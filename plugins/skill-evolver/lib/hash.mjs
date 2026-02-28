// SHA-256 content hashing for SKILL.md version tracking
import { createHash } from 'node:crypto';

/**
 * Hash content string using SHA-256, return first 16 hex chars.
 * Short hash is sufficient for version comparison — collision risk negligible.
 */
export function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

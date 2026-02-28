// Detect skill invocation from user prompt text
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from './hash.mjs';

// Regex: prompt starts with /[namespace:]skill-name, optionally followed by args
// Handles: /cook, /ck:code-review, /skill-evolver:skill-stats
const EXPLICIT_CMD_RE = /^\/(?:([\w-]+):)?([\w-]+)(?:\s+(.*))?$/s;

/**
 * Detect if user prompt invokes a skill explicitly via /command.
 * Returns { skillName, namespace, args, triggerType } or null if no skill detected.
 */
export function detectSkillFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const trimmed = prompt.trim();
  const match = trimmed.match(EXPLICIT_CMD_RE);
  if (!match) return null;

  const namespace = match[1] || null;
  const skillName = match[2];
  const args = match[3]?.trim() || '';

  return { skillName, namespace, args, triggerType: 'explicit' };
}

/**
 * Discover all installed skills by scanning known skill directories.
 * Returns Map<skillName, skillDirPath>.
 */
export function discoverSkills() {
  const skills = new Map();
  const searchPaths = [
    join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'skills'),
  ];

  // Also check project-level skills if CWD has .claude/skills
  const projectSkills = join(process.cwd(), '.claude', 'skills');
  if (existsSync(projectSkills)) {
    searchPaths.push(projectSkills);
  }

  for (const basePath of searchPaths) {
    if (!existsSync(basePath)) continue;
    try {
      const entries = readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = join(basePath, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          skills.set(entry.name, join(basePath, entry.name));
        }
      }
    } catch { /* ignore read errors */ }
  }

  return skills;
}

/**
 * Read SKILL.md content and compute its hash.
 * Returns { content, hash, lineCount } or null if not found.
 */
export function getSkillFileInfo(skillDirPath) {
  const skillMd = join(skillDirPath, 'SKILL.md');
  if (!existsSync(skillMd)) return null;

  try {
    const content = readFileSync(skillMd, 'utf-8');
    return {
      content,
      hash: hashContent(content),
      lineCount: content.split('\n').length,
    };
  } catch { return null; }
}

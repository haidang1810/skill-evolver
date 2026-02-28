#!/usr/bin/env node
// /skill-rollback command — rollback SKILL.md to a previous version
// Usage: node rollback.mjs <skill-name> [version-hash]

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, closeDb } from '../lib/db.mjs';
import { getVersions, getVersionContent } from './versioning.mjs';
import { discoverSkills } from '../lib/skill-detector.mjs';

function main() {
  const skillName = process.argv[2];
  const targetHash = process.argv[3];

  if (!skillName) {
    console.log('Usage: /skill-rollback <skill-name> [version-hash]');
    return;
  }

  const db = getDb();

  try {
    const versions = getVersions(skillName);
    if (versions.length < 2) {
      console.log(`/${skillName} has ${versions.length} version(s). Need at least 2 to rollback.`);
      return;
    }

    if (!targetHash) {
      // List versions for user to choose
      console.log(`/${skillName} versions (newest first):\n`);
      const ordered = [...versions];
      for (let i = 0; i < ordered.length; i++) {
        const v = ordered[i];
        const current = i === 0 ? ' (current)' : '';
        console.log(`  ${v.version_hash}  ${v.created_at?.slice(0, 10)}  ${v.line_count} lines${current}`);
      }
      console.log(`\nTo rollback: /skill-rollback ${skillName} <version-hash>`);
      return;
    }

    // Find target version — filter by skillName to prevent cross-skill leaks
    const target = getVersionContent(targetHash, skillName);
    if (!target) {
      console.log(`Version ${targetHash} not found for /${skillName}.`);
      return;
    }

    // Find the skill's SKILL.md path
    const skills = discoverSkills();
    const skillDir = skills.get(skillName);
    if (!skillDir) {
      console.log(`Skill /${skillName} not found in skill directories.`);
      return;
    }

    // Write the old content back
    const skillMdPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillMdPath, target.content, 'utf-8');

    console.log(`Rolled back /${skillName} to version ${targetHash} (${target.created_at?.slice(0, 10)}, ${target.line_count} lines).`);
  } finally {
    closeDb();
  }
}

main();

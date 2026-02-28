#!/usr/bin/env node
// ConfigChange hook handler
// Detects SKILL.md changes → record version + run guards

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { getDb, closeDb } from '../lib/db.mjs';
import { recordVersion } from './versioning.mjs';
import { runGuards, initGuardBaseline } from './guards.mjs';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  // ConfigChange provides file path of the changed config
  const filePath = data.file_path || data.filePath || '';
  if (!filePath || !filePath.endsWith('SKILL.md')) process.exit(0);

  // Extract skill name from directory structure: .../skills/<skill-name>/SKILL.md
  const skillDir = dirname(filePath);
  const skillName = basename(skillDir);
  if (!skillName) process.exit(0);

  if (!existsSync(filePath)) process.exit(0);

  const content = readFileSync(filePath, 'utf-8');
  const db = getDb();

  try {
    // Record version if content changed
    const result = recordVersion(skillName, content);

    if (result.isNew) {
      // Initialize guard baseline if this is the first version
      const versions = db.prepare(
        'SELECT COUNT(*) as count FROM skill_versions WHERE skill_name = ?'
      ).get(skillName);

      if (versions.count === 1) {
        // First version — set as baseline
        initGuardBaseline(skillName, content);
      }

      // Run guards and output warnings to stderr
      const warnings = runGuards(skillName, content);
      for (const w of warnings) {
        const prefix = w.level === 'alert' ? '!!' : '!';
        process.stderr.write(`[skill-evolver] [${prefix}] ${w.guard}: ${w.message}\n`);
      }
    }
  } finally {
    closeDb();
  }
}

main().catch(() => process.exit(0));

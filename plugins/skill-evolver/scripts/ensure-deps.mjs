#!/usr/bin/env node
// Auto-install dependencies on first run if node_modules is missing
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
const nodeModules = join(pluginRoot, 'node_modules', 'better-sqlite3');

if (!existsSync(nodeModules)) {
  try {
    execSync('npm install --production', { cwd: pluginRoot, stdio: 'ignore', timeout: 60000 });
  } catch { /* silent fail — will retry next session */ }
}

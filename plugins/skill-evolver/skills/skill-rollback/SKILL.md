---
name: skill-rollback
description: Rollback a skill's SKILL.md to a previous version. Lists available versions with hashes and dates. Restores content from the selected version.
version: 0.1.0
argument-hint: "<skill-name> [version-hash]"
---

# Skill Rollback

Rollback a skill to a previous version. Without a version hash, lists available versions. With a hash, restores that version.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/rollback.mjs $ARGUMENTS
```

Display the output exactly as returned. If the user selects a version, run the command again with the version hash.

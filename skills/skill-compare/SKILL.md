---
name: skill-compare
description: Compare two versions of a skill side-by-side. Shows metrics diff (satisfaction, tokens, corrections) and line-level changes between versions.
version: 0.1.0
argument-hint: "<skill-name> [hash-a] [hash-b]"
---

# Skill Compare

Compare two versions of a skill. Without hashes, compares the latest two versions.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/compare.mjs $ARGUMENTS
```

Display the output exactly as returned. Do not modify or summarize.

---
name: skill-health
description: Health check for Claude Code skills. Detects satisfaction drops, token creep, high cancel/correction rates, model changes, and skill file changes.
version: 0.1.0
argument-hint: "[skill-name]"
---

# Skill Health

Run health checks on skills. Without arguments checks all skills. With a skill name shows detailed health report.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs $ARGUMENTS
```

Display the output exactly as returned. Do not modify or summarize.

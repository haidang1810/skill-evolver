---
name: skill-stats
description: Show analytics and usage statistics for Claude Code skills. Displays top skills by usage, satisfaction rates, token consumption, cost estimates, and trend alerts.
version: 0.1.0
argument-hint: "[skill-name]"
---

# Skill Stats

Show skill usage analytics. Without arguments shows overview of all skills. With a skill name shows detailed stats.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/stats.mjs $ARGUMENTS
```

Display the output exactly as returned. Do not modify or summarize the statistics.

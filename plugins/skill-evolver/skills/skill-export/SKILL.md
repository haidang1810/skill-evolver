---
name: skill-export
description: Export skill usage data to CSV or JSON format. Includes run metrics, reactions, and version hashes for external analysis.
version: 0.1.0
argument-hint: "<skill-name> [--format csv|json] [--days 30]"
---

# Skill Export

Export skill usage data for external analysis.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs $ARGUMENTS
```

Display the output exactly as returned. For large datasets, suggest the user redirect output to a file.

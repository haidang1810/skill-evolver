---
name: skill-ab
description: A/B test two versions of a skill. Start tests, check status, view results comparing satisfaction, tokens, and correction rates between versions.
version: 0.1.0
argument-hint: "start|status|result|stop <skill-name> [version-b-path]"
---

# Skill A/B Test

Manage A/B tests for skills. Compare two versions using real usage data.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/ab-test.mjs $ARGUMENTS
```

Display the output exactly as returned. Do not modify or summarize.

## Sub-commands

- `start <skill-name> <path-to-version-b>` — Start a new A/B test
- `status` — Show all active A/B tests
- `result <skill-name>` — Show results for a skill's A/B test
- `stop <skill-name>` — Stop an active A/B test

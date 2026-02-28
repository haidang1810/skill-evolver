# Skill Evolver

Analytics and health monitoring for Claude Code skills.

Like Google Analytics for your skills — tracks usage, detects user reactions, monitors health trends, and enables A/B testing. All data stays local in SQLite.

## Install

```bash
# Clone and install
git clone <repo-url> skill-evolver
cd skill-evolver
npm install

# Register as Claude Code plugin
claude plugin add ./
```

## Features

### Skill Usage Tracking
Automatically tracks every skill invocation via hooks:
- Skill name, trigger type (explicit/auto), arguments
- Token consumption, tool calls, duration
- Skill version hash, model used

### User Reaction Detection
Classifies user's next message after a skill runs:
- **Satisfied** — "thanks", "looks good", topic change
- **Correction** — "no, actually...", "change that..."
- **Follow-up** — "also check...", "you forgot..."
- **Retry** — Same skill invoked again immediately
- **Cancel** — Interrupted mid-execution

### Slash Commands

| Command | Description |
|---------|-------------|
| `/skill-stats` | Overview of all skills (top usage, alerts) |
| `/skill-stats <name>` | Detailed analytics for one skill |
| `/skill-corrections <name>` | Raw corrections + keyword clusters |
| `/skill-health` | Health check all skills |
| `/skill-health <name>` | Detailed health check for one skill |
| `/skill-history <name>` | Version timeline with metrics |
| `/skill-rollback <name>` | Rollback to a previous version |
| `/skill-compare <name>` | Compare two versions side-by-side |
| `/skill-ab start <name> <path>` | Start A/B test |
| `/skill-ab status` | View active A/B tests |
| `/skill-ab result <name>` | View A/B test results |
| `/skill-export <name>` | Export data to CSV/JSON |

### Health Monitoring
Detects skill degradation:
- Satisfaction trend drops (> 15%)
- Token creep (> 30% above baseline)
- High cancel rate (> 10%)
- High correction rate (> 25%)
- Model changes
- SKILL.md file changes

### Skill Guards
Validates SKILL.md changes against drift thresholds:
- Line count limit (500 lines max)
- Line drift from baseline (30% max growth)
- Step count drift (±3 steps from baseline)
- Description length (200 chars max)
- Token budget drift

### Version Tracking
Automatic SKILL.md snapshots with:
- Content hash + line count
- Parent version linkage
- Metrics per version
- One-command rollback

### A/B Testing
Compare two skill versions with real usage data:
- Random 50/50 version assignment
- Satisfaction, tokens, correction rate comparison
- Statistical significance caveat

## Design Philosophy

1. **Data-driven, not AI-driven** — Measures and displays, never uses LLM to auto-fix
2. **Human-in-the-loop** — You decide what to change based on data
3. **Zero config** — Install and it tracks automatically
4. **Minimal overhead** — Async hooks, never blocks Claude
5. **Privacy-first** — All data in local SQLite, nothing sent externally

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Storage:** SQLite via better-sqlite3
- **Keyword extraction:** Built-in TF-IDF (no deps)
- **Hashing:** Node.js crypto

## Data Storage

Database: `<plugin-root>/data/skill-evolver.db`

Tables: `skill_runs`, `reactions`, `skill_versions`, `ab_tests`, `ab_runs`, `guard_configs`

## License

MIT

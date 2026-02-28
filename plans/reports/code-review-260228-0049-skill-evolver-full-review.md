# Code Review: Skill Evolver - Full Codebase

**Date:** 2026-02-28
**Reviewer:** code-reviewer
**Scope:** Full codebase review (20 source files, ~2,084 LOC)

---

## Overall Assessment

Skill Evolver is a well-architected, focused plugin with clean separation of concerns. The codebase follows KISS/YAGNI principles effectively: no over-engineering, minimal dependencies (only `better-sqlite3`), and each file has a single clear purpose. The design philosophy of "data-driven, not AI-driven" is well-executed.

However, there are **several security issues** (SQL injection via template literals), **missing error boundaries** in hooks, **a dead-code bug** in guards, and **no test coverage**. The issues below are ordered by severity.

---

## Critical Issues

### C1. SQL Injection via Template Literals in `stats.mjs` and `export.mjs`

**Files:** `E:\dev\be\skill-evolver\scripts\stats.mjs` (lines 36, 83, 98, 162), `E:\dev\be\skill-evolver\scripts\export.mjs` (line 30)

Multiple SQL queries embed JavaScript variables directly into SQL strings using template literals:

```javascript
// stats.mjs line 36 — DAYS_30 is a constant, but pattern is dangerous
`AND sr.triggered_at >= datetime('now', '-${DAYS_30} days')`

// export.mjs line 30 — `days` comes from user CLI input (parseInt)
`AND sr.triggered_at >= datetime('now', '-${days} days')`
```

**Risk:** While `DAYS_30` is a hardcoded constant (low immediate risk), `days` in `export.mjs` comes from user input via `process.argv`. Although `parseInt` sanitizes it to a number, the **pattern itself is dangerous** and invites future copy-paste bugs. The `trends.mjs` file (line 58) also uses this pattern with `${w.sql}` but the SQL is internally constructed.

**Fix:** Use parameterized queries or compute the date in JS:

```javascript
// Option 1: compute date in JS
const since = new Date(Date.now() - days * 86400000).toISOString();
db.prepare('... AND sr.triggered_at >= ?').all(skillName, since);

// Option 2: use SQLite parameter binding for the interval string
const interval = `-${days} days`;
db.prepare("... AND sr.triggered_at >= datetime('now', ?)").all(skillName, interval);
```

### C2. Regex Injection in Reaction Classification

**File:** `E:\dev\be\skill-evolver\lib\reaction-patterns.mjs` (line 31)

```javascript
const retryRe = new RegExp(`^\\/${previousSkillName}(\\s|$)`, 'i');
```

`previousSkillName` comes from the database and originates from user input. If a skill name contains regex metacharacters (e.g., `skill.name`, `skill+test`), this creates an invalid or exploitable regex. While skill names typically match `[\w-]+`, the code doesn't validate `previousSkillName` here.

**Fix:** Escape regex metacharacters:

```javascript
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const retryRe = new RegExp(`^\\/${escapeRegex(previousSkillName)}(\\s|$)`, 'i');
```

### C3. Path Traversal Risk in `rollback.mjs`

**File:** `E:\dev\be\skill-evolver\scripts\rollback.mjs` (lines 43-59)

The rollback command writes content to a file path discovered via `discoverSkills()`. While `discoverSkills()` only scans `.claude/skills/` directories, the version content comes from the database. If the database were tampered with (unlikely but possible since it's a local SQLite file), arbitrary content could be written to a skill path.

More practically: `getVersionContent(targetHash)` retrieves any version by hash, not filtered by `skillName`. A user could pass a valid hash from a *different* skill and overwrite the wrong SKILL.md.

**Fix:** Filter by both skill name and hash:

```javascript
// In versioning.mjs, add a skill-scoped variant:
export function getVersionContentForSkill(skillName, versionHash) {
  const db = getDb();
  return db.prepare(
    'SELECT content, line_count, created_at FROM skill_versions WHERE skill_name = ? AND version_hash = ?'
  ).get(skillName, versionHash) || null;
}
```

---

## High Priority

### H1. No `completed` Flag Reset for Abandoned Runs

**File:** `E:\dev\be\skill-evolver\scripts\on-prompt-submit.mjs` (line 81)

When a new skill is invoked, a row is inserted with `completed = 0`. If the user never triggers the `Stop` hook (e.g., Claude Code crashes, user force-quits), this row stays `completed = 0` forever. Over time, orphaned incomplete runs accumulate.

Additionally, if a user invokes skill A then skill B without skill A completing, both remain `completed = 0` and only the most recent one gets finalized by the `Stop` hook.

**Fix:** Before inserting a new run, mark any existing incomplete runs for the session as abandoned:

```javascript
db.prepare(`
  UPDATE skill_runs SET completed = -1
  WHERE session_id = ? AND completed = 0
`).run(sessionId);
```

### H2. Dead Code / Bug in `guards.mjs` Step Count Baseline

**File:** `E:\dev\be\skill-evolver\scripts\guards.mjs` (line 52)

```javascript
const baselineSteps = countSteps(baseline.line_count > 0 ? '' : '');
```

This ternary always evaluates to `countSteps('')` regardless of condition, making `baselineSteps` always 0. The comment says "need content" — the baseline content is needed but not retrieved here. The variable `baselineSteps` is then **never used** because the code immediately checks `config?.baseline_step_count` from `guard_configs` table instead.

**Impact:** Wasted computation, confusing dead code. The step count guard only works when `guard_configs.baseline_step_count` is set (via `initGuardBaseline`), which is correct but the dead code is misleading.

**Fix:** Remove the dead line entirely:

```javascript
// Remove line 52:
// const baselineSteps = countSteps(baseline.line_count > 0 ? '' : '');
```

### H3. A/B Test Version Not Actually Swapped at Runtime

**Files:** `E:\dev\be\skill-evolver\scripts\ab-test.mjs`, `E:\dev\be\skill-evolver\scripts\on-prompt-submit.mjs`

The A/B test `start` command creates the test record and `result` shows metrics, but **the actual SKILL.md swap mechanism is never implemented**. The `on-prompt-submit.mjs` hook does not check for active A/B tests or assign versions. No `ab_runs` records are ever created during normal skill invocation.

The design document mentions: "hook check xem co A/B test active khong -> swap SKILL.md content tam thoi -> sau khi chay xong restore." This swap logic is completely missing.

**Impact:** A/B testing is non-functional. Tests can be created and results viewed, but no runs are ever assigned to versions A or B, so results are always empty.

**Fix:** In `on-prompt-submit.mjs`, after detecting a skill invocation, check for active A/B tests:

```javascript
// After line 83 in trackNewInvocation:
const abTest = db.prepare(
  "SELECT id, version_a_hash, version_b_hash FROM ab_tests WHERE skill_name = ? AND status = 'running'"
).get(skillName);

if (abTest) {
  const assigned = Math.random() < 0.5 ? 'a' : 'b';
  const runId = /* get the just-inserted run ID */;
  db.prepare('INSERT INTO ab_runs (ab_test_id, skill_run_id, assigned_version) VALUES (?, ?, ?)')
    .run(abTest.id, runId, assigned);
  // TODO: Actually swap SKILL.md content for the assigned version
}
```

### H4. `cancel` Reaction Never Recorded

**File:** `E:\dev\be\skill-evolver\lib\reaction-patterns.mjs`

The `classifyReaction` function returns one of: `'satisfied'`, `'correction'`, `'follow_up'`, `'retry'`, or `'neutral'`. It never returns `'cancel'`. But multiple scripts reference `r.reaction_type = 'cancel'` in SQL queries (health.mjs line 54, trends.mjs line 54, etc.) and the design doc describes cancel detection for Ctrl+C.

There is no mechanism to record cancel reactions. The `Stop` hook (`on-stop.mjs`) finalizes runs but does not classify whether it was a cancellation.

**Impact:** Cancel rate metrics are always 0%. Health alerts for cancel rate > 10% never trigger.

**Fix:** Detect cancellation in the `Stop` hook by checking if the run duration was abnormally short or if the transcript indicates interruption. Alternatively, add a hook for the `Cancel` event if Claude Code supports it.

### H5. `stats.mjs` Exceeds 200-Line Guideline (227 lines)

**File:** `E:\dev\be\skill-evolver\scripts\stats.mjs`

Per project rules, code files should be kept under 200 lines. At 227 lines, `stats.mjs` slightly exceeds this. The `getTrends()` helper (lines 145-180) duplicates logic already in `E:\dev\be\skill-evolver\lib\trends.mjs` (`calculateTrends`).

**Fix:** Import and use `calculateTrends` from `lib/trends.mjs` instead of the local `getTrends()`. Also extract formatting helpers (`padRight`, `padLeft`, `formatNum`, `formatDelta`) to a shared `lib/format.mjs`.

---

## Medium Priority

### M1. No Data Retention / Cleanup Strategy

**File:** `E:\dev\be\skill-evolver\db\schema.sql`

The design doc mentions: "Cần data retention policy (auto-purge runs > 90 days)." No purge mechanism exists. With heavy usage (~100 runs/day), the database could grow to ~50MB/year as noted. The `skill_versions` table stores full SKILL.md content which could also accumulate significantly.

**Fix:** Add a cleanup function called periodically:

```javascript
export function purgeOldData(db, retentionDays = 90) {
  db.prepare(`DELETE FROM reactions WHERE skill_run_id IN
    (SELECT id FROM skill_runs WHERE triggered_at < datetime('now', '-' || ? || ' days'))
  `).run(retentionDays);
  db.prepare(`DELETE FROM skill_runs WHERE triggered_at < datetime('now', '-' || ? || ' days')`)
    .run(retentionDays);
}
```

### M2. CSV Export Missing Proper Escaping

**File:** `E:\dev\be\skill-evolver\scripts\export.mjs` (lines 49-66)

The CSV export only wraps fields containing commas in double quotes. It does not handle:
- Fields containing double quotes (need to be escaped as `""`)
- Fields containing newlines
- Fields containing the BOM character

```javascript
// Current:
return str.includes(',') ? `"${str}"` : str;

// Should be:
return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
```

### M3. `user_message` Stored Without Sanitization

**File:** `E:\dev\be\skill-evolver\scripts\on-prompt-submit.mjs` (line 60)

User messages are stored in the `reactions` table with a 2000-char truncation but no sanitization. While SQLite parameterized queries prevent SQL injection, the stored text could contain control characters, null bytes, or other problematic content that might cause issues when exported or displayed.

**Impact:** Low risk since data is only displayed locally, but good practice to strip control characters.

### M4. Duplicate Trend Logic Between `stats.mjs` and `trends.mjs`

**Files:** `E:\dev\be\skill-evolver\scripts\stats.mjs` (lines 145-180), `E:\dev\be\skill-evolver\lib\trends.mjs` (lines 40-87)

Both files implement 2-week comparison windows with nearly identical SQL and logic. The `stats.mjs` version is simpler but functionally equivalent to `calculateTrends()` in `trends.mjs`.

**Fix:** `stats.mjs` should import and use `calculateTrends` from `lib/trends.mjs`.

### M5. `simpleDiff` in `compare.mjs` Ignores Line Order and Duplicates

**File:** `E:\dev\be\skill-evolver\scripts\compare.mjs` (lines 109-117)

The diff converts lines to a Set, losing:
- Duplicate lines (common in markdown: multiple blank lines, repeated patterns)
- Line ordering (moved lines appear unchanged)

For a skill comparison tool, this could produce misleading results.

**Fix:** Use a proper LCS-based diff or at minimum note the limitation in output:

```javascript
console.log('  Note: Simple set-based diff. Duplicate/moved lines not tracked.');
```

### M6. Missing Index on `ab_runs.skill_run_id`

**File:** `E:\dev\be\skill-evolver\db\schema.sql`

The `ab_runs` table is joined with `skill_runs` in queries but has no index on `skill_run_id`. Only `ab_test_id` is implicitly indexed via FK.

**Fix:**

```sql
CREATE INDEX IF NOT EXISTS idx_ab_runs_skill_run ON ab_runs(skill_run_id);
CREATE INDEX IF NOT EXISTS idx_ab_runs_test ON ab_runs(ab_test_id);
```

### M7. `discoverSkills()` Uses `process.cwd()` Which May Vary

**File:** `E:\dev\be\skill-evolver\lib\skill-detector.mjs` (line 37)

Hooks are invoked by Claude Code, and the working directory may not be the user's project directory. `process.cwd()` could point to the plugin root, the system temp directory, or another location depending on how Claude Code spawns hook processes.

**Impact:** Project-level skills at `<cwd>/.claude/skills/` may not be discovered correctly.

**Fix:** Accept a `cwd` parameter or read from environment variable:

```javascript
const projectRoot = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
```

---

## Low Priority

### L1. `health.mjs` Also Exceeds 200-Line Guideline (205 lines)

**File:** `E:\dev\be\skill-evolver\scripts\health.mjs`

Slightly over the 200-line limit. The `checkHealth()` function (lines 86-163) is 77 lines and could be split into individual health check functions.

### L2. Hardcoded Cost Estimate May Become Stale

**File:** `E:\dev\be\skill-evolver\scripts\stats.mjs` (lines 215-220)

```javascript
// ~$3/M input + $15/M output, assume 70% input 30% output
```

Anthropic pricing changes. This will silently become inaccurate.

**Fix:** Add a comment with the date of the pricing assumption, or make it configurable.

### L3. No Validation on `--format` Flag in `export.mjs`

**File:** `E:\dev\be\skill-evolver\scripts\export.mjs` (line 11)

```javascript
const format = getFlag(args, '--format') || 'json';
```

If user passes `--format xml`, it silently falls through to JSON output. Should validate or warn.

### L4. `EXPLICIT_CMD_RE` Regex Only Matches Start of Prompt

**File:** `E:\dev\be\skill-evolver\lib\skill-detector.mjs` (line 7)

```javascript
const EXPLICIT_CMD_RE = /^\/([\w-]+)(?:\s+(.*))?$/s;
```

This requires the entire prompt to be the command. If a user writes "please /skill-stats" or adds text before the command, it won't match. This is intentional behavior per design, but worth noting that multi-line prompts where the first line is a command but has trailing content on subsequent lines are captured via the `s` flag (dot matches newline in the args capture group), which is correct.

### L5. `estimateCost` Assumes 70/30 Input/Output Split

**File:** `E:\dev\be\skill-evolver\scripts\stats.mjs` (line 217)

The function receives total tokens and assumes 70% input / 30% output. But the database stores `output_tokens` separately, which could be used for more accurate cost calculation.

### L6. Missing `process.exit(0)` in Slash Command Scripts

**Files:** `stats.mjs`, `corrections.mjs`, `health.mjs`, `history.mjs`, `compare.mjs`, `export.mjs`

The hook handlers (`on-prompt-submit.mjs`, `on-stop.mjs`, `on-config-change.mjs`) properly call `process.exit(0)` on parse errors, but the slash command scripts don't explicitly exit. This is fine since they run synchronously, but inconsistent.

---

## Positive Observations

1. **Clean modular architecture** -- lib/ for reusable utilities, scripts/ for entry points, clear separation
2. **Defensive defaults** -- Every function returns sensible defaults on null/empty input
3. **Parameterized SQL** -- Most queries properly use `?` placeholders (the template literal cases are exceptions)
4. **WAL mode enabled** -- Good choice for concurrent read/write scenarios in SQLite
5. **Foreign keys enabled** -- Referential integrity enforced
6. **Well-designed schema** -- Appropriate indexes, normalized structure, clean relationships
7. **Error swallowing in hooks is correct** -- Hooks catching all errors and exiting silently is the right pattern; a crashing hook would degrade the Claude Code user experience
8. **Message truncation** -- User messages stored at max 2000 chars prevents DB bloat
9. **Minimal dependencies** -- Only `better-sqlite3`, no unnecessary packages
10. **SKILL.md files are clean** -- Concise, proper frontmatter, clear usage instructions

---

## Recommended Actions (Priority Order)

1. **Fix SQL template literal injection pattern** in `stats.mjs` and `export.mjs` -- use parameterized queries [C1]
2. **Escape regex metacharacters** in reaction-patterns.mjs retry detection [C2]
3. **Scope version lookup by skill name** in rollback.mjs [C3]
4. **Implement A/B test version assignment** in on-prompt-submit.mjs or acknowledge A/B as incomplete [H3]
5. **Add cancel reaction detection** mechanism [H4]
6. **Remove dead code** in guards.mjs line 52 [H2]
7. **Mark abandoned runs** when new skill invoked before previous completes [H1]
8. **Fix CSV export escaping** for double quotes and newlines [M2]
9. **Deduplicate trend logic** -- stats.mjs should use lib/trends.mjs [M4]
10. **Add data retention purge** function [M1]
11. **Add test suite** -- 0% test coverage for a plugin handling user data

---

## Metrics

| Metric | Value |
|--------|-------|
| Total LOC | ~2,084 |
| Source files | 20 (.mjs) + 1 (.sql) + 8 (SKILL.md) |
| Dependencies | 1 (better-sqlite3) |
| Test coverage | 0% (no tests exist) |
| Linting issues | Not configured (no ESLint/Prettier) |
| Files > 200 lines | 2 (stats.mjs: 227, ab-test.mjs: 228, health.mjs: 205) |

---

## Unresolved Questions

1. **A/B test swap mechanism**: Is this intentionally deferred or was it overlooked? The test infrastructure exists but runtime assignment is missing entirely.
2. **Cancel detection strategy**: Does Claude Code emit a specific hook event for user cancellation (Ctrl+C)? If not, how should cancel be detected?
3. **Hook `async: true` behavior**: The hooks.json marks all hooks as `async: true`. Does Claude Code guarantee the hook runs to completion, or can it be terminated after the 5s timeout? If terminated, database writes could be lost.
4. **`ConfigChange` hook matcher `"skills"`**: Does this matcher fire only when files under a `skills/` directory change, or does it match a broader pattern? The hook relies on `filePath.endsWith('SKILL.md')` for additional filtering.
5. **Data directory permissions**: The `data/` directory is created with default permissions. On shared systems, this SQLite database could be readable by other users. Should file permissions be restricted?

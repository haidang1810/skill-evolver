# Skill Evolver — Analytics & Health Monitor cho Claude Code Skills

## Tổng quan

Skill Evolver là một **Claude Code plugin** giúp đo lường, theo dõi và bảo vệ chất lượng của skills qua thời gian. Thay vì dùng AI để tự động sửa skill (dễ gây drift và circular dependency), Skill Evolver cung cấp **dữ liệu chính xác** để con người đưa ra quyết định cải thiện skill tốt hơn.

Tương tự Google Analytics cho website — tool không tự sửa website, mà cho bạn thấy bounce rate cao ở đâu, user drop off chỗ nào, rồi bạn tự quyết định fix gì.

## Vấn đề cần giải quyết

- Skills là static markdown, viết 1 lần nhưng không biết nó hoạt động tốt hay tệ theo thời gian
- Skill activation rate chỉ ~20% nếu description không tốt, nhưng không có data để biết
- User hay phải sửa output hoặc thêm follow-up, nhưng không ai track pattern này
- Model update → skill output drift → không có cách phát hiện cho đến khi nhận code tệ
- Skill dần phình to khi thêm features → token waste → chất lượng giảm
- Không có cách so sánh 2 versions của cùng 1 skill một cách khoa học

## Triết lý thiết kế

1. **Data-driven, không AI-driven** — Tool chỉ đo lường và hiển thị, không dùng LLM để sửa skill
2. **Human-in-the-loop** — Con người luôn là người quyết định thay đổi gì
3. **Zero config** — Cài plugin xong là tự động track, không cần setup thêm
4. **Minimal overhead** — Hooks phải chạy nhanh (< 100ms), không ảnh hưởng trải nghiệm
5. **Privacy-first** — Tất cả data lưu local trong SQLite, không gửi đi đâu

---

## Chức năng chi tiết

### 1. Skill Usage Tracking

Tự động thu thập data mỗi lần skill được invoke thông qua Claude Code hooks system.

**Data thu thập:**

- Skill nào được gọi
- Thời điểm invoke
- Cách trigger (explicit `/command` hay auto-activated)
- Arguments truyền vào
- Số tokens consumed
- Số tool calls thực hiện
- Thời gian chạy (duration)
- Files liên quan
- Model đang dùng (sonnet/opus/haiku)
- Skill version (hash của SKILL.md tại thời điểm chạy)

**Implementation:** Sử dụng `UserPromptSubmit`, `PostToolUse`, và `Stop` hooks để capture data tại các thời điểm trong lifecycle của skill execution.

---

### 2. User Reaction Detection

Phân tích message tiếp theo của user sau khi skill chạy xong để đánh giá mức độ hài lòng.

**Các loại reaction:**

| Reaction | Cách detect | Ý nghĩa |
|----------|------------|---------|
| **Satisfied** | User chuyển sang topic khác hoặc nói "thanks/ok/good" | Skill output đạt yêu cầu |
| **Correction** | User nói "no, actually...", "change that to...", "wrong..." trong 30s | Output sai, cần sửa |
| **Follow-up** | User nói "also check...", "what about...", "you forgot..." trong 30s | Skill thiếu bước |
| **Retry** | User gọi lại cùng skill với args khác ngay sau đó | Output không useful |
| **Cancel** | User gõ Ctrl+C hoặc abandon giữa chừng | Skill trigger sai context hoặc quá chậm |
| **Neutral** | Không detect được pattern rõ ràng | Không kết luận |

**Detection method:** Regex-based pattern matching trên user message kế tiếp, kết hợp time window (< 30 giây sau skill output). Không dùng LLM để classify — tránh circular dependency.

---

### 3. Skill Statistics Dashboard

Slash command `/skill-stats` hiển thị analytics tổng hợp.

**`/skill-stats`** — Overview tất cả skills:

```
Top 5 skills by usage (last 30 days):
  /review        47 runs   60% satisfied   3,200 avg tokens
  /test-fix      31 runs   78% satisfied   1,800 avg tokens
  /git-push      28 runs   92% satisfied     400 avg tokens
  /plan          15 runs   53% satisfied   5,100 avg tokens
  /explain        9 runs   89% satisfied   2,400 avg tokens

⚠ Alerts:
  /review — satisfaction dropping (72% → 58% in 2 weeks)
  /plan — high token usage (5,100 avg, consider optimizing)
```

**`/skill-stats <skill-name>`** — Chi tiết 1 skill:

```
/review — Last 30 days

  Invocations:        47
  Explicit (/review): 38 (81%)
  Auto-triggered:      9 (19%)

  ── Reactions ────────────────────
  Satisfied:          28 (60%)
  Correction needed:  11 (23%)
  Follow-up needed:    6 (13%)
  Cancelled:           2 (4%)

  ── Cost ─────────────────────────
  Avg tokens:         3,200
  Avg duration:       42s
  Est. cost/run:      $0.04
  Monthly total:      $1.88

  ── Trends ───────────────────────
  Satisfaction: 72% → 58% (↓14%)
  Tokens: stable (~3,200)
  Cancel rate: 2% → 8% (↑ recent)
```

---

### 4. Correction Log

Slash command `/skill-corrections` hiển thị raw data về những lần user phải sửa output.

**`/skill-corrections <skill-name>`** — Liệt kê corrections gần nhất:

Hiển thị danh sách raw messages mà user gõ sau khi skill chạy (được classify là correction hoặc follow-up), sắp xếp theo thời gian.

Kèm theo **keyword frequency clustering** — nhóm corrections theo từ khóa xuất hiện nhiều nhất. Sử dụng simple keyword extraction (TF-IDF hoặc word frequency), không dùng LLM để cluster.

Ví dụ output:

```
"security/secrets/injection":  5 times (45%)
"too long/verbose/shorter":    3 times (27%)
"skip/ignore [section]":       2 times (18%)
```

Từ đây human tự nhìn ra pattern và quyết định sửa skill.

---

### 5. Skill Health Monitor

Slash command `/skill-health` phát hiện các dấu hiệu skill đang xuống cấp.

**Các metrics theo dõi:**

| Metric | Phương pháp | Alert khi |
|--------|------------|-----------|
| Satisfaction trend | So sánh satisfaction rate 2 tuần gần vs 2 tuần trước | Giảm > 15% |
| Token creep | So sánh avg tokens hiện tại vs baseline (lần đầu track) | Tăng > 30% |
| Cancel rate | Tỷ lệ cancelled runs | > 10% |
| Correction rate | Tỷ lệ runs cần correction | > 25% |
| Model change | Detect model string thay đổi | Bất kỳ thay đổi |
| Skill file change | Hash SKILL.md thay đổi | Bất kỳ thay đổi |

**Output:** Hiển thị health status + possible causes (danh sách gợi ý nguyên nhân dựa trên rules cứng, không phải LLM phân tích).

---

### 6. Skill Guards

Hệ thống constraints ngăn skill phình to và drift khỏi mục đích ban đầu.

**Guards tự động chạy khi SKILL.md bị edit** (thông qua `ConfigChange` hook):

| Guard | Rule | Action |
|-------|------|--------|
| Line limit | SKILL.md > 500 dòng | Warning |
| Line drift | Tăng > 30% so với version đầu | Warning |
| Token budget | Avg tokens/run > 2x baseline | Alert trong `/skill-health` |
| Step count drift | Số steps thay đổi > ±3 so với version đầu | Warning |
| Description length | Description > 200 chars | Warning |

**Hoạt động:** Khi user edit SKILL.md (detect qua `ConfigChange` hook hoặc pre-save check), guards chạy validation và hiển thị warnings. Không block — chỉ inform.

---

### 7. Skill Version Tracking

Tự động track mọi thay đổi của SKILL.md qua thời gian.

**Mỗi khi SKILL.md thay đổi (detect qua hash comparison):**

- Lưu snapshot content mới vào SQLite
- Ghi timestamp + hash
- Liên kết với version trước (parent)
- Từ thời điểm này, metrics được gắn với version mới

**`/skill-history <skill-name>`** — Xem evolution timeline:

```
/review history:

  v1  Jan 15  (baseline)  45 lines   78% satisfied
  v2  Feb 01  +7 lines    52 lines   72% satisfied
      Change: added error handling step
  v3  Feb 14  +12 lines   64 lines   58% satisfied
      Change: added performance + architecture sections
      ⚠ Satisfaction dropped after this change

  Suggestion: v3 thêm quá nhiều → consider reverting 
  architecture section (xem /skill-corrections review)
```

**`/skill-rollback <skill-name>`** — Quay về version trước:

Hiển thị danh sách versions kèm metrics, user chọn version muốn rollback. Tool copy content version cũ vào SKILL.md hiện tại.

---

### 8. A/B Testing

Cho phép user tạo 2 versions của cùng 1 skill và so sánh hiệu quả bằng data thực.

**Flow:**

1. User tạo version B (copy và edit thủ công)
2. User gõ `/skill-ab start <skill-name>` — tool detect version A (current) và hỏi path đến version B
3. Tool random assign version cho mỗi lần invoke (50/50)
4. Sau N runs (configurable, default 20), tool báo kết quả
5. User quyết định adopt version nào

**Metrics so sánh:**

- Satisfaction rate
- Avg tokens
- Correction rate
- Follow-up rate
- Duration

**`/skill-ab status`** — Xem A/B tests đang chạy

**`/skill-ab result <skill-name>`** — Xem kết quả sau khi đủ runs

Cơ chế swap: Trước khi skill activate, hook check xem có A/B test active không → swap SKILL.md content tạm thời → sau khi chạy xong restore.

---

## Danh sách Slash Commands

| Command | Mô tả |
|---------|-------|
| `/skill-stats` | Overview tất cả skills (top usage, alerts) |
| `/skill-stats <name>` | Analytics chi tiết cho 1 skill |
| `/skill-corrections <name>` | Xem raw corrections + keyword clusters |
| `/skill-health` | Health check tất cả skills |
| `/skill-health <name>` | Health check chi tiết 1 skill |
| `/skill-history <name>` | Version timeline với metrics |
| `/skill-rollback <name>` | Rollback skill về version cũ |
| `/skill-compare <name>` | So sánh 2 versions side-by-side |
| `/skill-ab start <name>` | Bắt đầu A/B test |
| `/skill-ab status` | Xem A/B tests đang chạy |
| `/skill-ab result <name>` | Xem kết quả A/B test |
| `/skill-export <name>` | Export data ra CSV/JSON |

---

## Hooks sử dụng

| Hook Event | Matcher | Mục đích |
|------------|---------|----------|
| `UserPromptSubmit` | `""` | Detect skill invocation + detect reaction cho run trước |
| `PostToolUse` | `""` | Track tool calls trong skill execution |
| `Stop` | `"*"` | Capture end-of-run metrics (tokens, duration) |
| `ConfigChange` | `"skills"` | Detect SKILL.md changes → version tracking + guards |

---

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Storage:** SQLite (via better-sqlite3)
- **Keyword extraction:** Simple TF-IDF implementation (không dependency nặng)
- **Clustering:** Keyword frequency counting + basic string similarity
- **Hashing:** crypto.createHash cho SKILL.md version tracking
- **Distribution:** Claude Code Plugin Marketplace

---

## Project Structure

```
skill-evolver/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── hooks.json               # Hook registrations
├── skills/
│   ├── skill-stats/
│   │   └── SKILL.md             # /skill-stats command
│   ├── skill-corrections/
│   │   └── SKILL.md             # /skill-corrections command
│   ├── skill-health/
│   │   └── SKILL.md             # /skill-health command
│   ├── skill-history/
│   │   └── SKILL.md             # /skill-history command
│   ├── skill-rollback/
│   │   └── SKILL.md             # /skill-rollback command
│   ├── skill-compare/
│   │   └── SKILL.md             # /skill-compare command
│   ├── skill-ab/
│   │   └── SKILL.md             # /skill-ab command
│   └── skill-export/
│       └── SKILL.md             # /skill-export command
├── scripts/
│   ├── collector.mjs            # Hook handler — collect invocation data
│   ├── reaction-detector.mjs    # Detect user reactions (regex-based)
│   ├── stats.mjs                # Generate statistics
│   ├── health.mjs               # Health check logic
│   ├── guards.mjs               # Skill guards validation
│   ├── versioning.mjs           # Version tracking
│   ├── ab-test.mjs              # A/B test management
│   └── export.mjs               # Data export
├── lib/
│   ├── db.mjs                   # SQLite wrapper + migrations
│   ├── keywords.mjs             # TF-IDF keyword extraction
│   ├── trends.mjs               # Trend calculation utilities
│   └── hash.mjs                 # SKILL.md hashing
├── db/
│   └── schema.sql               # Database schema
├── package.json
└── README.md
```

---

## Database Schema

### Bảng `skill_runs`
Mỗi record = 1 lần skill được invoke.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| skill_name | TEXT | Tên skill |
| session_id | TEXT | Claude Code session ID |
| triggered_at | DATETIME | Thời điểm invoke |
| trigger_type | TEXT | 'explicit' hoặc 'auto' |
| arguments | TEXT | Arguments truyền vào |
| tokens_used | INTEGER | Tổng tokens consumed |
| tool_calls | INTEGER | Số tool calls |
| duration_ms | INTEGER | Thời gian chạy |
| files_involved | TEXT | JSON array of file paths |
| output_tokens | INTEGER | Tokens trong output |
| skill_version_hash | TEXT | Hash của SKILL.md lúc chạy |
| model | TEXT | Model string |

### Bảng `reactions`
Mỗi record = 1 user reaction sau skill run.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| skill_run_id | INTEGER FK | Reference đến skill_runs |
| reaction_type | TEXT | 'satisfied', 'correction', 'follow_up', 'retry', 'cancel', 'neutral' |
| user_message | TEXT | Raw message nếu là correction/follow_up |
| detected_at | DATETIME | Thời điểm detect |
| time_after_skill_ms | INTEGER | Milliseconds sau skill output |

### Bảng `skill_versions`
Mỗi record = 1 snapshot của SKILL.md.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| skill_name | TEXT | Tên skill |
| version_hash | TEXT UNIQUE | SHA-256 hash of content |
| content | TEXT | Full SKILL.md content |
| line_count | INTEGER | Số dòng |
| created_at | DATETIME | Thời điểm detect change |
| parent_version_id | INTEGER FK | Version trước đó |

### Bảng `ab_tests`
Mỗi record = 1 A/B test session.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| skill_name | TEXT | Tên skill |
| version_a_hash | TEXT | Hash version A (control) |
| version_b_hash | TEXT | Hash version B (treatment) |
| started_at | DATETIME | Bắt đầu test |
| ended_at | DATETIME | Kết thúc test (nullable) |
| target_runs | INTEGER | Số runs mục tiêu (default 20) |
| status | TEXT | 'running', 'completed', 'cancelled' |

### Bảng `ab_runs`
Track version nào được assign cho mỗi skill run trong A/B test.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| ab_test_id | INTEGER FK | Reference đến ab_tests |
| skill_run_id | INTEGER FK | Reference đến skill_runs |
| assigned_version | TEXT | 'a' hoặc 'b' |

### Bảng `guard_configs`
Cấu hình guards cho mỗi skill.

| Column | Type | Mô tả |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| skill_name | TEXT UNIQUE | Tên skill |
| baseline_line_count | INTEGER | Số dòng khi bắt đầu track |
| baseline_avg_tokens | INTEGER | Avg tokens khi bắt đầu track |
| baseline_step_count | INTEGER | Số steps khi bắt đầu track |
| max_line_drift_pct | REAL | Max % tăng line count (default 0.3) |
| max_token_drift_pct | REAL | Max % tăng avg tokens (default 0.5) |
| max_step_drift | INTEGER | Max step count change (default 3) |

---

## Phased Roadmap

### Phase 1 — Collector + Stats (1.5 tuần)

**Mục tiêu:** Thu thập data và hiển thị basic analytics.

**Tasks:**
- Setup plugin structure (plugin.json, hooks.json)
- Implement hooks (UserPromptSubmit, PostToolUse, Stop)
- Implement collector.mjs — parse hook input, write to SQLite
- Implement reaction detection (regex-based)
- Implement `/skill-stats` command
- SQLite schema + migrations
- Test với 2-3 skills thực tế

**Deliverable:** Plugin cài được, tự động track, `/skill-stats` hoạt động.

### Phase 2 — Corrections + Health (1.5 tuần)

**Mục tiêu:** Giúp user hiểu tại sao skill output chưa tốt.

**Tasks:**
- Implement `/skill-corrections` — raw log + keyword clustering
- Implement TF-IDF keyword extraction
- Implement `/skill-health` — trend analysis + alerts
- Define health rules (satisfaction drop, token creep, cancel rate)
- Alert system (hiển thị trong `/skill-stats` overview)

**Deliverable:** User có thể nhìn corrections patterns và health trends.

### Phase 3 — Versioning + Guards (1 tuần)

**Mục tiêu:** Track skill changes và ngăn drift.

**Tasks:**
- Implement version tracking (ConfigChange hook)
- Implement `/skill-history` — version timeline với metrics
- Implement `/skill-rollback`
- Implement `/skill-compare` — diff 2 versions
- Implement guards (pre-save validation)
- Baseline capture (lần đầu track 1 skill)

**Deliverable:** Full version history + rollback + drift prevention.

### Phase 4 — A/B Testing (1 tuần)

**Mục tiêu:** So sánh 2 versions bằng data thực.

**Tasks:**
- Implement `/skill-ab start` — setup A/B test
- Implement swap mechanism (hook swap SKILL.md content)
- Implement tracking (gắn mỗi run với version A hoặc B)
- Implement `/skill-ab status` và `/skill-ab result`
- Statistical comparison (satisfaction, tokens, corrections)

**Deliverable:** Hoàn chỉnh A/B testing flow.

### Phase 5 — Polish + Publish (0.5 tuần)

**Mục tiêu:** Publish lên marketplace.

**Tasks:**
- `/skill-export` — export data ra CSV/JSON
- README documentation
- Plugin marketplace setup
- Edge case handling
- Performance optimization (đảm bảo hooks < 100ms)

---

## Giới hạn và lưu ý

- **Reaction detection không hoàn hảo:** Regex-based detection sẽ miss một số trường hợp hoặc classify sai. Đây là trade-off có chủ đích — tốt hơn là miss vài case nhưng không introduce LLM bias.
- **Không đo chất lượng output trực tiếp:** Tool đo proxy metrics (user reactions) chứ không phải output quality. Correlation không phải causation.
- **A/B test sample size nhỏ:** Với 20 runs mỗi version, statistical significance thấp. Tool nên caveat rõ khi report results.
- **Hook overhead:** Mỗi hook call thêm latency. Target < 100ms per hook. Nếu SQLite write chậm → cần async/buffer.
- **Storage growth:** Với heavy usage (~100 skill runs/ngày), DB có thể đến ~50MB/năm. Cần data retention policy (auto-purge runs > 90 ngày).

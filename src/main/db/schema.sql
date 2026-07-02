-- ============================================================================
-- 炫灿-职途向导系统 MVP schema.sql v0.1.9-strategy-composite-pk
-- Architecture baseline:
--   1. Lightweight event sourcing + SQLite projection.
--   2. action_log.jsonl is the source of truth; SQLite is a query snapshot.
--   3. strategy_config is the single source for scoring, paper generation, and thresholds.
--   4. State transitions are driven by domain events only.
--   5. COMPLETED / REDLINE_HALTED / ABORTED are terminal states.
--   6. LEVEL_FAIL_BY_SAFETY overrides all score-based results.
--   7. training_session + training_step_record support training completion.
--   8. result_record supports ability score, training completion, and operation pass rate.
--   9. error_event_log + error_code_registry support the exception center and error codes.
--  10. task_report + asset_resource support report snapshots and local asset integrity.
-- ----------------------------------------------------------------------------
-- v0.1.1 freeze patch notes:
--   1. Prevent REDLINE_HALTED + NULL level_result bypass.
--   2. Bind safety_incident to ASSESSMENT_SESSION or TRAINING_SESSION generically.
--   3. Add safety_overridden/redline_incident_id to result_record and enforce safety override.
--   4. Add LOCKED and SUPERSEDED report statuses.
--   5. Add P0-P3 priority_level to error_code_registry.
--   6. Explicitly model OPERATION_PASS_RATE as an offline_score_record projection from assessment_session.
--
-- v0.1.2 freeze patch notes:
--   1. Upgrade safety_incident to a student + task-level independent safety aggregate.
--   2. Add task_code to assessment_session and training_session.
--   3. Add partial unique indexes to prevent duplicate open sessions.
--   4. Add safety_incident_binding for multi-session redline halt impact tracking.
--   5. Add database triggers for batch redline halt and unresolved safety review gating.
--   6. Explicitly allow INIT -> REDLINE_HALTED only through a safety_incident batch halt.
--   7. Freeze hardening: schema contains 20 tables including assessment_session_question.
--   8. Freeze hardening: unresolved safety incidents always require review before next session.

--
-- v0.1.3-enum-alignment patch notes:
--   1. Align task_report.report_type with PRD and assessment_session.report_type:
--      FULL_REPORT / SAFETY_TERMINATION_REPORT only.
--   2. Add training_session strategy lock fields:
--      strategy_type, strategy_version, strategy_snapshot_json.
--   3. Remove redundant trg_safety_incident_no_session_requires_review because
--      unresolved safety incident review gating already covers it.
--   4. Document cross-table strategy_type semantics explicitly.
--
-- v0.1.5-integrity-lock patch notes:
--   1. Freeze safety_incident core fact fields after it leaves PENDING_DETAIL.
--      CONFIRMED is the fact-freeze point; RESOLVED / VOIDED remain terminal.
--   2. Prevent in-place UPDATE of referenced strategy_config semantic fields.
--      Historical sessions reproduce policy by strategy_id + strategy_version; stronger
--      strategy_snapshot_json can be added in a future version if required.
--
-- v0.1.6-void-reason patch notes:
--   1. Split VOIDED semantics with void_reason:
--      FALSE_TRIGGER / DUPLICATE_RECORD / NON_SAFETY_EVENT / FACTUAL_CORRECTION.
--   2. Add replacement_incident_id for duplicate and factual-correction lineage.
--   3. Enforce replacement incident to belong to the same student_id + task_code.
--   4. Preserve the safety lifecycle FSM; this patch does not change batch halt,
--      event projection, result projection, report, training, question bank, error center,
--      or referenced strategy_config immutability logic.
--
-- v0.1.7-consistency-guard patch notes:
--   1. Enforce cross-table strategy_config reference consistency for assessment_session
--      and training_session: strategy_id + strategy_type + job_code + strategy_version
--      must match one strategy_config row. training_session.strategy_id remains nullable
--      in the table definition for minimal DDL churn, but INSERT/UPDATE triggers forbid NULL.
--   2. Enforce redline_incident_id consistency: REDLINE_HALTED assessment/training
--      sessions must point to a safety_incident with the same student_id + task_code.
--   3. Align training_step_record.status with PRD v1.0.3:
--      NOT_STARTED / IN_PROGRESS / COMPLETED / SKIPPED / FAILED. ACTIVE is replaced
--      by IN_PROGRESS and VOID is removed.
--
-- v0.1.8-base-ability-rebalance patch notes:
--   1. Rename strategy_config.pass_threshold -> competent_threshold (DEFAULT 70 -> 80)
--      and improve_threshold -> conditional_threshold (DEFAULT 40 -> 60).
--      Semantic realignment: LEVEL_COMPETENT / LEVEL_CONDITIONAL thresholds.
--   2. Promote module_veto_threshold (REAL DEFAULT 0.5) and emotion_collapse_threshold
--      (INTEGER DEFAULT 3) from scoring_policy_json keys to first-class table columns.
--      scoring_policy_json no longer carries these two keys; the table column is the
--      authoritative source. level_rules remains in scoring_policy_json.
--   3. Replace level_result enum values across assessment_session and result_record:
--      LEVEL_PASS / LEVEL_IMPROVE / LEVEL_FAIL -> LEVEL_COMPETENT / LEVEL_CONDITIONAL
--      / LEVEL_NOT_COMPETENT. LEVEL_FAIL_BY_SAFETY is unchanged. PRD v1.0.5 §7.3 does
--      not require backward-compatible string mapping; code must switch in one pass.
--   4. Update seed strategies to v1.0.5 base-ability spec: online 42 (6 modules x 7),
--      offline 8, max_score 100, competent_threshold 80, conditional_threshold 60.
--      BASELINE_ASSESSMENT and MOCK_EXAM now share the same base-ability spec per
--      PRD v1.0.5 §2.4 ("no longer distinguished").
--   5. Update trg_strategy_config_referenced_version_semantic_immutable to reference
--      the renamed columns and protect the two new promoted columns.
--   6. JSON internal keys in scoring_policy_json are renamed in lockstep with the
--      table columns (competent_threshold / conditional_threshold) for vocabulary
--      consistency; the two promoted keys are removed from the JSON.
--   PRD v1.0.5 §7.6 rule 13 is the authoritative source for this revision.
--
-- v0.1.9-strategy-composite-pk patch notes:
--   1. strategy_config PK change: strategy_id TEXT PRIMARY KEY (single-column,
--      per-version) -> PRIMARY KEY (strategy_id, version) (composite, family-level
--      strategy_id). Aligns schema with PRD feature 5.2 "一族一 strategy_id" model:
--      one strategy_id per (strategy_type, job_code) family; new version shares the
--      same strategy_id with incremented version column.
--   2. assessment_session / training_session FK change: column-level single-column
--      FK on strategy_id -> table-level composite FK (strategy_id, strategy_version)
--      REFERENCES strategy_config(strategy_id, version). Sessions now lock precisely
--      to a family+version row.
--   3. result_record.strategy_id loses its FK: this table has no strategy_version
--      column, so a single-column FK would target a non-unique parent key under the
--      composite PK. Downgraded to plain TEXT; integrity is handler-enforced (the
--      source session carries the full version lock).
--   4. UNIQUE(strategy_type, job_code, version) retained as DB-level backstop for
--      the handler-level "one strategy_id per (type, job_code)" rule
--      (DUPLICATE_JOB_STRATEGY).
--   5. Triggers trg_*_strategy_config_match_* join strategy_config on 4 columns
--      (strategy_id, strategy_type, job_code, version); composite PK makes these
--      joins efficient and they remain semantically correct.
--   PRD feature 5.2 (doc/features/strategy-config-prd.md §策略族模型) is the
--   authoritative source for the family-model semantics.
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 0. Schema metadata
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migration (
  migration_id       TEXT PRIMARY KEY,
  schema_version     TEXT NOT NULL,
  description        TEXT,
  applied_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-06-30_mvp_schema_v0_1_4_safety_lifecycle',
  '0.1.4-safety-lifecycle',
  'MVP schema v0.1.4-safety-lifecycle: add safety_incident lifecycle FSM and TEACHER/ADMIN two-level permission projection guards'
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-06-30_mvp_schema_v0_1_5_integrity_lock',
  '0.1.5-integrity-lock',
  'MVP schema v0.1.5-integrity-lock: freeze confirmed safety incident facts and referenced strategy_config versions'
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-06-30_mvp_schema_v0_1_6_void_reason',
  '0.1.6-void-reason',
  'MVP schema v0.1.6-void-reason: split VOIDED semantics and add replacement incident lineage constraints'
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-06-30_mvp_schema_v0_1_7_consistency_guard',
  '0.1.7-consistency-guard',
  'MVP schema v0.1.7-consistency-guard: enforce strategy reference consistency, redline incident same student-task guards, and training step enum alignment'
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-07-01_mvp_schema_v0_1_8_base_ability_rebalance',
  '0.1.8-base-ability-rebalance',
  'MVP schema v0.1.8-base-ability-rebalance: rename strategy_config threshold columns to competent/conditional (DEFAULT 80/60), promote module_veto_threshold and emotion_collapse_threshold to table columns, replace level_result enum with LEVEL_COMPETENT/CONDITIONAL/NOT_COMPETENT, update seed strategies to 42+8/max100 spec per PRD v1.0.5 §2.4/§7.6'
);

INSERT OR IGNORE INTO schema_migration (
  migration_id,
  schema_version,
  description
) VALUES (
  '2026-07-02_mvp_schema_v0_1_9_strategy_composite_pk',
  '0.1.9-strategy-composite-pk',
  'MVP schema v0.1.9-strategy-composite-pk: strategy_config PK strategy_id -> (strategy_id, version) composite to support PRD feature 5.2 one-strategy_id-per-family model; assessment_session/training_session FK upgraded to composite (strategy_id, strategy_version); result_record.strategy_id FK dropped (no version column, would be non-unique parent key); UNIQUE(type,job,version) retained as DUPLICATE_JOB_STRATEGY backstop'
);

-- ----------------------------------------------------------------------------
-- 1. Accounts and student profiles
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_account (
  user_id             TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN')),
  display_name        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_account_role
  ON user_account(role);

CREATE TABLE IF NOT EXISTS student_profile (
  student_id           TEXT PRIMARY KEY,
  student_name         TEXT NOT NULL,
  gender               TEXT CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN')),
  birth_date           TEXT,
  guardian_contact     TEXT,

  -- JSON string. App layer validates schema.
  -- Example: {"noise_sensitivity":"HIGH","avoid_tags":["NOISY_SUPERMARKET"]}
  sensory_profile_json TEXT,

  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_profile_status
  ON student_profile(status);

-- ----------------------------------------------------------------------------
-- 2. Strategy configuration: scoring, question generation, thresholds
-- ----------------------------------------------------------------------------
-- strategy_type cross-table semantics are intentional:
--   * strategy_config.strategy_type allows BASELINE_ASSESSMENT / MOCK_EXAM / TRAINING_PRACTICE.
--   * assessment_session.strategy_type allows BASELINE_ASSESSMENT / MOCK_EXAM only.
--   * training_session.strategy_type allows TRAINING_PRACTICE only.
--   * result_record.strategy_type allows all three because it projects ability score,
--     training completion, and operation pass rate results.
--
-- Version immutability semantics:
--   strategy_config is the single configuration source for scoring, paper generation,
--   and thresholds. After a (strategy_id, version) row is referenced by any
--   assessment_session or training_session, that row becomes historical fact.
--   Its semantic fields must not be updated in place. Policy changes must be
--   represented by inserting a new version. MVP reproducibility is guaranteed by
--   strategy_id + strategy_version plus this immutability guard. A future version
--   may add non-null strategy_snapshot_json if stronger standalone replay is needed.

CREATE TABLE IF NOT EXISTS strategy_config (
  strategy_id                 TEXT NOT NULL,
  strategy_type               TEXT NOT NULL CHECK (strategy_type IN (
                                'BASELINE_ASSESSMENT',
                                'MOCK_EXAM',
                                'TRAINING_PRACTICE'
                              )),
  job_code                    TEXT NOT NULL,
  strategy_name               TEXT NOT NULL,

  online_question_count       INTEGER NOT NULL CHECK (online_question_count >= 0),
  offline_question_count      INTEGER NOT NULL CHECK (offline_question_count >= 0),
  max_score                   INTEGER NOT NULL CHECK (max_score > 0),

  competent_threshold         REAL NOT NULL DEFAULT 80 CHECK (competent_threshold >= 0 AND competent_threshold <= 100),
  conditional_threshold       REAL NOT NULL DEFAULT 60 CHECK (conditional_threshold >= 0 AND conditional_threshold <= 100),

  -- Module veto: any single module score rate below this forces LEVEL_NOT_COMPETENT.
  -- Default 0.5 = 50%. PRD v1.0.5 §7.4 module-level veto.
  module_veto_threshold       REAL NOT NULL DEFAULT 0.5 CHECK (module_veto_threshold >= 0 AND module_veto_threshold <= 1),

  -- Emotion collapse backstop: cumulative emotion-collapse count within one
  -- assessment_session reaching this forces LEVEL_NOT_COMPETENT.
  -- PRD v1.0.5 §4.6 / §7.4. Single recoverable interruptions do not count.
  emotion_collapse_threshold  INTEGER NOT NULL DEFAULT 3 CHECK (emotion_collapse_threshold >= 1),

  -- JSON strings. App layer validates detailed schema.
  question_policy_json        TEXT NOT NULL,
  scoring_policy_json         TEXT NOT NULL,

  supports_redline_halt       INTEGER NOT NULL DEFAULT 1 CHECK (supports_redline_halt IN (0, 1)),
  allows_emotion_interrupt    INTEGER NOT NULL DEFAULT 1 CHECK (allows_emotion_interrupt IN (0, 1)),
  requires_offline_scoring    INTEGER NOT NULL DEFAULT 1 CHECK (requires_offline_scoring IN (0, 1)),

  version                     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active                   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),

  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (competent_threshold > conditional_threshold),
  -- v0.1.9: 复合主键 (strategy_id, version)。一族多版本共享 strategy_id
  --（PRD「一族一 strategy_id」模型）。UNIQUE(type,job,version) 兜底防止
  -- 不同 strategy_id 复用同 (type,job,version) 组合。
  PRIMARY KEY (strategy_id, version),
  UNIQUE (strategy_type, job_code, version)
);

CREATE INDEX IF NOT EXISTS idx_strategy_config_type_job_active
  ON strategy_config(strategy_type, job_code, is_active);

-- ----------------------------------------------------------------------------
-- 3. Local asset resource integrity
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_resource (
  asset_id              TEXT PRIMARY KEY,
  asset_type            TEXT NOT NULL CHECK (asset_type IN (
                           'VIDEO', 'IMAGE', 'AUDIO', 'PDF', 'JSON', 'SQLITE', 'OTHER'
                         )),
  asset_role            TEXT CHECK (asset_role IS NULL OR asset_role IN (
                           'QUESTION_MEDIA',
                           'TOOL_CHECKLIST',
                           'REPORT_FILE',
                           'VOICE_PROMPT',
                           'UI_ASSET',
                           'DATA_SNAPSHOT',
                           'OTHER'
                         )),

  -- app_uri must be used by renderer process, e.g. app://assets/video/xxx.mp4
  app_uri               TEXT NOT NULL UNIQUE,
  local_path            TEXT NOT NULL,
  mime_type             TEXT,
  file_hash             TEXT NOT NULL,
  file_size_bytes       INTEGER NOT NULL CHECK (file_size_bytes >= 0),

  duration_ms           INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  width_px              INTEGER CHECK (width_px IS NULL OR width_px >= 0),
  height_px             INTEGER CHECK (height_px IS NULL OR height_px >= 0),

  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'MISSING', 'CORRUPTED', 'DEPRECATED')),
  last_verified_at      TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_resource_type_status
  ON asset_resource(asset_type, status);

CREATE INDEX IF NOT EXISTS idx_asset_resource_hash
  ON asset_resource(file_hash);

-- ----------------------------------------------------------------------------
-- 4. Question bank
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS question_bank (
  question_id           TEXT PRIMARY KEY,
  job_code              TEXT NOT NULL,
  module_type           TEXT NOT NULL CHECK (module_type IN (
                           'FINE_MOTOR',
                           'COGNITION',
                           'RULE_EXECUTION',
                           'EMOTION_REGULATION',
                           'BASIC_SOCIAL',
                           'SAFETY_OPERATION'
                         )),
  question_type         TEXT NOT NULL CHECK (question_type IN (
                           'TRUE_FALSE',
                           'SINGLE_CHOICE',
                           'DRAG',
                           'OFFLINE_OPERATION'
                         )),
  difficulty_level      INTEGER NOT NULL DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),

  -- JSON strings. App layer validates detailed schema.
  content_json          TEXT NOT NULL,
  scoring_rule_json     TEXT NOT NULL,

  media_asset_id        TEXT REFERENCES asset_resource(asset_id),

  -- JSON array of asset IDs, usually PDF/tool/media requirements for offline operation.
  tool_asset_ids_json   TEXT,

  safety_sensitive      INTEGER NOT NULL DEFAULT 0 CHECK (safety_sensitive IN (0, 1)),
  sensory_tags_json     TEXT,

  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'DRAFT', 'DISABLED', 'ARCHIVED')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_question_bank_job_module_type_status
  ON question_bank(job_code, module_type, question_type, status);

CREATE INDEX IF NOT EXISTS idx_question_bank_safety_sensitive
  ON question_bank(safety_sensitive);

-- ----------------------------------------------------------------------------
-- 5. Domain event projection
--    Projection only. action_log.jsonl remains the source of truth.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS domain_event_projection (
  event_id              TEXT PRIMARY KEY,
  aggregate_type        TEXT NOT NULL CHECK (aggregate_type IN (
                           'ASSESSMENT_SESSION',
                           'TRAINING_SESSION',
                           'STUDENT_PROFILE',
                           'STRATEGY_CONFIG',
                           'QUESTION_BANK',
                           'TASK_REPORT',
                           'SAFETY_INCIDENT',
                           'ASSET_RESOURCE',
                           'SYSTEM'
                         )),
  aggregate_id          TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  event_sequence        INTEGER NOT NULL CHECK (event_sequence >= 1),

  payload_json          TEXT NOT NULL,
  checksum              TEXT NOT NULL,

  source_log_path       TEXT NOT NULL,
  source_log_line_no    INTEGER CHECK (source_log_line_no IS NULL OR source_log_line_no >= 1),
  source_log_byte_offset INTEGER CHECK (source_log_byte_offset IS NULL OR source_log_byte_offset >= 0),

  schema_version        INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),

  applied_to_snapshot   INTEGER NOT NULL DEFAULT 0 CHECK (applied_to_snapshot IN (0, 1)),
  applied_at            TEXT,

  UNIQUE (aggregate_type, aggregate_id, event_sequence)
);

CREATE INDEX IF NOT EXISTS idx_domain_event_projection_aggregate
  ON domain_event_projection(aggregate_type, aggregate_id, event_sequence);

CREATE INDEX IF NOT EXISTS idx_domain_event_projection_type_created
  ON domain_event_projection(event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_domain_event_projection_applied
  ON domain_event_projection(applied_to_snapshot, created_at);

-- ----------------------------------------------------------------------------
-- 6. Assessment session and selected questions
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessment_session (
  session_id                    TEXT PRIMARY KEY,
  student_id                    TEXT NOT NULL REFERENCES student_profile(student_id),
  strategy_id                   TEXT NOT NULL,
  strategy_type                 TEXT NOT NULL CHECK (strategy_type IN (
                                 'BASELINE_ASSESSMENT',
                                 'MOCK_EXAM'
                               )),
  job_code                      TEXT NOT NULL,
  task_code                     TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  strategy_version              INTEGER NOT NULL CHECK (strategy_version >= 1),

  status                        TEXT NOT NULL CHECK (status IN (
                                 'INIT',
                                 'ACTIVE',
                                 'EMOTION_INTERRUPTED',
                                 'SUSPENDED_REVIEW_REQUIRED',
                                 'OFFLINE_PENDING',
                                 'COMPLETED',
                                 'REDLINE_HALTED',
                                 'ABORTED'
                               )),

  current_question_id           TEXT REFERENCES question_bank(question_id),
  online_question_count         INTEGER NOT NULL CHECK (online_question_count >= 0),
  offline_question_count        INTEGER NOT NULL CHECK (offline_question_count >= 0),
  online_completed_count        INTEGER NOT NULL DEFAULT 0 CHECK (online_completed_count >= 0),
  offline_completed_count       INTEGER NOT NULL DEFAULT 0 CHECK (offline_completed_count >= 0),

  pause_count                   INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  pause_started_at              TEXT,
  pause_duration_total_sec      INTEGER NOT NULL DEFAULT 0 CHECK (pause_duration_total_sec >= 0),
  last_interruption_reason      TEXT CHECK (last_interruption_reason IS NULL OR last_interruption_reason IN (
                                 'EMOTION', 'DEVICE', 'TEACHER_INTERVENTION', 'OTHER'
                               )),

  raw_score                     INTEGER CHECK (raw_score IS NULL OR raw_score >= 0),
  max_score                     INTEGER CHECK (max_score IS NULL OR max_score > 0),
  normalized_score              REAL CHECK (normalized_score IS NULL OR (normalized_score >= 0 AND normalized_score <= 100)),
  level_result                  TEXT CHECK (level_result IS NULL OR level_result IN (
                                 'LEVEL_COMPETENT',
                                 'LEVEL_CONDITIONAL',
                                 'LEVEL_NOT_COMPETENT',
                                 'LEVEL_FAIL_BY_SAFETY'
                               )),

  redline_incident_id           TEXT REFERENCES safety_incident(incident_id),
  is_report_generated           INTEGER NOT NULL DEFAULT 0 CHECK (is_report_generated IN (0, 1)),
  report_type                   TEXT CHECK (report_type IS NULL OR report_type IN (
                                 'FULL_REPORT', 'SAFETY_TERMINATION_REPORT'
                               )),

  started_at                    TEXT,
  completed_at                  TEXT,
  created_by                    TEXT NOT NULL REFERENCES user_account(user_id),
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now')),

  created_event_id              TEXT REFERENCES domain_event_projection(event_id),
  last_applied_event_id         TEXT REFERENCES domain_event_projection(event_id),
  last_status_event_id          TEXT REFERENCES domain_event_projection(event_id),

  CHECK (online_completed_count <= online_question_count),
  CHECK (offline_completed_count <= offline_question_count),
  CHECK (
    status <> 'REDLINE_HALTED'
    OR (
      COALESCE(level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
      AND redline_incident_id IS NOT NULL
      AND length(trim(redline_incident_id)) > 0
    )
  ),
  -- v0.1.9: 复合 FK——session 锁定到具体 (strategy_id, strategy_version)。
  -- strategy_config 复合 PK(strategy_id, version) 是此 FK 的父键。
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES strategy_config(strategy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_assessment_session_student_status
  ON assessment_session(student_id, status);

CREATE INDEX IF NOT EXISTS idx_assessment_session_strategy_status
  ON assessment_session(strategy_type, status);

CREATE INDEX IF NOT EXISTS idx_assessment_session_student_task_status
  ON assessment_session(student_id, task_code, status);

-- Open assessment sessions are INIT / ACTIVE / EMOTION_INTERRUPTED /
-- SUSPENDED_REVIEW_REQUIRED / OFFLINE_PENDING.
-- Same student + task + strategy_type may have only one open assessment session.
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_one_open_session_per_student_task_strategy
  ON assessment_session(student_id, task_code, strategy_type)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING');

CREATE INDEX IF NOT EXISTS idx_assessment_session_last_event
  ON assessment_session(last_applied_event_id);

CREATE TABLE IF NOT EXISTS assessment_session_question (
  session_question_id     TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id             TEXT NOT NULL REFERENCES question_bank(question_id),
  question_order          INTEGER NOT NULL CHECK (question_order >= 1),
  question_phase          TEXT NOT NULL CHECK (question_phase IN ('ONLINE', 'OFFLINE')),
  module_type             TEXT NOT NULL CHECK (module_type IN (
                            'FINE_MOTOR',
                            'COGNITION',
                            'RULE_EXECUTION',
                            'EMOTION_REGULATION',
                            'BASIC_SOCIAL',
                            'SAFETY_OPERATION'
                          )),
  question_type           TEXT NOT NULL CHECK (question_type IN (
                            'TRUE_FALSE',
                            'SINGLE_CHOICE',
                            'DRAG',
                            'OFFLINE_OPERATION'
                          )),
  generated_event_id      TEXT REFERENCES domain_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (session_id, question_order),
  UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_session_question_session_phase
  ON assessment_session_question(session_id, question_phase, question_order);

-- ----------------------------------------------------------------------------
-- 7. Online answer records and offline operation score records
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS answer_record (
  answer_id             TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id           TEXT NOT NULL REFERENCES question_bank(question_id),
  question_type         TEXT NOT NULL CHECK (question_type IN ('TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG')),

  answer_payload_json   TEXT NOT NULL,
  is_correct            INTEGER CHECK (is_correct IS NULL OR is_correct IN (0, 1)),
  score                 INTEGER NOT NULL DEFAULT 0 CHECK (score IN (0, 1, 2)),

  submitted_event_id    TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  submitted_at          TEXT NOT NULL DEFAULT (datetime('now')),

  revision_no           INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  status                TEXT NOT NULL DEFAULT 'VALID'
                         CHECK (status IN ('VALID', 'SUPERSEDED', 'VOID'))
);

CREATE INDEX IF NOT EXISTS idx_answer_record_session_question
  ON answer_record(session_id, question_id, revision_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_answer_record_one_valid_answer
  ON answer_record(session_id, question_id)
  WHERE status = 'VALID';

CREATE TABLE IF NOT EXISTS offline_score_record (
  offline_score_id          TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id               TEXT NOT NULL REFERENCES question_bank(question_id),

  score                     INTEGER NOT NULL CHECK (score IN (0, 1, 2)),
  scoring_rubric_json       TEXT NOT NULL,
  observation_note          TEXT,

  scored_by                 TEXT NOT NULL REFERENCES user_account(user_id),
  scored_event_id           TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  scored_at                 TEXT NOT NULL DEFAULT (datetime('now')),

  tool_checklist_confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (tool_checklist_confirmed IN (0, 1)),
  revision_no               INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  status                    TEXT NOT NULL DEFAULT 'VALID'
                            CHECK (status IN ('VALID', 'SUPERSEDED', 'VOID'))
);

CREATE INDEX IF NOT EXISTS idx_offline_score_session_question
  ON offline_score_record(session_id, question_id, revision_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_score_one_valid_score
  ON offline_score_record(session_id, question_id)
  WHERE status = 'VALID';

-- ----------------------------------------------------------------------------
-- 8. Safety incident: student-task level independent redline aggregate
--    Defined after training_session so batch-halt triggers can reference both session tables.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 9. Training session and training step records
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS training_session (
  training_session_id          TEXT PRIMARY KEY,
  student_id                   TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                     TEXT NOT NULL,
  task_code                    TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  -- Kept nullable in DDL for minimal v0.1.7 migration churn, but INSERT/UPDATE
  -- triggers below forbid NULL and require a matching strategy_config row.
  -- v0.1.9: 复合 FK 在表级声明（见 CREATE TABLE 末尾）。
  strategy_id                  TEXT,
  -- Training sessions always use TRAINING_PRACTICE. strategy_version is locked at
  -- creation time so historical training results remain reproducible even if
  -- strategy_config changes later. strategy_snapshot_json is nullable in MVP to
  -- avoid forcing full JSON snapshots before the strategy serializer is finalized.
  strategy_type                TEXT NOT NULL DEFAULT 'TRAINING_PRACTICE' CHECK (strategy_type = 'TRAINING_PRACTICE'),
  strategy_version             INTEGER NOT NULL CHECK (strategy_version >= 1),
  strategy_snapshot_json       TEXT,

  status                       TEXT NOT NULL CHECK (status IN (
                                'INIT',
                                'ACTIVE',
                                'EMOTION_INTERRUPTED',
                                'SUSPENDED_REVIEW_REQUIRED',
                                'COMPLETED',
                                'REDLINE_HALTED',
                                'ABORTED'
                              )),

  module_type                  TEXT CHECK (module_type IS NULL OR module_type IN (
                                'FINE_MOTOR',
                                'COGNITION',
                                'RULE_EXECUTION',
                                'EMOTION_REGULATION',
                                'BASIC_SOCIAL',
                                'SAFETY_OPERATION'
                              )),

  total_step_count             INTEGER NOT NULL DEFAULT 0 CHECK (total_step_count >= 0),
  completed_step_count         INTEGER NOT NULL DEFAULT 0 CHECK (completed_step_count >= 0),
  completion_rate              REAL CHECK (completion_rate IS NULL OR (completion_rate >= 0 AND completion_rate <= 100)),

  pause_count                  INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  pause_started_at             TEXT,
  pause_duration_total_sec     INTEGER NOT NULL DEFAULT 0 CHECK (pause_duration_total_sec >= 0),
  last_interruption_reason     TEXT CHECK (last_interruption_reason IS NULL OR last_interruption_reason IN (
                                'EMOTION', 'DEVICE', 'TEACHER_INTERVENTION', 'OTHER'
                              )),

  redline_incident_id          TEXT REFERENCES safety_incident(incident_id),
  started_at                   TEXT,
  completed_at                 TEXT,
  created_by                   TEXT NOT NULL REFERENCES user_account(user_id),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),

  created_event_id             TEXT REFERENCES domain_event_projection(event_id),
  last_applied_event_id        TEXT REFERENCES domain_event_projection(event_id),
  last_status_event_id         TEXT REFERENCES domain_event_projection(event_id),

  CHECK (completed_step_count <= total_step_count),
  CHECK (
    status <> 'REDLINE_HALTED'
    OR (
      redline_incident_id IS NOT NULL
      AND length(trim(redline_incident_id)) > 0
    )
  ),
  -- v0.1.9: 复合 FK（strategy_id 可空；NULL 时 SQL 标准跳过 FK 检查，由上面
  -- trg_training_session_strategy_config_match_insert/update 触发器强制非空+匹配）。
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES strategy_config(strategy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_training_session_student_status
  ON training_session(student_id, status);

CREATE INDEX IF NOT EXISTS idx_training_session_job_module
  ON training_session(job_code, module_type);

CREATE INDEX IF NOT EXISTS idx_training_session_student_task_status
  ON training_session(student_id, task_code, status);

CREATE INDEX IF NOT EXISTS idx_training_session_strategy
  ON training_session(strategy_type, strategy_version);

-- Open training sessions are INIT / ACTIVE / EMOTION_INTERRUPTED / SUSPENDED_REVIEW_REQUIRED.
-- Same student + task may have only one open training session.
CREATE UNIQUE INDEX IF NOT EXISTS ux_training_one_open_session_per_student_task
  ON training_session(student_id, task_code)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED');

CREATE TABLE IF NOT EXISTS training_step_record (
  training_step_record_id      TEXT PRIMARY KEY,
  training_session_id          TEXT NOT NULL REFERENCES training_session(training_session_id) ON DELETE RESTRICT,

  step_code                    TEXT NOT NULL,
  step_name                    TEXT NOT NULL,
  step_order                   INTEGER NOT NULL CHECK (step_order >= 1),
  step_type                    TEXT NOT NULL CHECK (step_type IN (
                                'WATCH',
                                'LEARN',
                                'PRACTICE',
                                'DO'
                              )),

  related_question_id          TEXT REFERENCES question_bank(question_id),
  media_asset_id               TEXT REFERENCES asset_resource(asset_id),

  -- PRD v1.0.3 aligned training step states. ACTIVE is replaced by
  -- IN_PROGRESS. VOID is intentionally not retained in MVP; skipped/failed
  -- steps remain explicit process records and are not silently voided.
  status                       TEXT NOT NULL DEFAULT 'NOT_STARTED'
                                CHECK (status IN (
                                  'NOT_STARTED',
                                  'IN_PROGRESS',
                                  'COMPLETED',
                                  'SKIPPED',
                                  'FAILED'
                                )),

  attempt_count                INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  score                        INTEGER CHECK (score IS NULL OR score IN (0, 1, 2)),
  required_duration_sec        INTEGER CHECK (required_duration_sec IS NULL OR required_duration_sec >= 0),
  actual_duration_sec          INTEGER CHECK (actual_duration_sec IS NULL OR actual_duration_sec >= 0),

  started_at                   TEXT,
  completed_at                 TEXT,
  generated_event_id           TEXT REFERENCES domain_event_projection(event_id),
  last_applied_event_id        TEXT REFERENCES domain_event_projection(event_id),
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (training_session_id, step_order),
  UNIQUE (training_session_id, step_code)
);

CREATE INDEX IF NOT EXISTS idx_training_step_session_status
  ON training_step_record(training_session_id, status, step_order);


-- ----------------------------------------------------------------------------
-- 10. Safety incident: student + task-level independent redline aggregate
-- ----------------------------------------------------------------------------

-- Lifecycle semantics:
--   PENDING_DETAIL: redline triggered; waiting for teacher to complete incident details.
--   CONFIRMED: incident facts confirmed by TEACHER; this is the fact-freeze point.
--   RESOLVED: incident is real; remediation completed; same student-task may start new sessions.
--   VOIDED: false trigger / duplicate / non-safety event; not treated as a real safety incident.
-- Allowed transitions:
--   PENDING_DETAIL -> CONFIRMED
--   PENDING_DETAIL -> VOIDED
--   CONFIRMED -> RESOLVED
--   CONFIRMED -> VOIDED
-- Terminal lifecycle states:
--   RESOLVED / VOIDED
--
-- Two-level permission projection:
--   TEACHER or ADMIN may create PENDING_DETAIL.
--   TEACHER confirms facts by setting CONFIRMED with confirmed_by.
--   ADMIN resolves/voids blockers by setting RESOLVED/VOIDED with resolved_by/resolved_at.
--   SQLite validates declared actor roles through user_account; the Electron main process must still
--   verify that the current authenticated operator matches the declared *_by field.
--
-- Fact immutability semantics:
--   PENDING_DETAIL is the only window where teachers may supplement/correct incident facts,
--   including reason_code, context_phase, and description. Once a row enters CONFIRMED,
--   core facts are immutable. If a confirmed incident is factually wrong, MVP flow is:
--   ADMIN marks it VOIDED, then a new safety_incident is created. No revision table is
--   introduced in v0.1.5.
--
-- Domain events expected in action_log.jsonl / domain_event_projection:
--   SAFETY_INCIDENT_CREATED
--   SAFETY_INCIDENT_DETAIL_CONFIRMED
--   SAFETY_INCIDENT_RESOLVED
--   SAFETY_INCIDENT_VOIDED
--
CREATE TABLE IF NOT EXISTS safety_incident (
  incident_id                         TEXT PRIMARY KEY,
  student_id                          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                            TEXT NOT NULL,
  task_code                           TEXT NOT NULL CHECK (length(trim(task_code)) > 0),

  trigger_event_id                    TEXT NOT NULL UNIQUE REFERENCES domain_event_projection(event_id),

  reason_code                         TEXT NOT NULL CHECK (reason_code IN (
                                        'BLADE_TOWARD_SELF',
                                        'BLADE_TOWARD_OTHERS',
                                        'DANGEROUS_CLIMBING',
                                        'THROWING_OBJECT',
                                        'AGGRESSIVE_BEHAVIOR',
                                        'OTHER_SAFETY_RISK'
                                      )),
  description                         TEXT,

  triggered_by                        TEXT NOT NULL REFERENCES user_account(user_id),
  confirmed_by                        TEXT REFERENCES user_account(user_id),
  occurred_at                         TEXT NOT NULL DEFAULT (datetime('now')),

  context_phase                       TEXT NOT NULL DEFAULT 'OTHER' CHECK (context_phase IN (
                                        'ONLINE_ASSESSMENT',
                                        'TRAINING_WATCH',
                                        'TRAINING_LEARN',
                                        'TRAINING_PRACTICE',
                                        'TRAINING_DO',
                                        'OFFLINE_SCORING',
                                        'TOOL_PREPARATION',
                                        'BREAK_OR_TRANSITION',
                                        'OTHER'
                                      )),

  status                              TEXT NOT NULL DEFAULT 'PENDING_DETAIL' CHECK (status IN (
                                        'PENDING_DETAIL',
                                        'CONFIRMED',
                                        'RESOLVED',
                                        'VOIDED'
                                      )),

  -- VOIDED semantics are split for audit and metrics.
  -- FALSE_TRIGGER / NON_SAFETY_EVENT do not count as real safety incidents.
  -- DUPLICATE_RECORD points to the retained primary incident.
  -- FACTUAL_CORRECTION means the real safety event exists, but this record's
  -- frozen facts were wrong; the replacement incident carries the corrected facts.
  void_reason                         TEXT CHECK (void_reason IS NULL OR void_reason IN (
                                        'FALSE_TRIGGER',
                                        'DUPLICATE_RECORD',
                                        'NON_SAFETY_EVENT',
                                        'FACTUAL_CORRECTION'
                                      )),
  replacement_incident_id             TEXT REFERENCES safety_incident(incident_id) ON DELETE RESTRICT,

  requires_review_before_next_session INTEGER NOT NULL DEFAULT 1 CHECK (requires_review_before_next_session IN (0, 1)),
  resolved_by                         TEXT REFERENCES user_account(user_id),
  resolved_at                         TEXT,

  created_at                          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                          TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (
    (status IN ('RESOLVED', 'VOIDED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status IN ('PENDING_DETAIL', 'CONFIRMED') AND resolved_by IS NULL AND resolved_at IS NULL)
  ),
  CHECK (
    (status = 'VOIDED' AND void_reason IS NOT NULL)
    OR (status <> 'VOIDED' AND void_reason IS NULL)
  ),
  CHECK (
    (void_reason IN ('FACTUAL_CORRECTION', 'DUPLICATE_RECORD') AND replacement_incident_id IS NOT NULL)
    OR (void_reason IN ('FALSE_TRIGGER', 'NON_SAFETY_EVENT') AND replacement_incident_id IS NULL)
    OR (void_reason IS NULL AND replacement_incident_id IS NULL)
  ),
  CHECK (replacement_incident_id IS NULL OR replacement_incident_id <> incident_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_incident_student_task_status
  ON safety_incident(student_id, task_code, status, requires_review_before_next_session);

CREATE INDEX IF NOT EXISTS idx_safety_incident_reason_occurred
  ON safety_incident(reason_code, occurred_at);

CREATE INDEX IF NOT EXISTS idx_safety_incident_context_phase
  ON safety_incident(context_phase, occurred_at);

-- VOIDED statistics semantics:
--   * FALSE_TRIGGER / NON_SAFETY_EVENT are excluded from real safety incident counts.
--   * DUPLICATE_RECORD is excluded from unique incident counts and should roll up to
--     replacement_incident_id.
--   * FACTUAL_CORRECTION is not a false alarm; the old incident is excluded from
--     unique incident counts, and the replacement incident carries the true event.
-- Safety-trigger rate may count all safety_incident rows, but real-safety-event
-- metrics must exclude false/non-safety rows and deduplicate duplicate/corrected rows.
--
-- FACTUAL_CORRECTION atomicity rule:
--   Void + replacement creation must be committed atomically by one domain-service
--   command / one database transaction. The UI must not issue independent UPDATEs.
--   The normal sequence is: create replacement safety_incident first, then update
--   the old incident to VOIDED with void_reason = FACTUAL_CORRECTION and
--   replacement_incident_id = replacement.incident_id.

CREATE TABLE IF NOT EXISTS safety_incident_binding (
  binding_id             TEXT PRIMARY KEY,
  incident_id            TEXT NOT NULL REFERENCES safety_incident(incident_id) ON DELETE RESTRICT,
  aggregate_type         TEXT NOT NULL CHECK (aggregate_type IN (
                           'ASSESSMENT_SESSION',
                           'TRAINING_SESSION'
                         )),
  aggregate_id           TEXT NOT NULL,
  pre_status             TEXT NOT NULL CHECK (pre_status IN (
                           'INIT',
                           'ACTIVE',
                           'EMOTION_INTERRUPTED',
                           'SUSPENDED_REVIEW_REQUIRED',
                           'OFFLINE_PENDING'
                         )),
  post_status            TEXT NOT NULL DEFAULT 'REDLINE_HALTED' CHECK (post_status = 'REDLINE_HALTED'),
  halt_event_id          TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (incident_id, aggregate_type, aggregate_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_incident_binding_incident
  ON safety_incident_binding(incident_id, aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_safety_incident_binding_aggregate
  ON safety_incident_binding(aggregate_type, aggregate_id);

-- ----------------------------------------------------------------------------
-- 10. Unified result records
--     Projection only. Do not treat result_record as source of truth.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS result_record (
  result_id               TEXT PRIMARY KEY,
  student_id              TEXT NOT NULL REFERENCES student_profile(student_id),

  result_type             TEXT NOT NULL CHECK (result_type IN (
                            'ABILITY_SCORE',
                            'TRAINING_COMPLETION',
                            'OPERATION_PASS_RATE'
                          )),

  source_aggregate_type   TEXT NOT NULL CHECK (source_aggregate_type IN (
                            'ASSESSMENT_SESSION',
                            'TRAINING_SESSION'
                          )),
  source_aggregate_id     TEXT NOT NULL,

  -- v0.1.9: result_record 不存 strategy_version，strategy_config 复合 PK 下
  -- 单列 strategy_id 不再是唯一父键。降为普通 TEXT，完整性由写入 handler 软保证
  --（result_record 是投影，源头 source_aggregate_id 指向 session，session 有完整版本锁定）。
  strategy_id             TEXT,
  strategy_type           TEXT CHECK (strategy_type IS NULL OR strategy_type IN (
                            'BASELINE_ASSESSMENT',
                            'MOCK_EXAM',
                            'TRAINING_PRACTICE'
                          )),
  job_code                TEXT NOT NULL,
  module_type             TEXT CHECK (module_type IS NULL OR module_type IN (
                            'FINE_MOTOR',
                            'COGNITION',
                            'RULE_EXECUTION',
                            'EMOTION_REGULATION',
                            'BASIC_SOCIAL',
                            'SAFETY_OPERATION'
                          )),

  raw_score               REAL,
  max_score               REAL,
  normalized_score        REAL NOT NULL CHECK (normalized_score >= 0 AND normalized_score <= 100),
  level_result            TEXT CHECK (level_result IS NULL OR level_result IN (
                            'LEVEL_COMPETENT',
                            'LEVEL_CONDITIONAL',
                            'LEVEL_NOT_COMPETENT',
                            'LEVEL_FAIL_BY_SAFETY'
                          )),

  safety_overridden       INTEGER NOT NULL DEFAULT 0 CHECK (safety_overridden IN (0, 1)),
  redline_incident_id     TEXT REFERENCES safety_incident(incident_id),

  -- Extra JSON projection for dimension breakdown, e.g. module scores.
  -- OPERATION_PASS_RATE is projected from assessment_session.offline_score_record only.
  result_payload_json     TEXT,

  generated_event_id      TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  snapshot_id             TEXT,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  is_current              INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),

  CHECK (
    (result_type IN ('ABILITY_SCORE', 'OPERATION_PASS_RATE') AND source_aggregate_type = 'ASSESSMENT_SESSION')
    OR (result_type = 'TRAINING_COMPLETION' AND source_aggregate_type = 'TRAINING_SESSION')
  ),
  CHECK (
    (
      safety_overridden = 0
      AND redline_incident_id IS NULL
      AND COALESCE(level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
    )
    OR (
      safety_overridden = 1
      AND redline_incident_id IS NOT NULL
      AND length(trim(redline_incident_id)) > 0
      AND COALESCE(level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_result_record_student_type_current
  ON result_record(student_id, result_type, is_current);

CREATE INDEX IF NOT EXISTS idx_result_record_source
  ON result_record(source_aggregate_type, source_aggregate_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_result_record_one_current_per_source_type
  ON result_record(result_type, source_aggregate_type, source_aggregate_id)
  WHERE is_current = 1;

-- ----------------------------------------------------------------------------
-- 11. Task report snapshots
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_report (
  report_id              TEXT PRIMARY KEY,
  -- PRD-level report_type enum is intentionally small in MVP.
  -- Use report_scope/report_section in a future version for single-section reports;
  -- do not pollute report_type with ABILITY/TRAINING/MOCK/TOOL variants.
  report_type            TEXT NOT NULL CHECK (report_type IN (
                           'FULL_REPORT',
                           'SAFETY_TERMINATION_REPORT'
                         )),
  student_id             TEXT REFERENCES student_profile(student_id),

  source_aggregate_type  TEXT CHECK (source_aggregate_type IS NULL OR source_aggregate_type IN (
                           'ASSESSMENT_SESSION',
                           'TRAINING_SESSION',
                           'SAFETY_INCIDENT',
                           'SYSTEM'
                         )),
  source_aggregate_id    TEXT,

  -- JSON array of result IDs used when this report was generated.
  source_result_ids_json TEXT,

  report_title           TEXT NOT NULL,
  report_content_json    TEXT NOT NULL,

  file_asset_id          TEXT REFERENCES asset_resource(asset_id),
  file_path              TEXT,
  file_hash              TEXT,

  snapshot_id            TEXT,
  generated_event_id     TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  generated_by           TEXT NOT NULL REFERENCES user_account(user_id),
  generated_at           TEXT NOT NULL DEFAULT (datetime('now')),

  status                 TEXT NOT NULL DEFAULT 'GENERATED'
                         CHECK (status IN ('GENERATED', 'LOCKED', 'EXPORTED', 'SUPERSEDED', 'ARCHIVED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_task_report_student_type
  ON task_report(student_id, report_type, generated_at);

CREATE INDEX IF NOT EXISTS idx_task_report_source
  ON task_report(source_aggregate_type, source_aggregate_id);

-- ----------------------------------------------------------------------------
-- 12. Snapshot metadata
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS snapshot_meta (
  snapshot_id             TEXT PRIMARY KEY,
  snapshot_sequence       INTEGER NOT NULL UNIQUE CHECK (snapshot_sequence >= 1),

  last_applied_event_id   TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  last_applied_sequence   INTEGER NOT NULL CHECK (last_applied_sequence >= 1),

  sqlite_file_hash        TEXT NOT NULL,
  action_log_path         TEXT NOT NULL,
  archived_log_path       TEXT,

  schema_version          TEXT NOT NULL,
  app_version             TEXT NOT NULL,

  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshot_meta_created
  ON snapshot_meta(created_at);

-- ----------------------------------------------------------------------------
-- 13. Exception center and error code system
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS error_code_registry (
  error_code             TEXT PRIMARY KEY,
  error_category         TEXT NOT NULL CHECK (error_category IN (
                           'IPC',
                           'DB',
                           'AOL',
                           'RECOVERY',
                           'ASSET',
                           'FSM',
                           'SCORING',
                           'REPORT',
                           'AUTH',
                           'SYSTEM'
                         )),
  severity               TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  priority_level         TEXT NOT NULL DEFAULT 'P2' CHECK (priority_level IN ('P0', 'P1', 'P2', 'P3')),
  title                  TEXT NOT NULL,
  default_message        TEXT NOT NULL,
  default_recovery_hint  TEXT,
  is_blocking            INTEGER NOT NULL DEFAULT 0 CHECK (is_blocking IN (0, 1)),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS error_event_log (
  error_event_id          TEXT PRIMARY KEY,
  error_code              TEXT NOT NULL REFERENCES error_code_registry(error_code),
  severity                TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  error_category          TEXT NOT NULL CHECK (error_category IN (
                            'IPC',
                            'DB',
                            'AOL',
                            'RECOVERY',
                            'ASSET',
                            'FSM',
                            'SCORING',
                            'REPORT',
                            'AUTH',
                            'SYSTEM'
                          )),

  related_aggregate_type  TEXT CHECK (related_aggregate_type IS NULL OR related_aggregate_type IN (
                            'ASSESSMENT_SESSION',
                            'TRAINING_SESSION',
                            'STUDENT_PROFILE',
                            'STRATEGY_CONFIG',
                            'QUESTION_BANK',
                            'TASK_REPORT',
                            'SAFETY_INCIDENT',
                            'ASSET_RESOURCE',
                            'SYSTEM'
                          )),
  related_aggregate_id    TEXT,
  related_event_id        TEXT REFERENCES domain_event_projection(event_id),

  message                 TEXT NOT NULL,
  context_json            TEXT,
  stack_trace             TEXT,
  recovery_action         TEXT,
  recovery_status         TEXT NOT NULL DEFAULT 'UNRESOLVED'
                           CHECK (recovery_status IN (
                             'UNRESOLVED',
                             'AUTO_RECOVERED',
                             'MANUAL_REVIEW_REQUIRED',
                             'RESOLVED',
                             'IGNORED'
                           )),

  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_event_log_code_created
  ON error_event_log(error_code, created_at);

CREATE INDEX IF NOT EXISTS idx_error_event_log_category_severity
  ON error_event_log(error_category, severity, created_at);

CREATE INDEX IF NOT EXISTS idx_error_event_log_related
  ON error_event_log(related_aggregate_type, related_aggregate_id);

-- Seed base error codes for MVP. Extend in application migrations.
INSERT OR IGNORE INTO error_code_registry (
  error_code,
  error_category,
  severity,
  priority_level,
  title,
  default_message,
  default_recovery_hint,
  is_blocking
) VALUES
  ('IPC_WRITE_TIMEOUT', 'IPC', 'ERROR', 'P1', 'IPC 写入超时', '主进程未在预期时间内返回写入确认。', '请重试；若持续失败，进入异常中心查看日志。', 1),
  ('AOL_APPEND_FAILED', 'AOL', 'CRITICAL', 'P0', '事件日志写入失败', 'action_log.jsonl 追加写入失败。', '停止当前会话，检查磁盘权限与剩余空间。', 1),
  ('AOL_CHECKSUM_MISMATCH', 'AOL', 'CRITICAL', 'P0', '事件日志校验失败', '事件 checksum 与实际内容不匹配。', '执行恢复流程，并将该事件标记为人工复核。', 1),
  ('RECOVERY_LOG_TRUNCATED', 'RECOVERY', 'WARN', 'P3', '恢复时截断损坏日志', '冷启动恢复时发现最后一行 JSONL 损坏并已跳过。', '检查上次异常退出原因，确认恢复结果。', 0),
  ('SNAPSHOT_COMMIT_FAILED', 'DB', 'CRITICAL', 'P0', 'SQLite 快照提交失败', '数据库快照原子写入失败。', '保留 action_log，禁止清理日志，等待下次恢复。', 1),
  ('ASSET_HASH_MISMATCH', 'ASSET', 'ERROR', 'P1', '资源文件哈希不一致', '本地资源文件与登记哈希不一致。', '重新校验或替换资源包。', 1),
  ('ASSET_MISSING', 'ASSET', 'ERROR', 'P1', '资源文件缺失', '题目或报告绑定的本地资源不存在。', '检查资源包完整性，重新导入资源。', 1),
  ('FSM_INVALID_TRANSITION', 'FSM', 'ERROR', 'P1', '非法状态迁移', '当前状态不允许执行该事件。', '阻断该事件，提示教师刷新后重试。', 1),
  ('SCORING_POLICY_MISSING', 'SCORING', 'ERROR', 'P1', '评分策略缺失', 'strategy_config 中缺少必要评分策略。', '禁用相关测评入口并修复策略配置。', 1),
  ('REPORT_GENERATION_FAILED', 'REPORT', 'ERROR', 'P2', '报告生成失败', '报告快照或文件导出失败。', '保留 result_record，允许重新生成报告。', 0);

-- ----------------------------------------------------------------------------
-- 14. Terminal-state protection triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_no_terminal_status_change
BEFORE UPDATE OF status ON assessment_session
FOR EACH ROW
WHEN OLD.status IN ('COMPLETED', 'REDLINE_HALTED', 'ABORTED')
     AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'assessment_session terminal status cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_requires_fail_by_safety
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
BEGIN
  SELECT RAISE(ABORT, 'REDLINE_HALTED requires LEVEL_FAIL_BY_SAFETY');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_update_requires_fail_by_safety
BEFORE UPDATE ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
BEGIN
  SELECT RAISE(ABORT, 'REDLINE_HALTED requires LEVEL_FAIL_BY_SAFETY');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_no_terminal_status_change
BEFORE UPDATE OF status ON training_session
FOR EACH ROW
WHEN OLD.status IN ('COMPLETED', 'REDLINE_HALTED', 'ABORTED')
     AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'training_session terminal status cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_no_delete
BEFORE DELETE ON assessment_session
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assessment_session cannot be deleted; append SESSION_ABORTED or archive via event');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_no_delete
BEFORE DELETE ON training_session
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'training_session cannot be deleted; append SESSION_ABORTED or archive via event');
END;

CREATE TRIGGER IF NOT EXISTS trg_result_record_insert_safety_override_guard
BEFORE INSERT ON result_record
FOR EACH ROW
WHEN (
  (NEW.safety_overridden = 1 AND (
    COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
    OR NEW.redline_incident_id IS NULL
    OR length(trim(NEW.redline_incident_id)) = 0
  ))
  OR (COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.safety_overridden <> 1)
)
BEGIN
  SELECT RAISE(ABORT, 'safety override result must use LEVEL_FAIL_BY_SAFETY and redline_incident_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_result_record_update_safety_override_guard
BEFORE UPDATE ON result_record
FOR EACH ROW
WHEN (
  (NEW.safety_overridden = 1 AND (
    COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
    OR NEW.redline_incident_id IS NULL
    OR length(trim(NEW.redline_incident_id)) = 0
  ))
  OR (COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.safety_overridden <> 1)
)
BEGIN
  SELECT RAISE(ABORT, 'safety override result must use LEVEL_FAIL_BY_SAFETY and redline_incident_id');
END;



-- ----------------------------------------------------------------------------
-- 15. v0.1.7 consistency guards
-- ----------------------------------------------------------------------------
-- Strategy reference consistency:
--   assessment_session / training_session must lock and reference one exact
--   strategy_config row by strategy_id + strategy_type + job_code + strategy_version.
--   This prevents mixed references such as a MOCK_EXAM session pointing at a
--   BASELINE_ASSESSMENT strategy row, or a session using a stale version number.
--   The source of truth remains action_log.jsonl; these triggers harden the
--   SQLite projection against inconsistent writes.

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_strategy_config_match_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM strategy_config sc
  WHERE sc.strategy_id = NEW.strategy_id
    AND sc.strategy_type = NEW.strategy_type
    AND sc.job_code = NEW.job_code
    AND sc.version = NEW.strategy_version
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session strategy_id/type/job_code/version must match strategy_config');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_strategy_config_match_update
BEFORE UPDATE ON assessment_session
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM strategy_config sc
  WHERE sc.strategy_id = NEW.strategy_id
    AND sc.strategy_type = NEW.strategy_type
    AND sc.job_code = NEW.job_code
    AND sc.version = NEW.strategy_version
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session strategy_id/type/job_code/version must match strategy_config');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_strategy_config_match_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.strategy_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM strategy_config sc
       WHERE sc.strategy_id = NEW.strategy_id
         AND sc.strategy_type = NEW.strategy_type
         AND sc.job_code = NEW.job_code
         AND sc.version = NEW.strategy_version
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session strategy_id/type/job_code/version must match strategy_config');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_strategy_config_match_update
BEFORE UPDATE ON training_session
FOR EACH ROW
WHEN NEW.strategy_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM strategy_config sc
       WHERE sc.strategy_id = NEW.strategy_id
         AND sc.strategy_type = NEW.strategy_type
         AND sc.job_code = NEW.job_code
         AND sc.version = NEW.strategy_version
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session strategy_id/type/job_code/version must match strategy_config');
END;

-- Redline incident consistency:
--   REDLINE_HALTED sessions must point to a safety_incident belonging to the same
--   student_id + task_code. These guards intentionally do not change the existing
--   batch redline triggers; they validate the result of those triggers and reject
--   any direct inconsistent status/redline_incident write.

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_task_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1
       FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_task_update
BEFORE UPDATE ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1
       FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_task_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1
       FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_task_update
BEFORE UPDATE ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1
       FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id and task_code');
END;

-- ----------------------------------------------------------------------------
-- 15. v0.1.2 safety-gating and batch-redline triggers
-- ----------------------------------------------------------------------------

-- Architecture judgment: INIT -> REDLINE_HALTED is allowed only through a
-- student-task safety_incident batch halt. This covers tool preparation or
-- pre-start risk after a session shell has already been created. Directly
-- inserting a session in REDLINE_HALTED is forbidden.

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_no_insert_redline_status
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
BEGIN
  SELECT RAISE(ABORT, 'assessment_session cannot be inserted directly as REDLINE_HALTED; create safety_incident first');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_no_insert_redline_status
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
BEGIN
  SELECT RAISE(ABORT, 'training_session cannot be inserted directly as REDLINE_HALTED; create safety_incident first');
END;

-- Explicit redline FSM paths.
-- AssessmentSession allowed paths:
--   INIT -> REDLINE_HALTED  (only via safety_incident batch halt)
--   ACTIVE -> REDLINE_HALTED
--   EMOTION_INTERRUPTED -> REDLINE_HALTED
--   SUSPENDED_REVIEW_REQUIRED -> REDLINE_HALTED
--   OFFLINE_PENDING -> REDLINE_HALTED
CREATE TRIGGER IF NOT EXISTS trg_assessment_session_explicit_redline_paths
BEFORE UPDATE OF status ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND OLD.status NOT IN (
       'INIT',
       'ACTIVE',
       'EMOTION_INTERRUPTED',
       'SUSPENDED_REVIEW_REQUIRED',
       'OFFLINE_PENDING'
     )
BEGIN
  SELECT RAISE(ABORT, 'invalid assessment_session redline path');
END;

-- TrainingSession allowed paths:
--   INIT -> REDLINE_HALTED  (only via safety_incident batch halt)
--   ACTIVE -> REDLINE_HALTED
--   EMOTION_INTERRUPTED -> REDLINE_HALTED
--   SUSPENDED_REVIEW_REQUIRED -> REDLINE_HALTED
CREATE TRIGGER IF NOT EXISTS trg_training_session_explicit_redline_paths
BEFORE UPDATE OF status ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND OLD.status NOT IN (
       'INIT',
       'ACTIVE',
       'EMOTION_INTERRUPTED',
       'SUSPENDED_REVIEW_REQUIRED'
     )
BEGIN
  SELECT RAISE(ABORT, 'invalid training_session redline path');
END;

-- Unresolved student-task safety incidents block future assessment sessions.
CREATE TRIGGER IF NOT EXISTS trg_assessment_session_block_unresolved_safety_incident
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new assessment_session for this student and task');
END;

-- Unresolved student-task safety incidents block future training sessions.
CREATE TRIGGER IF NOT EXISTS trg_training_session_block_unresolved_safety_incident
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new training_session for this student and task');
END;

-- Any unresolved student-task safety incident must require review before the next session,
-- regardless of whether open sessions existed at the time of the incident.
-- This is stricter than the no-session rule and reflects the site safety discipline:
-- PENDING_DETAIL / CONFIRMED incidents are unresolved blockers; RESOLVED / VOIDED incidents release the blocker.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_unresolved_requires_review_insert
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
     AND COALESCE(NEW.requires_review_before_next_session, 0) <> 1
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety_incident must require review before next session');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_unresolved_requires_review_update
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
     AND COALESCE(NEW.requires_review_before_next_session, 0) <> 1
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety_incident must require review before next session');
END;

-- Safety incident lifecycle and two-level permission projection guards.
-- These guards are projection-level invariants. The source of truth remains action_log.jsonl;
-- the Electron main process must advance safety_incident status by validated domain events only.

-- A new safety incident must represent event creation only. Resolution/voiding is a later action.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_insert_requires_pending_detail
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status <> 'PENDING_DETAIL'
BEGIN
  SELECT RAISE(ABORT, 'new safety_incident must be inserted as PENDING_DETAIL');
END;

-- Redline creation may be declared by TEACHER or ADMIN. In normal product flow this is expected
-- from TEACHER; ADMIN is allowed for onsite supervisor intervention and data correction workflows.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_insert_triggered_by_role
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM user_account u
  WHERE u.user_id = NEW.triggered_by
    AND u.role IN ('TEACHER', 'ADMIN')
    AND u.status = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'safety_incident.triggered_by must reference an active TEACHER or ADMIN');
END;

-- PENDING_DETAIL has not yet been fact-confirmed.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_pending_has_no_confirmed_by
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status = 'PENDING_DETAIL' AND NEW.confirmed_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PENDING_DETAIL safety_incident must not have confirmed_by');
END;

-- Only the explicit lifecycle transitions are legal.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_status_transition_guard
BEFORE UPDATE OF status ON safety_incident
FOR EACH ROW
WHEN OLD.status <> NEW.status
     AND NOT (
       (OLD.status = 'PENDING_DETAIL' AND NEW.status IN ('CONFIRMED', 'VOIDED'))
       OR
       (OLD.status = 'CONFIRMED' AND NEW.status IN ('RESOLVED', 'VOIDED'))
     )
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_incident lifecycle transition');
END;

-- CONFIRMED means incident facts were confirmed by an active TEACHER.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_confirmed_requires_teacher
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.status = 'CONFIRMED'
     AND NOT EXISTS (
       SELECT 1 FROM user_account u
       WHERE u.user_id = NEW.confirmed_by
         AND u.role = 'TEACHER'
         AND u.status = 'ACTIVE'
     )
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED safety_incident requires confirmed_by to reference an active TEACHER');
END;

-- RESOLVED / VOIDED release the blocker and require an active ADMIN identity plus resolved_at.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_terminal_requires_admin
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('RESOLVED', 'VOIDED')
     AND (
       NEW.resolved_at IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM user_account u
         WHERE u.user_id = NEW.resolved_by
           AND u.role = 'ADMIN'
           AND u.status = 'ACTIVE'
       )
     )
BEGIN
  SELECT RAISE(ABORT, 'RESOLVED/VOIDED safety_incident requires resolved_by to reference an active ADMIN and resolved_at to be set');
END;

-- VOIDED requires a classified void_reason; non-VOIDED incidents must not carry void metadata.
-- CHECK constraints enforce the same condition for normal writes; these triggers add
-- clearer error messages and cross-row replacement lineage validation.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_task_insert
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id
         AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must exist and have the same student_id + task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_task_update
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id
         AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must exist and have the same student_id + task_code');
END;

-- Once safety_incident leaves PENDING_DETAIL, core incident facts are immutable.
-- CONFIRMED is the fact-freeze point. To correct a confirmed factual error, ADMIN
-- must VOID the incident and create a new safety_incident.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_core_facts_immutable_after_confirmed
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN OLD.status IN ('CONFIRMED', 'RESOLVED', 'VOIDED')
     AND (
       OLD.student_id <> NEW.student_id
       OR OLD.job_code <> NEW.job_code
       OR OLD.task_code <> NEW.task_code
       OR OLD.trigger_event_id <> NEW.trigger_event_id
       OR OLD.reason_code <> NEW.reason_code
       OR OLD.context_phase <> NEW.context_phase
       OR COALESCE(OLD.description, '') <> COALESCE(NEW.description, '')
       OR OLD.triggered_by <> NEW.triggered_by
       OR COALESCE(OLD.confirmed_by, '') <> COALESCE(NEW.confirmed_by, '')
       OR OLD.occurred_at <> NEW.occurred_at
     )
BEGIN
  SELECT RAISE(ABORT, 'confirmed/terminal safety_incident core fact fields are immutable');
END;

-- RESOLVED / VOIDED are terminal. Their resolution audit fields cannot be changed.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_terminal_resolution_immutable
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN OLD.status IN ('RESOLVED', 'VOIDED')
     AND (
       OLD.status <> NEW.status
       OR COALESCE(OLD.resolved_by, '') <> COALESCE(NEW.resolved_by, '')
       OR COALESCE(OLD.resolved_at, '') <> COALESCE(NEW.resolved_at, '')
       OR COALESCE(OLD.void_reason, '') <> COALESCE(NEW.void_reason, '')
       OR COALESCE(OLD.replacement_incident_id, '') <> COALESCE(NEW.replacement_incident_id, '')
     )
BEGIN
  SELECT RAISE(ABORT, 'terminal safety_incident status, resolution, and void lineage fields are immutable');
END;

-- Bind all open assessment sessions affected by a new student-task safety incident.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_assessments
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id,
    incident_id,
    aggregate_type,
    aggregate_id,
    pre_status,
    post_status,
    halt_event_id,
    created_at
  )
  SELECT
    NEW.incident_id || ':ASSESSMENT_SESSION:' || s.session_id,
    NEW.incident_id,
    'ASSESSMENT_SESSION',
    s.session_id,
    s.status,
    'REDLINE_HALTED',
    NEW.trigger_event_id,
    datetime('now')
  FROM assessment_session s
  WHERE s.student_id = NEW.student_id
    AND s.task_code = NEW.task_code
    AND s.status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING');

  UPDATE assessment_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      level_result = 'LEVEL_FAIL_BY_SAFETY',
      report_type = 'SAFETY_TERMINATION_REPORT',
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id
    AND task_code = NEW.task_code
    AND status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING');
END;

-- Bind all open training sessions affected by a new student-task safety incident.
CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_trainings
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id,
    incident_id,
    aggregate_type,
    aggregate_id,
    pre_status,
    post_status,
    halt_event_id,
    created_at
  )
  SELECT
    NEW.incident_id || ':TRAINING_SESSION:' || t.training_session_id,
    NEW.incident_id,
    'TRAINING_SESSION',
    t.training_session_id,
    t.status,
    'REDLINE_HALTED',
    NEW.trigger_event_id,
    datetime('now')
  FROM training_session t
  WHERE t.student_id = NEW.student_id
    AND t.task_code = NEW.task_code
    AND t.status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED');

  UPDATE training_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id
    AND task_code = NEW.task_code
    AND status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED');
END;

-- If a result is generated for a redline-halted session, it must reflect safety override.
CREATE TRIGGER IF NOT EXISTS trg_result_record_redline_source_insert_guard
BEFORE INSERT ON result_record
FOR EACH ROW
WHEN (
  (
    NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND EXISTS (
      SELECT 1 FROM assessment_session s
      WHERE s.session_id = NEW.source_aggregate_id
        AND s.status = 'REDLINE_HALTED'
        AND NOT (
          NEW.safety_overridden = 1
          AND COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
          AND NEW.redline_incident_id = s.redline_incident_id
        )
    )
  )
  OR
  (
    NEW.source_aggregate_type = 'TRAINING_SESSION'
    AND EXISTS (
      SELECT 1 FROM training_session t
      WHERE t.training_session_id = NEW.source_aggregate_id
        AND t.status = 'REDLINE_HALTED'
        AND NOT (
          NEW.safety_overridden = 1
          AND COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
          AND NEW.redline_incident_id = t.redline_incident_id
        )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'result_record for redline-halted session must be safety-overridden');
END;

CREATE TRIGGER IF NOT EXISTS trg_result_record_redline_source_update_guard
BEFORE UPDATE ON result_record
FOR EACH ROW
WHEN (
  (
    NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND EXISTS (
      SELECT 1 FROM assessment_session s
      WHERE s.session_id = NEW.source_aggregate_id
        AND s.status = 'REDLINE_HALTED'
        AND NOT (
          NEW.safety_overridden = 1
          AND COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
          AND NEW.redline_incident_id = s.redline_incident_id
        )
    )
  )
  OR
  (
    NEW.source_aggregate_type = 'TRAINING_SESSION'
    AND EXISTS (
      SELECT 1 FROM training_session t
      WHERE t.training_session_id = NEW.source_aggregate_id
        AND t.status = 'REDLINE_HALTED'
        AND NOT (
          NEW.safety_overridden = 1
          AND COALESCE(NEW.level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
          AND NEW.redline_incident_id = t.redline_incident_id
        )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'result_record for redline-halted session must be safety-overridden');
END;

-- Redline-halted sessions and safety incidents can only produce safety termination reports.
CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_insert_guard
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (
    NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND EXISTS (
      SELECT 1 FROM assessment_session s
      WHERE s.session_id = NEW.source_aggregate_id
        AND s.status = 'REDLINE_HALTED'
    )
    AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT'
  )
  OR (
    NEW.source_aggregate_type = 'TRAINING_SESSION'
    AND EXISTS (
      SELECT 1 FROM training_session t
      WHERE t.training_session_id = NEW.source_aggregate_id
        AND t.status = 'REDLINE_HALTED'
    )
    AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_update_guard
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (
    NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND EXISTS (
      SELECT 1 FROM assessment_session s
      WHERE s.session_id = NEW.source_aggregate_id
        AND s.status = 'REDLINE_HALTED'
    )
    AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT'
  )
  OR (
    NEW.source_aggregate_type = 'TRAINING_SESSION'
    AND EXISTS (
      SELECT 1 FROM training_session t
      WHERE t.training_session_id = NEW.source_aggregate_id
        AND t.status = 'REDLINE_HALTED'
    )
    AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;


-- ----------------------------------------------------------------------------
-- 16. v0.1.5 strategy_config historical-version immutability
-- ----------------------------------------------------------------------------
-- If a strategy_config (strategy_id, version) row has been referenced by any
-- assessment_session or training_session, the row is historical fact. Do not
-- update semantic fields in place. Insert a new version for any policy change.
-- Allowed updates on referenced rows are limited to is_active and updated_at.
CREATE TRIGGER IF NOT EXISTS trg_strategy_config_referenced_version_semantic_immutable
BEFORE UPDATE ON strategy_config
FOR EACH ROW
WHEN (
  EXISTS (
    SELECT 1 FROM assessment_session s
    WHERE s.strategy_id = OLD.strategy_id
      AND s.strategy_version = OLD.version
  )
  OR EXISTS (
    SELECT 1 FROM training_session t
    WHERE t.strategy_id = OLD.strategy_id
      AND t.strategy_version = OLD.version
  )
)
AND (
  OLD.strategy_type IS NOT NEW.strategy_type
  OR OLD.job_code IS NOT NEW.job_code
  OR OLD.strategy_name IS NOT NEW.strategy_name
  OR OLD.online_question_count IS NOT NEW.online_question_count
  OR OLD.offline_question_count IS NOT NEW.offline_question_count
  OR OLD.max_score IS NOT NEW.max_score
  OR OLD.competent_threshold IS NOT NEW.competent_threshold
  OR OLD.conditional_threshold IS NOT NEW.conditional_threshold
  OR OLD.module_veto_threshold IS NOT NEW.module_veto_threshold
  OR OLD.emotion_collapse_threshold IS NOT NEW.emotion_collapse_threshold
  OR OLD.question_policy_json IS NOT NEW.question_policy_json
  OR OLD.scoring_policy_json IS NOT NEW.scoring_policy_json
  OR OLD.supports_redline_halt IS NOT NEW.supports_redline_halt
  OR OLD.allows_emotion_interrupt IS NOT NEW.allows_emotion_interrupt
  OR OLD.requires_offline_scoring IS NOT NEW.requires_offline_scoring
  OR OLD.version IS NOT NEW.version
)
BEGIN
  SELECT RAISE(ABORT, 'referenced strategy_config version semantic fields are immutable; insert a new version instead');
END;

-- ----------------------------------------------------------------------------
-- 15. Recommended seed strategies for MVP (v0.1.8 base-ability spec)
--     PRD v1.0.5 §2.4: BASELINE_ASSESSMENT and MOCK_EXAM share the same
--     base-ability item spec (online 42 = 6 modules x 7, offline 8, max 100).
--     These IDs can be replaced by deterministic UUIDs in implementation.
-- ----------------------------------------------------------------------------

INSERT OR IGNORE INTO strategy_config (
  strategy_id,
  strategy_type,
  job_code,
  strategy_name,
  online_question_count,
  offline_question_count,
  max_score,
  competent_threshold,
  conditional_threshold,
  module_veto_threshold,
  emotion_collapse_threshold,
  question_policy_json,
  scoring_policy_json,
  supports_redline_halt,
  allows_emotion_interrupt,
  requires_offline_scoring,
  version,
  is_active
) VALUES (
  'strategy_baseline_shelver_v1',
  'BASELINE_ASSESSMENT',
  'SUPERMARKET_SHELVER',
  '理货员基础能力评估 v1',
  42,
  8,
  100,
  80,
  60,
  0.5,
  3,
  '{"module_scope":"CROSS_MODULE","question_ratio":{"TRUE_FALSE":14,"SINGLE_CHOICE":14,"DRAG":14,"OFFLINE_OPERATION":8},"required_modules":["FINE_MOTOR","COGNITION","RULE_EXECUTION","EMOTION_REGULATION","BASIC_SOCIAL","SAFETY_OPERATION"]}',
  '{"score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"level_rules":[{"min":80,"max":100,"level":"LEVEL_COMPETENT"},{"min":60,"max":79,"level":"LEVEL_CONDITIONAL"},{"min":0,"max":59,"level":"LEVEL_NOT_COMPETENT"}]}',
  1,
  1,
  1,
  1,
  1
);

INSERT OR IGNORE INTO strategy_config (
  strategy_id,
  strategy_type,
  job_code,
  strategy_name,
  online_question_count,
  offline_question_count,
  max_score,
  competent_threshold,
  conditional_threshold,
  module_veto_threshold,
  emotion_collapse_threshold,
  question_policy_json,
  scoring_policy_json,
  supports_redline_halt,
  allows_emotion_interrupt,
  requires_offline_scoring,
  version,
  is_active
) VALUES (
  'strategy_mock_shelver_v1',
  'MOCK_EXAM',
  'SUPERMARKET_SHELVER',
  '理货员基础能力标准化模拟卷 v1',
  42,
  8,
  100,
  80,
  60,
  0.5,
  3,
  '{"module_scope":"CROSS_MODULE","question_ratio":{"TRUE_FALSE":14,"SINGLE_CHOICE":14,"DRAG":14,"OFFLINE_OPERATION":8},"required_modules":["FINE_MOTOR","COGNITION","RULE_EXECUTION","EMOTION_REGULATION","BASIC_SOCIAL","SAFETY_OPERATION"]}',
  '{"score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"level_rules":[{"min":80,"max":100,"level":"LEVEL_COMPETENT"},{"min":60,"max":79,"level":"LEVEL_CONDITIONAL"},{"min":0,"max":59,"level":"LEVEL_NOT_COMPETENT"}]}',
  1,
  1,
  1,
  1,
  1
);

-- ============================================================================
-- End of schema.sql v0.1.9-strategy-composite-pk
-- ============================================================================

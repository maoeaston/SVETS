-- ============================================================================
-- 炫灿-职途向导系统 MVP schema.sql v0.1.18-event-batch-v2.2
-- Architecture baseline:
--   1. Lightweight event sourcing + SQLite projection.
--   2. action_log.jsonl is the source of truth; SQLite is a query snapshot.
--   3. strategy_config is the single source for scoring, paper generation, and thresholds.
--   4. State transitions are driven by domain events only.
--   5. COMPLETED / REDLINE_HALTED / ABORTED are terminal states.
--   6. LEVEL_FAIL_BY_SAFETY overrides all score-based results.
--   7. training_session + training_step_record support training completion.
--   8. result_record supports ability score, training completion, operation pass rate, and job skill score.
--   9. error_event_log + error_code_registry support the exception center and error codes.
--  10. task_report + asset_resource support report snapshots and local asset integrity.
--  11. question_bank supports bank_domain isolation (BASE_ABILITY / JOB_SPECIFIC).
--  12. JOB_SKILL_ASSESSMENT strategy supports fixed demo paper with M1-M6 modules.
--  13. M5B v2.2 durable command ledger and event-batch apply cursors are the
--      production write/recovery boundary; action_log.jsonl is sealed legacy input.
-- ----------------------------------------------------------------------------
-- Merged from v0.1.10-scoring-closure + PRD v1.0.7 + v1.0.8 + v1.0.9.
-- M5B v0.1.18 patch notes:
--   1. command_log makes mutation idempotency, leases, attempts and public
--      completion results durable.
--   2. applied_event_batch, processed_event and projector_cursor make v2
--      prepare/apply/recovery progress independently verifiable.
-- v0.1.15 patch notes (multi-device M3 — grant assignment foundation):
--   Ref: doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md §6.2, §6.3, §7.5 D1/D9-D11
--   1. assessment_session.delivery_phase now includes ASSIGNED and STUDENT_CONFIRMED.
--   2. delegated_access_grant and business_session_assignment are now part of the full baseline.
--   3. D1 enforces the full delivery_phase forward-only state machine.
--   4. D9-D11 enforce grant self-consistency, assignment-grant consistency, and active assignment grant status.
-- F6 patch notes (scoring framework — score scope contract):
--   1. offline_score_record.score_scope no longer defaults to OFFLINE_ABILITY;
--      every scoring writer must pass an explicit scope.
-- F7 patch notes (report framework):
--   1. task_closure records teacher-confirmed BASE_ABILITY result bindings and revisions.
--   2. task_report stores immutable lineage, source/hash, contract, and lifecycle facts.
--   3. TASK_CLOSURE is a first-class event/error aggregate.
-- v0.1.14 patch notes (multi-device M2 — business session foundation):
--   Ref: doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md §7.5 D2-D6/D8
--   1. business_session parent table is now enforced for assessment/training child sessions.
--   2. assessment_session carries delivery_phase, event_sequence_version, observation_template_id.
--   3. D2-D6/D8 triggers enforce prepared inserts, abnormal phase freeze,
--      COMPLETED/FINALIZED consistency, parent-child four-key matching, and parent key immutability.
--   4. D1 and D7 are intentionally deferred to M3/M6.
-- v0.1.13 patch notes (multi-device M1 — identity & topology foundation):
--   Ref: doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md §7.2 T1-T5, §7.3 B1, §7.4
--   1. New tables (pure additive): organization, node, device, device_runtime_session, auth_session.
--   2. student_profile: inline new nullable user_id (FK -> user_account, ON DELETE SET NULL).
--   3. New indexes: ux_device_one_active_runtime, idx_auth_session_user_status,
--      idx_auth_session_token, ux_student_profile_user_id.
--   4. No triggers, no changes to existing business tables/FSM/safety semantics (deferred to M2+).
--   5. organization NOT seeded here (UUID generated at install; no fixed org_default).
--   Existing v0.1.12 DBs are upgraded by src/main/db/migrations.ts before this full schema runs.
-- v0.1.12 patch notes:
--   1. question_bank: status DEFAULT 'DRAFT'; question_type adds SOFTWARE_TASK;
--      new columns item_usage, bank_domain, job_module_code; module_type nullable;
--      domain pairing CHECK; extended freeze trigger (ACTIVE-is-frozen).
--   2. strategy_config: strategy_type adds JOB_SKILL_ASSESSMENT; new seed row.
--   3. assessment_session: strategy_type adds JOB_SKILL_ASSESSMENT.
--   4. assessment_session_question: question_type adds SOFTWARE_TASK;
--      question_phase adds OBSERVATION; new columns bank_domain, job_module_code,
--      item_usage; module_type nullable; domain/phase pairing CHECKs;
--      INSERT validation trigger.
--   5. answer_record: question_type adds SOFTWARE_TASK; new response_status;
--      score nullable; ANSWERED/non-ANSWERED pairing CHECK.
--   6. offline_score_record: score_scope adds JOB_SKILL and TEACHER_OBSERVATION;
--      new response_status and observation_payload_json; score nullable;
--      scope-specific CHECKs; extended unique indexes.
--   7. result_record: result_type adds JOB_SKILL_SCORE; strategy_type adds
--      JOB_SKILL_ASSESSMENT; source constraint extended.
--   8. Seed strategy_config: question_policy_json upgraded to v1.2 format;
--      new JOB_SKILL_ASSESSMENT strategy seed.
-- ============================================================================

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
  sensory_profile_json TEXT,
  -- v0.1.13 (M1): optional link to a login account; allows account-less student profiles
  -- (teacher-created). ON DELETE SET NULL: deleting the account detaches, never deletes the profile.
  user_id              TEXT REFERENCES user_account(user_id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_profile_status
  ON student_profile(status);

-- v0.1.13 (M1): one account maps to at most one profile
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_profile_user_id
  ON student_profile(user_id) WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1b. Multi-device identity & topology (M1)
--     Pure additive; FK closure within {user_account + these 5 tables}.
--     Dependency order: organization -> node -> device -> device_runtime_session -> auth_session.
--     Ref: architecture-plan-b-multi-device-v2.2 §7.2 T1-T5.
-- ----------------------------------------------------------------------------

-- organization: installed-time UUID; NO fixed org_default seed here.
CREATE TABLE IF NOT EXISTS organization (
  organization_id  TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'SCHOOL'
                    CHECK (type IN ('SCHOOL', 'CENTER', 'DISTRICT')),
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS node (
  node_id          TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organization(organization_id),
  node_name        TEXT NOT NULL,
  node_type        TEXT NOT NULL DEFAULT 'ELECTRON_KIOSK'
                    CHECK (node_type IN ('ELECTRON_KIOSK', 'STANDALONE_SERVER', 'CLOUD')),
  installed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  app_version      TEXT,
  schema_version   TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device (
  device_id          TEXT PRIMARY KEY,
  node_id            TEXT NOT NULL REFERENCES node(node_id),
  device_name        TEXT NOT NULL,
  device_role        TEXT NOT NULL
                      CHECK (device_role IN ('STUDENT_WORKSTATION', 'TEACHER_TABLET',
                                             'ADMIN_TERMINAL', 'HYBRID')),
  credential_hash    TEXT,
  trust_state        TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (trust_state IN ('PENDING', 'TRUSTED', 'REVOKED')),
  is_kiosk_enabled   INTEGER NOT NULL DEFAULT 0 CHECK (is_kiosk_enabled IN (0, 1)),
  allows_self_login  INTEGER NOT NULL DEFAULT 1 CHECK (allows_self_login IN (0, 1)),
  capabilities_json  TEXT CHECK (capabilities_json IS NULL OR json_valid(capabilities_json)),
  last_heartbeat_at  TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'DISABLED', 'DECOMMISSIONED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_runtime_session (
  device_runtime_session_id TEXT PRIMARY KEY,
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  started_at                TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at                  TEXT,
  end_reason                TEXT CHECK (end_reason IS NULL OR end_reason IN (
                              'HEARTBEAT_TIMEOUT', 'GRACEFUL_SHUTDOWN', 'ADMIN_TERMINATED', 'REPLACED')),
  client_version            TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

-- At most one ACTIVE runtime session per device.
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_one_active_runtime
  ON device_runtime_session(device_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS auth_session (
  auth_session_id           TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES user_account(user_id),
  device_runtime_session_id TEXT REFERENCES device_runtime_session(device_runtime_session_id),
  auth_method               TEXT NOT NULL CHECK (auth_method IN (
                              'PASSWORD', 'DELEGATED', 'PIN', 'DEVICE_KEY')),
  granted_by                TEXT REFERENCES user_account(user_id),
  capabilities_json         TEXT NOT NULL DEFAULT '[]'
                             CHECK (json_valid(capabilities_json)),
  token_hash                TEXT NOT NULL UNIQUE,
  refresh_token_hash        TEXT UNIQUE,
  issued_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                TEXT NOT NULL,
  last_activity_at          TEXT NOT NULL DEFAULT (datetime('now')),
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  revoke_reason             TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_status
  ON auth_session(user_id, status);

CREATE INDEX IF NOT EXISTS idx_auth_session_token
  ON auth_session(token_hash);

-- ----------------------------------------------------------------------------
-- 1c. Business session foundation (M2)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_session (
  business_session_id TEXT PRIMARY KEY,
  session_type        TEXT NOT NULL CHECK (session_type IN ('ASSESSMENT','TRAINING','LEARNING')),
  student_id          TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code            TEXT NOT NULL,
  task_code           TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  created_by          TEXT NOT NULL REFERENCES user_account(user_id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_business_session_student
  ON business_session(student_id, session_type);

CREATE INDEX IF NOT EXISTS idx_business_session_student_job_task
  ON business_session(student_id, job_code, task_code);

-- ----------------------------------------------------------------------------
-- 1d. Grant and assignment foundation (M3)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS delegated_access_grant (
  grant_id                  TEXT PRIMARY KEY,
  business_session_id       TEXT NOT NULL REFERENCES business_session(business_session_id),
  teacher_auth_session_id   TEXT NOT NULL REFERENCES auth_session(auth_session_id),
  teacher_user_id           TEXT NOT NULL REFERENCES user_account(user_id),
  student_id                TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  device_runtime_session_id TEXT NOT NULL REFERENCES device_runtime_session(device_runtime_session_id),
  capabilities_json         TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  identity_confirmation_method TEXT CHECK (identity_confirmation_method IS NULL OR
                               identity_confirmation_method IN ('PIN','TEACHER_ATTESTATION','PHOTO_MATCH','NONE_REQUIRED')),
  confirmed_by              TEXT REFERENCES user_account(user_id),
  confirmation_evidence     TEXT CHECK (confirmation_evidence IS NULL OR json_valid(confirmation_evidence)),
  student_pin_verified      INTEGER NOT NULL DEFAULT 0 CHECK (student_pin_verified IN (0, 1)),
  teacher_attested          INTEGER NOT NULL DEFAULT 0 CHECK (teacher_attested IN (0, 1)),
  confirmed_at              TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
  replaces_grant_id         TEXT REFERENCES delegated_access_grant(grant_id),
  granted_at                TEXT NOT NULL DEFAULT (datetime('now')),
  released_at               TEXT,
  release_reason            TEXT,
  expires_at                TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (replaces_grant_id IS NULL OR replaces_grant_id <> grant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_grant_one_active_per_business_session
  ON delegated_access_grant(business_session_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_grant_student_device_status
  ON delegated_access_grant(student_id, device_id, status);

CREATE TABLE IF NOT EXISTS business_session_assignment (
  assignment_id             TEXT PRIMARY KEY,
  business_session_id       TEXT NOT NULL REFERENCES business_session(business_session_id),
  student_id                TEXT NOT NULL REFERENCES student_profile(student_id),
  device_id                 TEXT NOT NULL REFERENCES device(device_id),
  grant_id                  TEXT NOT NULL REFERENCES delegated_access_grant(grant_id),
  assigned_by               TEXT NOT NULL REFERENCES user_account(user_id),
  assigned_at               TEXT NOT NULL DEFAULT (datetime('now')),
  student_confirmed_at      TEXT,
  released_at               TEXT,
  release_reason            TEXT CHECK (release_reason IS NULL OR release_reason IN (
                               'COMPLETED','TEACHER_RELEASED','DEVICE_OFFLINE','REPLACED','ADMIN_REVOKED')),
  replaces_assignment_id    TEXT REFERENCES business_session_assignment(assignment_id),
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status                    TEXT NOT NULL DEFAULT 'PENDING_CONFIRM'
                             CHECK (status IN ('PENDING_CONFIRM','ACTIVE','RELEASED','VOID')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_grant
  ON business_session_assignment(grant_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_session
  ON business_session_assignment(business_session_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_one_active_per_device
  ON business_session_assignment(device_id) WHERE status IN ('PENDING_CONFIRM','ACTIVE');

-- ----------------------------------------------------------------------------
-- 2. Strategy configuration: scoring, question generation, thresholds
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS strategy_config (
  strategy_id                 TEXT NOT NULL,
  strategy_type               TEXT NOT NULL CHECK (strategy_type IN (
                                'BASELINE_ASSESSMENT',
                                'MOCK_EXAM',
                                'TRAINING_PRACTICE',
                                'JOB_SKILL_ASSESSMENT'
                              )),
  job_code                    TEXT NOT NULL,
  strategy_name               TEXT NOT NULL,

  online_question_count       INTEGER NOT NULL CHECK (online_question_count >= 0),
  offline_question_count      INTEGER NOT NULL CHECK (offline_question_count >= 0),
  max_score                   INTEGER NOT NULL CHECK (max_score > 0),

  competent_threshold         REAL NOT NULL DEFAULT 80 CHECK (competent_threshold >= 0 AND competent_threshold <= 100),
  conditional_threshold       REAL NOT NULL DEFAULT 60 CHECK (conditional_threshold >= 0 AND conditional_threshold <= 100),

  module_veto_threshold       REAL NOT NULL DEFAULT 0.5 CHECK (module_veto_threshold >= 0 AND module_veto_threshold <= 1),
  emotion_collapse_threshold  INTEGER NOT NULL DEFAULT 3 CHECK (emotion_collapse_threshold >= 1),
  session_validity_days       INTEGER NOT NULL DEFAULT 14 CHECK (session_validity_days >= 1),

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
                           'ROLE_PLAY_SCRIPT',
                           'SEALED_ADMIN_CONFIG',
                           'OFFLINE_SETUP_GUIDE',
                           'DATA_SNAPSHOT',
                           'OTHER'
                         )),
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
--    v0.1.12: status DEFAULT 'DRAFT'; question_type adds SOFTWARE_TASK;
--    new item_usage, bank_domain, job_module_code; module_type nullable;
--    domain pairing CHECK.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS question_bank (
  question_id           TEXT PRIMARY KEY,
  job_code              TEXT NOT NULL,
  bank_domain           TEXT NOT NULL CHECK (bank_domain IN ('BASE_ABILITY', 'JOB_SPECIFIC')),
  module_type           TEXT CHECK (module_type IS NULL OR module_type IN (
                           'FINE_MOTOR',
                           'COGNITION',
                           'RULE_EXECUTION',
                           'EMOTION_REGULATION',
                           'BASIC_SOCIAL',
                           'SAFETY_OPERATION'
                         )),
  job_module_code       TEXT CHECK (job_module_code IS NULL
                           OR job_module_code IN ('M1','M2','M3','M4','M5','M6')),
  question_type         TEXT NOT NULL CHECK (question_type IN (
                           'TRUE_FALSE',
                           'SINGLE_CHOICE',
                           'DRAG',
                           'SOFTWARE_TASK',
                           'OFFLINE_OPERATION'
                         )),
  item_usage            TEXT NOT NULL DEFAULT 'SCORED_ITEM'
                         CHECK (item_usage IN ('SCORED_ITEM', 'OBSERVATION_ONLY')),
  difficulty_level      INTEGER NOT NULL DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),

  content_json          TEXT NOT NULL,
  scoring_rule_json     TEXT NOT NULL,

  media_asset_id        TEXT REFERENCES asset_resource(asset_id),
  tool_asset_ids_json   TEXT,

  safety_sensitive      INTEGER NOT NULL DEFAULT 0 CHECK (safety_sensitive IN (0, 1)),
  sensory_tags_json     TEXT,
  superseded_by_question_id TEXT REFERENCES question_bank(question_id),

  status                TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('ACTIVE', 'DRAFT', 'DISABLED', 'ARCHIVED')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (superseded_by_question_id IS NULL OR superseded_by_question_id <> question_id),
  CHECK (
    (bank_domain = 'BASE_ABILITY' AND module_type IS NOT NULL AND job_module_code IS NULL)
    OR
    (bank_domain = 'JOB_SPECIFIC' AND module_type IS NULL AND job_module_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_question_bank_domain_job_module_status
  ON question_bank(bank_domain, job_code, module_type, question_type, status);

CREATE INDEX IF NOT EXISTS idx_question_bank_domain_job_jobmodule_status
  ON question_bank(bank_domain, job_code, job_module_code, status);

CREATE INDEX IF NOT EXISTS idx_question_bank_safety_sensitive
  ON question_bank(safety_sensitive);

-- ----------------------------------------------------------------------------
-- 5. Domain event projection
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS domain_event_projection (
  event_id              TEXT PRIMARY KEY,
  aggregate_type        TEXT NOT NULL CHECK (aggregate_type IN (
                           'ASSESSMENT_SESSION',
                           'TRAINING_SESSION',
                           'STUDENT_PROFILE',
                           'STRATEGY_CONFIG',
                           'QUESTION_BANK',
                           'BUSINESS_SESSION',
                           'TASK_CLOSURE',
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
  sitting_no            INTEGER CHECK (sitting_no IS NULL OR sitting_no >= 1),
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
--    v0.1.12: strategy_type adds JOB_SKILL_ASSESSMENT.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessment_session (
  session_id                    TEXT PRIMARY KEY,
  business_session_id           TEXT REFERENCES business_session(business_session_id),
  student_id                    TEXT NOT NULL REFERENCES student_profile(student_id),
  strategy_id                   TEXT NOT NULL,
  strategy_type                 TEXT NOT NULL CHECK (strategy_type IN (
                                 'BASELINE_ASSESSMENT',
                                 'MOCK_EXAM',
                                 'JOB_SKILL_ASSESSMENT'
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
  delivery_phase                TEXT CHECK (delivery_phase IS NULL OR delivery_phase IN (
                                 'PREPARED',
                                 'ASSIGNED',
                                 'STUDENT_CONFIRMED',
                                 'ONLINE_IN_PROGRESS',
                                 'ONLINE_COMPLETED',
                                 'OFFLINE_SCORING',
                                 'OBSERVATION',
                                 'READY_TO_FINALIZE',
                                 'FINALIZED'
                               )),

  current_question_id           TEXT REFERENCES question_bank(question_id),
  online_question_count         INTEGER NOT NULL CHECK (online_question_count >= 0),
  offline_question_count        INTEGER NOT NULL CHECK (offline_question_count >= 0),
  online_completed_count        INTEGER NOT NULL DEFAULT 0 CHECK (online_completed_count >= 0),
  offline_completed_count       INTEGER NOT NULL DEFAULT 0 CHECK (offline_completed_count >= 0),
  observation_template_id       TEXT,

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
  event_sequence_version        INTEGER NOT NULL DEFAULT 0 CHECK (event_sequence_version >= 0),

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
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES strategy_config(strategy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_assessment_session_student_status
  ON assessment_session(student_id, status);

CREATE INDEX IF NOT EXISTS idx_assessment_session_strategy_status
  ON assessment_session(strategy_type, status);

CREATE INDEX IF NOT EXISTS idx_assessment_session_student_job_task_status
  ON assessment_session(student_id, job_code, task_code, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_one_open_session_per_student_job_task_strategy
  ON assessment_session(student_id, job_code, task_code, strategy_type)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING');

CREATE INDEX IF NOT EXISTS idx_assessment_session_last_event
  ON assessment_session(last_applied_event_id);

-- F4：坐次是 assessment_session 内一次连续施测的可追溯单位。
CREATE TABLE IF NOT EXISTS assessment_sitting (
  sitting_id              TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  sitting_no              INTEGER NOT NULL CHECK (sitting_no >= 1),
  started_at              TEXT NOT NULL,
  started_by              TEXT NOT NULL REFERENCES user_account(user_id),
  ended_at                TEXT,
  ended_by                TEXT REFERENCES user_account(user_id),
  end_reason              TEXT CHECK (end_reason IS NULL OR end_reason IN (
                           'COMPLETED_NORMALLY', 'PAUSED_BY_PLAN', 'ENDED_BY_COLLAPSE'
                         )),
  current_question_order  INTEGER CHECK (current_question_order IS NULL OR current_question_order >= 1),
  started_event_id        TEXT NOT NULL UNIQUE REFERENCES domain_event_projection(event_id),
  ended_event_id          TEXT UNIQUE REFERENCES domain_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, sitting_no),
  CHECK ((ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL AND ended_event_id IS NULL)
      OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL AND ended_event_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_assessment_sitting_session_order
  ON assessment_sitting(session_id, sitting_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_one_open_sitting
  ON assessment_sitting(session_id) WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_business_session
  ON assessment_session(business_session_id);

CREATE INDEX IF NOT EXISTS idx_assessment_session_delivery_phase
  ON assessment_session(delivery_phase);

-- v0.1.12: question_phase adds OBSERVATION; question_type adds SOFTWARE_TASK;
-- new bank_domain, job_module_code, item_usage; module_type nullable;
-- domain/phase pairing CHECKs.
CREATE TABLE IF NOT EXISTS assessment_session_question (
  session_question_id     TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id             TEXT NOT NULL REFERENCES question_bank(question_id),
  question_order          INTEGER NOT NULL CHECK (question_order >= 1),
  question_phase          TEXT NOT NULL CHECK (question_phase IN ('ONLINE', 'OFFLINE', 'OBSERVATION')),

  bank_domain             TEXT NOT NULL CHECK (bank_domain IN ('BASE_ABILITY', 'JOB_SPECIFIC')),
  module_type             TEXT CHECK (module_type IS NULL OR module_type IN (
                            'FINE_MOTOR',
                            'COGNITION',
                            'RULE_EXECUTION',
                            'EMOTION_REGULATION',
                            'BASIC_SOCIAL',
                            'SAFETY_OPERATION'
                          )),
  job_module_code         TEXT CHECK (job_module_code IS NULL
                            OR job_module_code IN ('M1','M2','M3','M4','M5','M6')),
  question_type           TEXT NOT NULL CHECK (question_type IN (
                            'TRUE_FALSE',
                            'SINGLE_CHOICE',
                            'DRAG',
                            'SOFTWARE_TASK',
                            'OFFLINE_OPERATION'
                          )),
  item_usage              TEXT NOT NULL CHECK (item_usage IN ('SCORED_ITEM', 'OBSERVATION_ONLY')),

  generated_event_id      TEXT REFERENCES domain_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (session_id, question_order),
  UNIQUE (session_id, question_id),
  CHECK (
    (bank_domain = 'BASE_ABILITY' AND module_type IS NOT NULL AND job_module_code IS NULL)
    OR
    (bank_domain = 'JOB_SPECIFIC' AND module_type IS NULL AND job_module_code IS NOT NULL)
  ),
  CHECK (
    (item_usage = 'OBSERVATION_ONLY' AND question_phase = 'OBSERVATION')
    OR
    (item_usage = 'SCORED_ITEM' AND question_phase IN ('ONLINE', 'OFFLINE'))
  )
);

CREATE INDEX IF NOT EXISTS idx_assessment_session_question_session_phase
  ON assessment_session_question(session_id, question_phase, question_order);

-- ----------------------------------------------------------------------------
-- 7. Online answer records and offline operation score records
--    v0.1.12: question_type adds SOFTWARE_TASK; new response_status;
--    score nullable; ANSWERED/non-ANSWERED pairing CHECK.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS answer_record (
  answer_id             TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id           TEXT NOT NULL REFERENCES question_bank(question_id),
  question_type         TEXT NOT NULL CHECK (question_type IN (
                           'TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK'
                         )),

  response_status       TEXT NOT NULL DEFAULT 'ANSWERED' CHECK (response_status IN (
                           'ANSWERED',
                           'NOT_APPLICABLE',
                           'STOPPED_SAFETY',
                           'TECHNICAL_INTERRUPTION',
                           'ASSISTED_NOT_SCORED'
                         )),

  answer_payload_json   TEXT NOT NULL,
  is_correct            INTEGER CHECK (is_correct IS NULL OR is_correct IN (0, 1)),
  score                 INTEGER CHECK (score IS NULL OR score IN (0, 2)),

  submitted_event_id    TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  submitted_at          TEXT NOT NULL DEFAULT (datetime('now')),

  revision_no           INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  status                TEXT NOT NULL DEFAULT 'VALID'
                         CHECK (status IN ('VALID', 'SUPERSEDED', 'VOID')),

  -- ANSWERED: score must be 0 or 2, is_correct must be 0 or 1
  -- Non-ANSWERED: score and is_correct must be NULL
  CHECK (
    (response_status = 'ANSWERED' AND score IS NOT NULL AND is_correct IS NOT NULL)
    OR
    (response_status <> 'ANSWERED' AND score IS NULL AND is_correct IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_answer_record_session_question
  ON answer_record(session_id, question_id, revision_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_answer_record_one_valid_answer
  ON answer_record(session_id, question_id)
  WHERE status = 'VALID';

-- v0.1.12: score_scope adds JOB_SKILL and TEACHER_OBSERVATION;
-- new response_status and observation_payload_json; score nullable.
CREATE TABLE IF NOT EXISTS offline_score_record (
  offline_score_id          TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  question_id               TEXT REFERENCES question_bank(question_id),
  score_scope               TEXT NOT NULL CHECK (score_scope IN (
                              'OFFLINE_ABILITY',
                              'JOB_SKILL',
                              'TASK_OPERATION',
                              'TEACHER_OBSERVATION'
                            )),
  task_operation_code       TEXT,

  response_status           TEXT NOT NULL DEFAULT 'ANSWERED' CHECK (response_status IN (
                              'ANSWERED',
                              'NOT_APPLICABLE',
                              'STOPPED_SAFETY',
                              'TECHNICAL_INTERRUPTION',
                              'ASSISTED_NOT_SCORED'
                            )),

  score                     INTEGER CHECK (score IS NULL OR score IN (0, 1, 2)),
  scoring_rubric_json       TEXT,
  observation_note          TEXT,
  observation_payload_json  TEXT,

  scored_by                 TEXT NOT NULL REFERENCES user_account(user_id),
  scored_event_id           TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  scored_at                 TEXT NOT NULL DEFAULT (datetime('now')),

  tool_checklist_confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (tool_checklist_confirmed IN (0, 1)),
  revision_no               INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  status                    TEXT NOT NULL DEFAULT 'VALID'
                            CHECK (status IN ('VALID', 'SUPERSEDED', 'VOID')),

  -- Scope-specific constraints:
  CHECK (
    (score_scope = 'OFFLINE_ABILITY' AND question_id IS NOT NULL AND task_operation_code IS NULL AND scoring_rubric_json IS NOT NULL)
    OR (score_scope = 'JOB_SKILL' AND question_id IS NOT NULL AND task_operation_code IS NULL AND scoring_rubric_json IS NOT NULL)
    OR (score_scope = 'TASK_OPERATION' AND question_id IS NULL AND task_operation_code IS NOT NULL)
    OR (score_scope = 'TEACHER_OBSERVATION' AND question_id IS NOT NULL AND task_operation_code IS NULL
        AND score IS NULL AND observation_payload_json IS NOT NULL)
  ),
  -- ANSWERED requires score; non-ANSWERED allows NULL (except TEACHER_OBSERVATION which always NULL)
  CHECK (
    score_scope = 'TEACHER_OBSERVATION'
    OR (response_status = 'ANSWERED' AND score IS NOT NULL)
    OR (response_status <> 'ANSWERED' AND score IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_offline_score_session_question
  ON offline_score_record(session_id, question_id, revision_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_score_one_valid_score
  ON offline_score_record(session_id, question_id)
  WHERE status = 'VALID' AND score_scope IN ('OFFLINE_ABILITY', 'JOB_SKILL', 'TEACHER_OBSERVATION');

CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_score_one_valid_task_operation
  ON offline_score_record(session_id, task_operation_code)
  WHERE status = 'VALID' AND score_scope = 'TASK_OPERATION';

-- ----------------------------------------------------------------------------
-- 9. Training session and training step records
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS training_session (
  training_session_id          TEXT PRIMARY KEY,
  business_session_id          TEXT REFERENCES business_session(business_session_id),
  student_id                   TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                     TEXT NOT NULL,
  task_code                    TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  strategy_id                  TEXT,
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
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES strategy_config(strategy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_training_session_student_status
  ON training_session(student_id, status);

CREATE INDEX IF NOT EXISTS idx_training_session_job_module
  ON training_session(job_code, module_type);

CREATE INDEX IF NOT EXISTS idx_training_session_student_job_task_status
  ON training_session(student_id, job_code, task_code, status);

CREATE INDEX IF NOT EXISTS idx_training_session_strategy
  ON training_session(strategy_type, strategy_version);

CREATE UNIQUE INDEX IF NOT EXISTS ux_training_one_open_session_per_student_job_task
  ON training_session(student_id, job_code, task_code)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED');

CREATE UNIQUE INDEX IF NOT EXISTS ux_training_business_session
  ON training_session(business_session_id);

-- ----------------------------------------------------------------------------
-- 9b. M2 business session and delivery phase guards (D2-D6, D8)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
  AND OLD.delivery_phase <> NEW.delivery_phase
BEGIN
  SELECT CASE
    WHEN OLD.delivery_phase = 'FINALIZED' THEN
      RAISE(ABORT, 'delivery_phase FINALIZED is terminal')
    WHEN OLD.delivery_phase = 'READY_TO_FINALIZE' AND NEW.delivery_phase <> 'FINALIZED' THEN
      RAISE(ABORT, 'READY_TO_FINALIZE can only advance to FINALIZED')
    WHEN OLD.delivery_phase = 'OBSERVATION' AND NEW.delivery_phase <> 'READY_TO_FINALIZE' THEN
      RAISE(ABORT, 'OBSERVATION can only advance to READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'OFFLINE_SCORING'
      AND NEW.delivery_phase NOT IN ('OBSERVATION','READY_TO_FINALIZE') THEN
      RAISE(ABORT, 'OFFLINE_SCORING can only advance to OBSERVATION or READY_TO_FINALIZE')
    WHEN OLD.delivery_phase = 'ONLINE_COMPLETED' AND NEW.delivery_phase <> 'OFFLINE_SCORING' THEN
      RAISE(ABORT, 'ONLINE_COMPLETED can only advance to OFFLINE_SCORING')
    WHEN OLD.delivery_phase = 'ONLINE_IN_PROGRESS'
      AND NEW.delivery_phase <> 'ONLINE_COMPLETED'
      AND NOT (NEW.delivery_phase = 'FINALIZED' AND NEW.status = 'COMPLETED') THEN
      RAISE(ABORT, 'ONLINE_IN_PROGRESS can only advance to ONLINE_COMPLETED')
    WHEN OLD.delivery_phase = 'STUDENT_CONFIRMED' AND NEW.delivery_phase <> 'ONLINE_IN_PROGRESS' THEN
      RAISE(ABORT, 'STUDENT_CONFIRMED can only advance to ONLINE_IN_PROGRESS')
    WHEN OLD.delivery_phase = 'ASSIGNED' AND NEW.delivery_phase <> 'STUDENT_CONFIRMED' THEN
      RAISE(ABORT, 'ASSIGNED can only advance to STUDENT_CONFIRMED')
    WHEN OLD.delivery_phase = 'PREPARED' AND NEW.delivery_phase <> 'ASSIGNED' THEN
      RAISE(ABORT, 'PREPARED can only advance to ASSIGNED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_insert_prepared
BEFORE INSERT ON assessment_session
FOR EACH ROW WHEN NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase <> 'PREPARED'
BEGIN SELECT RAISE(ABORT, 'new assessment_session delivery_phase must start at PREPARED'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_delivery_phase_frozen_on_abnormal
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN OLD.status IN ('REDLINE_HALTED','ABORTED')
  AND ((OLD.delivery_phase IS NULL) <> (NEW.delivery_phase IS NULL) OR OLD.delivery_phase <> NEW.delivery_phase)
BEGIN SELECT RAISE(ABORT, 'delivery_phase of REDLINE_HALTED/ABORTED session is frozen'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED'))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_finalized_completed_consistency_update
BEFORE UPDATE OF delivery_phase, status ON assessment_session
FOR EACH ROW
WHEN (NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
  OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED'))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON assessment_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='ASSESSMENT' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session requires business_session_id matching ASSESSMENT type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_training_business_session_consistency_update
BEFORE UPDATE OF business_session_id, student_id, job_code, task_code ON training_session
FOR EACH ROW
WHEN NEW.business_session_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id
    AND bs.session_type='TRAINING' AND bs.student_id=NEW.student_id AND bs.job_code=NEW.job_code AND bs.task_code=NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'training_session requires business_session_id matching TRAINING type, student_id, job_code, task_code'); END;

CREATE TRIGGER IF NOT EXISTS trg_business_session_key_immutable
BEFORE UPDATE OF session_type, student_id, job_code, task_code ON business_session
FOR EACH ROW
WHEN OLD.session_type<>NEW.session_type OR OLD.student_id<>NEW.student_id
  OR OLD.job_code<>NEW.job_code OR OLD.task_code<>NEW.task_code
BEGIN SELECT RAISE(ABORT, 'business_session key fields (session_type/student_id/job_code/task_code) are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_insert
BEFORE INSERT ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency: student/business_session, device/runtime, teacher/auth must match and auth ACTIVE unexpired'); END;

CREATE TRIGGER IF NOT EXISTS trg_grant_self_consistency_update
BEFORE UPDATE OF business_session_id, student_id, device_id, device_runtime_session_id, teacher_auth_session_id, teacher_user_id ON delegated_access_grant
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM business_session bs WHERE bs.business_session_id=NEW.business_session_id AND bs.student_id=NEW.student_id)
  OR NOT EXISTS (SELECT 1 FROM device_runtime_session drs WHERE drs.device_runtime_session_id=NEW.device_runtime_session_id AND drs.device_id=NEW.device_id)
  OR NOT EXISTS (SELECT 1 FROM auth_session au WHERE au.auth_session_id=NEW.teacher_auth_session_id AND au.user_id=NEW.teacher_user_id AND au.status='ACTIVE' AND au.expires_at > datetime('now'))
BEGIN SELECT RAISE(ABORT, 'grant self-consistency violation on update'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment must match grant (student/device/business_session) and assigned_by must be grant teacher or ACTIVE ADMIN'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_grant_consistency_update
BEFORE UPDATE OF grant_id, student_id, device_id, business_session_id, assigned_by ON business_session_assignment
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id
    AND g.student_id=NEW.student_id AND g.device_id=NEW.device_id AND g.business_session_id=NEW.business_session_id)
  OR NOT (NEW.assigned_by=(SELECT teacher_user_id FROM delegated_access_grant WHERE grant_id=NEW.grant_id)
    OR EXISTS (SELECT 1 FROM user_account u WHERE u.user_id=NEW.assigned_by AND u.role='ADMIN' AND u.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'assignment-grant consistency violation on update'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_insert
BEFORE INSERT ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;

CREATE TRIGGER IF NOT EXISTS trg_assignment_active_requires_active_grant_update
BEFORE UPDATE OF status, grant_id ON business_session_assignment
FOR EACH ROW
WHEN NEW.status IN ('PENDING_CONFIRM','ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM delegated_access_grant g WHERE g.grant_id=NEW.grant_id AND g.status='ACTIVE')
BEGIN SELECT RAISE(ABORT, 'active assignment must reference an ACTIVE grant'); END;

CREATE TABLE IF NOT EXISTS training_step_record (
  training_step_record_id      TEXT PRIMARY KEY,
  training_session_id          TEXT NOT NULL REFERENCES training_session(training_session_id) ON DELETE RESTRICT,
  step_code                    TEXT NOT NULL,
  step_name                    TEXT NOT NULL,
  step_order                   INTEGER NOT NULL CHECK (step_order >= 1),
  step_type                    TEXT NOT NULL CHECK (step_type IN (
                                'WATCH', 'LEARN', 'PRACTICE', 'DO'
                              )),
  related_question_id          TEXT REFERENCES question_bank(question_id),
  media_asset_id               TEXT REFERENCES asset_resource(asset_id),
  status                       TEXT NOT NULL DEFAULT 'NOT_STARTED'
                                CHECK (status IN (
                                  'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'FAILED'
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
-- 10. Safety incident
-- ----------------------------------------------------------------------------

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

CREATE INDEX IF NOT EXISTS idx_safety_incident_student_job_task_status
  ON safety_incident(student_id, job_code, task_code, status, requires_review_before_next_session);

CREATE INDEX IF NOT EXISTS idx_safety_incident_reason_occurred
  ON safety_incident(reason_code, occurred_at);

CREATE INDEX IF NOT EXISTS idx_safety_incident_context_phase
  ON safety_incident(context_phase, occurred_at);

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
-- 10b. Unified result records
--    v0.1.12: result_type adds JOB_SKILL_SCORE; strategy_type adds JOB_SKILL_ASSESSMENT.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS result_record (
  result_id               TEXT PRIMARY KEY,
  student_id              TEXT NOT NULL REFERENCES student_profile(student_id),

  result_type             TEXT NOT NULL CHECK (result_type IN (
                            'ABILITY_SCORE',
                            'TRAINING_COMPLETION',
                            'OPERATION_PASS_RATE',
                            'JOB_SKILL_SCORE'
                          )),

  source_aggregate_type   TEXT NOT NULL CHECK (source_aggregate_type IN (
                            'ASSESSMENT_SESSION',
                            'TRAINING_SESSION'
                          )),
  source_aggregate_id     TEXT NOT NULL,

  strategy_id             TEXT,
  strategy_type           TEXT CHECK (strategy_type IS NULL OR strategy_type IN (
                            'BASELINE_ASSESSMENT',
                            'MOCK_EXAM',
                            'TRAINING_PRACTICE',
                            'JOB_SKILL_ASSESSMENT'
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
  completion_ratio        REAL CHECK (completion_ratio IS NULL OR (completion_ratio >= 0 AND completion_ratio <= 1)),
  level_result            TEXT CHECK (level_result IS NULL OR level_result IN (
                            'LEVEL_COMPETENT',
                            'LEVEL_CONDITIONAL',
                            'LEVEL_NOT_COMPETENT',
                            'LEVEL_FAIL_BY_SAFETY'
                          )),

  safety_overridden       INTEGER NOT NULL DEFAULT 0 CHECK (safety_overridden IN (0, 1)),
  redline_incident_id     TEXT REFERENCES safety_incident(incident_id),

  result_payload_json     TEXT,

  generated_event_id      TEXT NOT NULL REFERENCES domain_event_projection(event_id),
  snapshot_id             TEXT,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  is_current              INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),

  CHECK (
    (result_type IN ('ABILITY_SCORE', 'OPERATION_PASS_RATE', 'JOB_SKILL_SCORE') AND source_aggregate_type = 'ASSESSMENT_SESSION')
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

CREATE TABLE IF NOT EXISTS task_closure (
  task_closure_id                 TEXT PRIMARY KEY,
  student_id                      TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                        TEXT NOT NULL,
  task_code                       TEXT NOT NULL CHECK (length(trim(task_code)) > 0),
  cycle_no                        INTEGER NOT NULL CHECK (cycle_no >= 1),
  closure_revision                INTEGER NOT NULL CHECK (closure_revision >= 1),
  status                          TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'SUPERSEDED')),
  is_cycle_head                   INTEGER NOT NULL CHECK (is_cycle_head IN (0, 1)),
  ability_result_id               TEXT NOT NULL REFERENCES result_record(result_id),
  training_completion_result_id   TEXT NOT NULL REFERENCES result_record(result_id),
  operation_pass_rate_result_id   TEXT NOT NULL REFERENCES result_record(result_id),
  ability_source_aggregate_id     TEXT NOT NULL,
  training_source_aggregate_id    TEXT NOT NULL,
  operation_source_aggregate_id   TEXT NOT NULL,
  replaces_task_closure_id        TEXT REFERENCES task_closure(task_closure_id),
  replacement_task_closure_id     TEXT REFERENCES task_closure(task_closure_id),
  correction_reason               TEXT,
  confirmed_by                    TEXT NOT NULL REFERENCES user_account(user_id),
  confirmed_event_id              TEXT NOT NULL UNIQUE REFERENCES domain_event_projection(event_id),
  confirmed_at                    TEXT NOT NULL,
  last_applied_event_id           TEXT REFERENCES domain_event_projection(event_id),
  created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, job_code, task_code, cycle_no, closure_revision),
  CHECK (replaces_task_closure_id IS NULL OR replaces_task_closure_id <> task_closure_id),
  CHECK (replacement_task_closure_id IS NULL OR replacement_task_closure_id <> task_closure_id),
  CHECK ((status = 'CONFIRMED' AND is_cycle_head = 1) OR (status = 'SUPERSEDED' AND is_cycle_head = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_closure_cycle_head
  ON task_closure(student_id, job_code, task_code, cycle_no) WHERE is_cycle_head = 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_closure_cycle_confirmed
  ON task_closure(student_id, job_code, task_code, cycle_no) WHERE status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS idx_task_closure_student_task
  ON task_closure(student_id, job_code, task_code, cycle_no DESC, closure_revision DESC);

CREATE TABLE IF NOT EXISTS task_report (
  report_id              TEXT PRIMARY KEY,
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
  placement_review_by    TEXT REFERENCES user_account(user_id),
  placement_review_at    TEXT,
  task_closure_id        TEXT REFERENCES task_closure(task_closure_id),
  repair_of_report_id    TEXT REFERENCES task_report(report_id),
  lineage_key            TEXT,
  source_set_hash        TEXT,
  generation_key         TEXT,
  content_hash           TEXT,
  report_revision        INTEGER CHECK (report_revision IS NULL OR report_revision >= 1),
  report_schema_version  TEXT,
  report_builder_version TEXT,
  generation_reason      TEXT CHECK (generation_reason IS NULL OR generation_reason IN (
                           'NORMAL', 'CONTRACT_REPAIR', 'FACTUAL_CORRECTION', 'DUPLICATE_MERGE'
                         )),
  contract_validation_status TEXT NOT NULL DEFAULT 'REPAIR_REQUIRED'
                           CHECK (contract_validation_status IN ('VALID', 'REPAIR_REQUIRED')),
  last_applied_event_id  TEXT REFERENCES domain_event_projection(event_id),
  status                 TEXT NOT NULL DEFAULT 'GENERATED'
                         CHECK (status IN ('GENERATED', 'LOCKED', 'EXPORTED', 'SUPERSEDED', 'ARCHIVED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_task_report_student_type
  ON task_report(student_id, report_type, generated_at);

CREATE INDEX IF NOT EXISTS idx_task_report_source
  ON task_report(source_aggregate_type, source_aggregate_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_generation_key
  ON task_report(generation_key) WHERE generation_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_lineage_revision
  ON task_report(lineage_key, report_revision)
  WHERE lineage_key IS NOT NULL AND report_revision IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_report_active_lineage
  ON task_report(lineage_key)
  WHERE lineage_key IS NOT NULL AND status IN ('GENERATED', 'EXPORTED', 'LOCKED');

CREATE INDEX IF NOT EXISTS idx_task_report_lineage_revision
  ON task_report(lineage_key, report_revision DESC);

CREATE INDEX IF NOT EXISTS idx_task_report_task_closure
  ON task_report(task_closure_id);

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
                           'IPC', 'DB', 'AOL', 'RECOVERY', 'ASSET',
                           'FSM', 'SCORING', 'REPORT', 'AUTH', 'SYSTEM'
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
                            'IPC', 'DB', 'AOL', 'RECOVERY', 'ASSET',
                            'FSM', 'SCORING', 'REPORT', 'AUTH', 'SYSTEM'
                          )),
  related_aggregate_type  TEXT CHECK (related_aggregate_type IS NULL OR related_aggregate_type IN (
                            'ASSESSMENT_SESSION', 'TRAINING_SESSION', 'STUDENT_PROFILE',
                            'STRATEGY_CONFIG', 'QUESTION_BANK', 'TASK_CLOSURE', 'TASK_REPORT',
                            'SAFETY_INCIDENT', 'ASSET_RESOURCE', 'SYSTEM'
                          )),
  related_aggregate_id    TEXT,
  related_event_id        TEXT REFERENCES domain_event_projection(event_id),
  message                 TEXT NOT NULL,
  context_json            TEXT,
  stack_trace             TEXT,
  recovery_action         TEXT,
  recovery_status         TEXT NOT NULL DEFAULT 'UNRESOLVED'
                           CHECK (recovery_status IN (
                             'UNRESOLVED', 'AUTO_RECOVERED', 'MANUAL_REVIEW_REQUIRED', 'RESOLVED', 'IGNORED'
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

-- Seed base error codes
INSERT OR IGNORE INTO error_code_registry (
  error_code, error_category, severity, priority_level, title, default_message, default_recovery_hint, is_blocking
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
  ('REPORT_GENERATION_FAILED', 'REPORT', 'ERROR', 'P2', '报告生成失败', '报告快照生成失败。', '保留 result_record，允许重新生成报告。', 0),
  ('REPORT_EXPORT_FAILED', 'REPORT', 'ERROR', 'P2', '报告导出失败', '报告 HTML 文件导出失败。', '保留报告快照，允许重新导出。', 0);
INSERT OR IGNORE INTO error_code_registry (
  error_code, error_category, severity, priority_level, title, default_message, default_recovery_hint, is_blocking
) VALUES (
  'STARTUP_RECOVERY_REQUIRED', 'RECOVERY', 'CRITICAL', 'P0', '数据库需要恢复',
  '旧事件日志或报告快照无法安全升级。', '保留当前文件并联系维护人员执行恢复。', 1
);

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
  SELECT RAISE(ABORT, 'assessment_session cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_no_delete
BEFORE DELETE ON training_session
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'training_session cannot be deleted');
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
-- 15. Strategy reference consistency guards
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_strategy_config_match_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM strategy_config sc
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
  SELECT 1 FROM strategy_config sc
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
       SELECT 1 FROM strategy_config sc
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
       SELECT 1 FROM strategy_config sc
       WHERE sc.strategy_id = NEW.strategy_id
         AND sc.strategy_type = NEW.strategy_type
         AND sc.job_code = NEW.job_code
         AND sc.version = NEW.strategy_version
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session strategy_id/type/job_code/version must match strategy_config');
END;

-- Redline incident same student-job-task guards
CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_job_task_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.job_code = NEW.job_code
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id, job_code and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_job_task_update
BEFORE UPDATE ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.job_code = NEW.job_code
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id, job_code and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_job_task_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.job_code = NEW.job_code
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id, job_code and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_job_task_update
BEFORE UPDATE ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.job_code = NEW.job_code
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id, job_code and task_code');
END;

-- ----------------------------------------------------------------------------
-- 15b. Safety-gating and batch-redline triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_no_insert_redline_status
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
BEGIN
  SELECT RAISE(ABORT, 'assessment_session cannot be inserted directly as REDLINE_HALTED');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_no_insert_redline_status
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
BEGIN
  SELECT RAISE(ABORT, 'training_session cannot be inserted directly as REDLINE_HALTED');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_explicit_redline_paths
BEFORE UPDATE OF status ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND OLD.status NOT IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING')
BEGIN
  SELECT RAISE(ABORT, 'invalid assessment_session redline path');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_explicit_redline_paths
BEFORE UPDATE OF status ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND OLD.status NOT IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED')
BEGIN
  SELECT RAISE(ABORT, 'invalid training_session redline path');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_block_unresolved_safety_incident
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.job_code = NEW.job_code
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new assessment_session');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_block_unresolved_safety_incident
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.job_code = NEW.job_code
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new training_session');
END;

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

-- ----------------------------------------------------------------------------
-- 15c. Safety incident lifecycle triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_insert_requires_pending_detail
BEFORE INSERT ON safety_incident
FOR EACH ROW WHEN NEW.status <> 'PENDING_DETAIL'
BEGIN
  SELECT RAISE(ABORT, 'new safety_incident must be inserted as PENDING_DETAIL');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_insert_triggered_by_role
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM user_account u
  WHERE u.user_id = NEW.triggered_by AND u.role IN ('TEACHER', 'ADMIN') AND u.status = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'safety_incident.triggered_by must reference an active TEACHER or ADMIN');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_pending_has_no_confirmed_by
BEFORE INSERT ON safety_incident
FOR EACH ROW WHEN NEW.status = 'PENDING_DETAIL' AND NEW.confirmed_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PENDING_DETAIL safety_incident must not have confirmed_by');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_status_transition_guard
BEFORE UPDATE OF status ON safety_incident
FOR EACH ROW
WHEN OLD.status <> NEW.status
     AND NOT (
       (OLD.status = 'PENDING_DETAIL' AND NEW.status IN ('CONFIRMED', 'VOIDED'))
       OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('RESOLVED', 'VOIDED'))
     )
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_incident lifecycle transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_confirmed_requires_teacher
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.status = 'CONFIRMED'
     AND NOT EXISTS (
       SELECT 1 FROM user_account u
       WHERE u.user_id = NEW.confirmed_by AND u.role = 'TEACHER' AND u.status = 'ACTIVE'
     )
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED safety_incident requires confirmed_by to reference an active TEACHER');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_terminal_requires_admin
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('RESOLVED', 'VOIDED')
     AND (
       NEW.resolved_at IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM user_account u
         WHERE u.user_id = NEW.resolved_by AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
       )
     )
BEGIN
  SELECT RAISE(ABORT, 'RESOLVED/VOIDED safety_incident requires active ADMIN and resolved_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_job_task_insert
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must have same student_id + job_code + task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_job_task_update
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must have same student_id + job_code + task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_core_facts_immutable_after_confirmed
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN OLD.status IN ('CONFIRMED', 'RESOLVED', 'VOIDED')
     AND (
       OLD.student_id <> NEW.student_id OR OLD.job_code <> NEW.job_code
       OR OLD.task_code <> NEW.task_code OR OLD.trigger_event_id <> NEW.trigger_event_id
       OR OLD.reason_code <> NEW.reason_code OR OLD.context_phase <> NEW.context_phase
       OR COALESCE(OLD.description, '') <> COALESCE(NEW.description, '')
       OR OLD.triggered_by <> NEW.triggered_by
       OR COALESCE(OLD.confirmed_by, '') <> COALESCE(NEW.confirmed_by, '')
       OR OLD.occurred_at <> NEW.occurred_at
     )
BEGIN
  SELECT RAISE(ABORT, 'confirmed/terminal safety_incident core fact fields are immutable');
END;

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
  SELECT RAISE(ABORT, 'terminal safety_incident resolution fields are immutable');
END;

-- ----------------------------------------------------------------------------
-- 15d. Batch redline halt triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_assessments
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at
  )
  SELECT
    NEW.incident_id || ':ASSESSMENT_SESSION:' || s.session_id,
    NEW.incident_id, 'ASSESSMENT_SESSION', s.session_id,
    s.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM assessment_session s
  WHERE s.student_id = NEW.student_id AND s.job_code = NEW.job_code AND s.task_code = NEW.task_code
    AND s.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');

  UPDATE assessment_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      level_result = 'LEVEL_FAIL_BY_SAFETY',
      report_type = 'SAFETY_TERMINATION_REPORT',
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND job_code = NEW.job_code AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_trainings
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at
  )
  SELECT
    NEW.incident_id || ':TRAINING_SESSION:' || t.training_session_id,
    NEW.incident_id, 'TRAINING_SESSION', t.training_session_id,
    t.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM training_session t
  WHERE t.student_id = NEW.student_id AND t.job_code = NEW.job_code AND t.task_code = NEW.task_code
    AND t.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');

  UPDATE training_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND job_code = NEW.job_code AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');
END;

-- ----------------------------------------------------------------------------
-- 15e. Result record and task report guards
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_result_record_redline_source_insert_guard
BEFORE INSERT ON result_record
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
   AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED'
       AND NOT (NEW.safety_overridden = 1 AND COALESCE(NEW.level_result,'') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.redline_incident_id = s.redline_incident_id)))
  OR
  (NEW.source_aggregate_type = 'TRAINING_SESSION'
   AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED'
       AND NOT (NEW.safety_overridden = 1 AND COALESCE(NEW.level_result,'') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.redline_incident_id = t.redline_incident_id)))
)
BEGIN
  SELECT RAISE(ABORT, 'result_record for redline-halted session must be safety-overridden');
END;

CREATE TRIGGER IF NOT EXISTS trg_result_record_redline_source_update_guard
BEFORE UPDATE ON result_record
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
   AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED'
       AND NOT (NEW.safety_overridden = 1 AND COALESCE(NEW.level_result,'') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.redline_incident_id = s.redline_incident_id)))
  OR
  (NEW.source_aggregate_type = 'TRAINING_SESSION'
   AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED'
       AND NOT (NEW.safety_overridden = 1 AND COALESCE(NEW.level_result,'') = 'LEVEL_FAIL_BY_SAFETY' AND NEW.redline_incident_id = t.redline_incident_id)))
)
BEGIN
  SELECT RAISE(ABORT, 'result_record for redline-halted session must be safety-overridden');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_insert_guard
BEFORE INSERT ON task_closure
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN assessment_session s ON s.session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.ability_result_id
    AND r.result_type = 'ABILITY_SCORE'
    AND r.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.ability_source_aggregate_id = r.source_aggregate_id
) OR NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN training_session s ON s.training_session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.training_completion_result_id
    AND r.result_type = 'TRAINING_COMPLETION'
    AND r.source_aggregate_type = 'TRAINING_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.training_source_aggregate_id = r.source_aggregate_id
) OR NOT EXISTS (
  SELECT 1 FROM result_record r
  JOIN assessment_session s ON s.session_id = r.source_aggregate_id
  WHERE r.result_id = NEW.operation_pass_rate_result_id
    AND r.result_type = 'OPERATION_PASS_RATE'
    AND r.source_aggregate_type = 'ASSESSMENT_SESSION'
    AND r.student_id = NEW.student_id AND r.job_code = NEW.job_code
    AND s.task_code = NEW.task_code AND s.status <> 'REDLINE_HALTED'
    AND r.safety_overridden = 0 AND NEW.operation_source_aggregate_id = r.source_aggregate_id
) OR (NEW.replaces_task_closure_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM task_closure old
  WHERE old.task_closure_id = NEW.replaces_task_closure_id
    AND old.student_id = NEW.student_id AND old.job_code = NEW.job_code AND old.task_code = NEW.task_code
    AND old.cycle_no = NEW.cycle_no
    AND ((old.status = 'CONFIRMED' AND old.is_cycle_head = 1)
         OR (old.status = 'SUPERSEDED' AND old.replacement_task_closure_id IS NULL))
))
BEGIN
  SELECT RAISE(ABORT, 'task_closure binding, source, or replacement head is invalid');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_bindings_immutable
BEFORE UPDATE OF student_id, job_code, task_code, cycle_no, closure_revision,
  ability_result_id, training_completion_result_id, operation_pass_rate_result_id,
  ability_source_aggregate_id, training_source_aggregate_id, operation_source_aggregate_id,
  replaces_task_closure_id, correction_reason, confirmed_by, confirmed_event_id, confirmed_at
ON task_closure
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_closure bindings and confirmation facts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_delete_guard
BEFORE DELETE ON task_closure
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_closure rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_status_transition_guard
BEFORE UPDATE OF status, is_cycle_head ON task_closure
FOR EACH ROW
WHEN (OLD.status = 'CONFIRMED' AND NOT (NEW.status = 'SUPERSEDED' AND NEW.is_cycle_head = 0))
  OR (OLD.status = 'SUPERSEDED' AND (NEW.status <> 'SUPERSEDED' OR NEW.is_cycle_head <> 0))
BEGIN
  SELECT RAISE(ABORT, 'task_closure status can only transition CONFIRMED to SUPERSEDED');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_closure_replacement_link_guard
BEFORE UPDATE OF replacement_task_closure_id ON task_closure
FOR EACH ROW
WHEN NEW.replacement_task_closure_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM task_closure replacement
  WHERE replacement.task_closure_id = NEW.replacement_task_closure_id
    AND replacement.replaces_task_closure_id = OLD.task_closure_id
    AND replacement.student_id = OLD.student_id AND replacement.job_code = OLD.job_code
    AND replacement.task_code = OLD.task_code AND replacement.cycle_no = OLD.cycle_no
    AND (
      (replacement.status = 'CONFIRMED' AND replacement.is_cycle_head = 1)
      OR (replacement.status = 'SUPERSEDED' AND replacement.is_cycle_head = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'task_closure replacement must point to the current replacement head');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_insert_guard
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
      AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'TRAINING_SESSION'
      AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_safety_termination_update_guard
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN (
  (NEW.source_aggregate_type = 'SAFETY_INCIDENT' AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'ASSESSMENT_SESSION'
      AND EXISTS (SELECT 1 FROM assessment_session s WHERE s.session_id = NEW.source_aggregate_id AND s.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
  OR (NEW.source_aggregate_type = 'TRAINING_SESSION'
      AND EXISTS (SELECT 1 FROM training_session t WHERE t.training_session_id = NEW.source_aggregate_id AND t.status = 'REDLINE_HALTED')
      AND NEW.report_type <> 'SAFETY_TERMINATION_REPORT')
)
BEGIN
  SELECT RAISE(ABORT, 'redline-halted source must generate SAFETY_TERMINATION_REPORT only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_placement_review_export_insert_guard
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN NEW.status = 'EXPORTED'
  AND json_extract(NEW.report_content_json, '$.placement_advice.enabled') = 1
  AND (NEW.placement_review_by IS NULL OR NEW.placement_review_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'placement review is required before exporting an enabled placement advice');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_placement_review_export_update_guard
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN NEW.status = 'EXPORTED'
  AND json_extract(NEW.report_content_json, '$.placement_advice.enabled') = 1
  AND (NEW.placement_review_by IS NULL OR NEW.placement_review_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'placement review is required before exporting an enabled placement advice');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_snapshot_immutable
BEFORE UPDATE OF student_id, source_aggregate_type, source_aggregate_id, source_result_ids_json,
  report_title, report_content_json, generated_event_id, generated_by, generated_at,
  task_closure_id, repair_of_report_id, lineage_key, source_set_hash, generation_key,
  content_hash, report_revision, report_schema_version, report_builder_version, generation_reason
ON task_report
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'task_report snapshot facts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_contract_valid_for_review_lock_export_insert
BEFORE INSERT ON task_report
FOR EACH ROW
WHEN (NEW.placement_review_by IS NOT NULL OR NEW.placement_review_at IS NOT NULL
      OR NEW.status IN ('LOCKED', 'EXPORTED'))
  AND NEW.contract_validation_status <> 'VALID'
BEGIN
  SELECT RAISE(ABORT, 'VALID report contract is required for review, lock, and export');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_contract_valid_for_review_lock_export_update
BEFORE UPDATE ON task_report
FOR EACH ROW
WHEN (NEW.placement_review_by IS NOT NULL OR NEW.placement_review_at IS NOT NULL
      OR NEW.status IN ('LOCKED', 'EXPORTED'))
  AND NEW.contract_validation_status <> 'VALID'
BEGIN
  SELECT RAISE(ABORT, 'VALID report contract is required for review, lock, and export');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_report_status_transition_guard
BEFORE UPDATE OF status ON task_report
FOR EACH ROW
WHEN (OLD.status = 'LOCKED' AND NEW.status NOT IN ('LOCKED', 'SUPERSEDED', 'ARCHIVED'))
  OR (OLD.status IN ('SUPERSEDED', 'ARCHIVED') AND NEW.status <> OLD.status)
  OR (OLD.status = 'GENERATED' AND NEW.status NOT IN ('GENERATED', 'EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED'))
  OR (OLD.status = 'EXPORTED' AND NEW.status NOT IN ('EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED'))
BEGIN
  SELECT RAISE(ABORT, 'task_report status transition is invalid');
END;

-- ----------------------------------------------------------------------------
-- 16. Question bank freeze triggers
--     v0.1.12: ACTIVE-is-frozen + referenced-is-frozen (extended fields)
-- ----------------------------------------------------------------------------

-- Referenced questions are frozen (already referenced by session or answer).
CREATE TRIGGER IF NOT EXISTS trg_question_bank_referenced_semantic_immutable
BEFORE UPDATE ON question_bank
FOR EACH ROW
WHEN (
  EXISTS (SELECT 1 FROM answer_record ar WHERE ar.question_id = OLD.question_id)
  OR EXISTS (SELECT 1 FROM assessment_session_question sq WHERE sq.question_id = OLD.question_id)
  OR EXISTS (SELECT 1 FROM offline_score_record osr WHERE osr.question_id = OLD.question_id)
)
AND (
  OLD.module_type IS NOT NEW.module_type
  OR OLD.job_module_code IS NOT NEW.job_module_code
  OR OLD.bank_domain IS NOT NEW.bank_domain
  OR OLD.question_type IS NOT NEW.question_type
  OR OLD.item_usage IS NOT NEW.item_usage
  OR OLD.difficulty_level IS NOT NEW.difficulty_level
  OR OLD.content_json IS NOT NEW.content_json
  OR OLD.scoring_rule_json IS NOT NEW.scoring_rule_json
  OR OLD.media_asset_id IS NOT NEW.media_asset_id
  OR OLD.tool_asset_ids_json IS NOT NEW.tool_asset_ids_json
  OR OLD.job_code IS NOT NEW.job_code
  OR OLD.safety_sensitive IS NOT NEW.safety_sensitive
  OR OLD.sensory_tags_json IS NOT NEW.sensory_tags_json
)
BEGIN
  SELECT RAISE(ABORT, 'referenced question semantic fields are frozen; create a superseding question instead');
END;

-- ACTIVE-is-frozen: status = ACTIVE also freezes all semantic fields.
-- Only allowed changes: ACTIVE -> DISABLED / ARCHIVED (status change without semantic change).
CREATE TRIGGER IF NOT EXISTS trg_question_bank_active_semantic_immutable
BEFORE UPDATE ON question_bank
FOR EACH ROW
WHEN OLD.status = 'ACTIVE'
AND (
  OLD.module_type IS NOT NEW.module_type
  OR OLD.job_module_code IS NOT NEW.job_module_code
  OR OLD.bank_domain IS NOT NEW.bank_domain
  OR OLD.question_type IS NOT NEW.question_type
  OR OLD.item_usage IS NOT NEW.item_usage
  OR OLD.difficulty_level IS NOT NEW.difficulty_level
  OR OLD.content_json IS NOT NEW.content_json
  OR OLD.scoring_rule_json IS NOT NEW.scoring_rule_json
  OR OLD.media_asset_id IS NOT NEW.media_asset_id
  OR OLD.tool_asset_ids_json IS NOT NEW.tool_asset_ids_json
  OR OLD.job_code IS NOT NEW.job_code
  OR OLD.safety_sensitive IS NOT NEW.safety_sensitive
  OR OLD.sensory_tags_json IS NOT NEW.sensory_tags_json
)
BEGIN
  SELECT RAISE(ABORT, 'ACTIVE question semantic fields are frozen; create a new question version instead');
END;

-- ----------------------------------------------------------------------------
-- 16b. Strategy config historical-version immutability
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_strategy_config_referenced_version_semantic_immutable
BEFORE UPDATE ON strategy_config
FOR EACH ROW
WHEN (
  EXISTS (SELECT 1 FROM assessment_session s WHERE s.strategy_id = OLD.strategy_id AND s.strategy_version = OLD.version)
  OR EXISTS (SELECT 1 FROM training_session t WHERE t.strategy_id = OLD.strategy_id AND t.strategy_version = OLD.version)
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
  OR OLD.session_validity_days IS NOT NEW.session_validity_days
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
-- 17. assessment_session_question INSERT validation
--     v0.1.12: validates question_bank status, domain consistency, phase rules.
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_question_insert_validation
BEFORE INSERT ON assessment_session_question
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM question_bank qb
  WHERE qb.question_id = NEW.question_id
    AND qb.status = 'ACTIVE'
    AND qb.bank_domain = NEW.bank_domain
    AND qb.question_type = NEW.question_type
    AND qb.item_usage = NEW.item_usage
    AND (
      (NEW.bank_domain = 'BASE_ABILITY' AND qb.module_type = NEW.module_type AND NEW.job_module_code IS NULL)
      OR
      (NEW.bank_domain = 'JOB_SPECIFIC' AND qb.job_module_code = NEW.job_module_code AND NEW.module_type IS NULL)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session_question INSERT: question must be ACTIVE with matching domain/module/type/usage');
END;

-- Enforce phase rules: OFFLINE_OPERATION -> OFFLINE; OBSERVATION_ONLY -> OBSERVATION; others -> ONLINE
CREATE TRIGGER IF NOT EXISTS trg_assessment_session_question_phase_validation
BEFORE INSERT ON assessment_session_question
FOR EACH ROW
WHEN NOT (
  (NEW.item_usage = 'OBSERVATION_ONLY' AND NEW.question_phase = 'OBSERVATION')
  OR (NEW.item_usage = 'SCORED_ITEM' AND NEW.question_type = 'OFFLINE_OPERATION' AND NEW.question_phase = 'OFFLINE')
  OR (NEW.item_usage = 'SCORED_ITEM' AND NEW.question_type <> 'OFFLINE_OPERATION' AND NEW.question_phase = 'ONLINE')
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_session_question phase must match question_type and item_usage');
END;

-- ----------------------------------------------------------------------------
-- 17b. answer_record cross-table validation
--     Ensures answer_record references a valid session question with phase=ONLINE.
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_answer_record_session_question_validation
BEFORE INSERT ON answer_record
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_session_question sq
  WHERE sq.session_id = NEW.session_id
    AND sq.question_id = NEW.question_id
    AND sq.question_phase = 'ONLINE'
    AND sq.question_type = NEW.question_type
)
BEGIN
  SELECT RAISE(ABORT, 'answer_record: session+question must exist in assessment_session_question with phase=ONLINE and matching question_type');
END;

-- ----------------------------------------------------------------------------
-- 18. Seed strategies (v0.1.12: question_policy upgraded to v1.2; new JOB_SKILL)
-- ----------------------------------------------------------------------------

-- BASELINE_ASSESSMENT seed
INSERT OR IGNORE INTO strategy_config (
  strategy_id, strategy_type, job_code, strategy_name,
  online_question_count, offline_question_count, max_score,
  competent_threshold, conditional_threshold,
  module_veto_threshold, emotion_collapse_threshold,
  question_policy_json, scoring_policy_json,
  supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
  version, is_active
) VALUES (
  'strategy_baseline_shelver_v1',
  'BASELINE_ASSESSMENT',
  'SUPERMARKET_SHELVER',
  '理货员基础能力评估 v1',
  42, 8, 100, 80, 60, 0.5, 3,
  '{"schema_version":"question-policy-v1.2","module_scope":"CROSS_MODULE","eligible_bank_domains":["BASE_ABILITY"],"online_quota_by_module":{"FINE_MOTOR":7,"COGNITION":7,"RULE_EXECUTION":7,"EMOTION_REGULATION":7,"BASIC_SOCIAL":7,"SAFETY_OPERATION":7},"offline_total":8,"eligible_item_usage":["SCORED_ITEM"],"allowed_question_types":["TRUE_FALSE","SINGLE_CHOICE","DRAG","SOFTWARE_TASK","OFFLINE_OPERATION"],"unsupported_interaction_policy":"BLOCK","sensory_filter_mode":"SOFT","fallback_strategy":"BLOCK"}',
  '{"schema_version":"scoring-policy-v1.1","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"placement_advice_enabled":false,"pilot_mode":true}',
  1, 1, 1, 1, 1
);

-- MOCK_EXAM seed
INSERT OR IGNORE INTO strategy_config (
  strategy_id, strategy_type, job_code, strategy_name,
  online_question_count, offline_question_count, max_score,
  competent_threshold, conditional_threshold,
  module_veto_threshold, emotion_collapse_threshold,
  question_policy_json, scoring_policy_json,
  supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
  version, is_active
) VALUES (
  'strategy_mock_shelver_v1',
  'MOCK_EXAM',
  'SUPERMARKET_SHELVER',
  '理货员基础能力标准化模拟卷 v1',
  42, 8, 100, 80, 60, 0.5, 3,
  '{"schema_version":"question-policy-v1.2","module_scope":"CROSS_MODULE","eligible_bank_domains":["BASE_ABILITY"],"online_quota_by_module":{"FINE_MOTOR":7,"COGNITION":7,"RULE_EXECUTION":7,"EMOTION_REGULATION":7,"BASIC_SOCIAL":7,"SAFETY_OPERATION":7},"offline_total":8,"eligible_item_usage":["SCORED_ITEM"],"allowed_question_types":["TRUE_FALSE","SINGLE_CHOICE","DRAG","SOFTWARE_TASK","OFFLINE_OPERATION"],"unsupported_interaction_policy":"BLOCK","sensory_filter_mode":"SOFT","fallback_strategy":"BLOCK"}',
  '{"schema_version":"scoring-policy-v1.1","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","safety_override_enabled":true,"placement_advice_enabled":false,"pilot_mode":true}',
  1, 1, 1, 1, 1
);

-- TRAINING_PRACTICE seed
INSERT OR IGNORE INTO strategy_config (
  strategy_id, strategy_type, job_code, strategy_name,
  online_question_count, offline_question_count, max_score,
  competent_threshold, conditional_threshold,
  module_veto_threshold, emotion_collapse_threshold,
  question_policy_json, scoring_policy_json,
  supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
  version, is_active
) VALUES (
  'strategy_training_shelver_v1',
  'TRAINING_PRACTICE',
  'SUPERMARKET_SHELVER',
  '理货员拆箱与上架训练 v1',
  0, 0, 100, 80, 60, 0.5, 3,
  '{"module_scope":"SINGLE_MODULE","step_types":["WATCH","LEARN","PRACTICE","DO"]}',
  '{"score_values":[0,100],"normalization":"completed_steps/total_steps*100","safety_override_enabled":true,"level_rules":[{"min":100,"max":100,"level":"LEVEL_COMPETENT"},{"min":1,"max":99,"level":"LEVEL_CONDITIONAL"},{"min":0,"max":0,"level":"LEVEL_NOT_COMPETENT"}]}',
  1, 0, 0, 1, 1
);

-- JOB_SKILL_ASSESSMENT seed (v1.0.9: fixed demo paper 18+6, max_score 48)
INSERT OR IGNORE INTO strategy_config (
  strategy_id, strategy_type, job_code, strategy_name,
  online_question_count, offline_question_count, max_score,
  competent_threshold, conditional_threshold,
  module_veto_threshold, emotion_collapse_threshold,
  question_policy_json, scoring_policy_json,
  supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
  version, is_active
) VALUES (
  'strategy_job_skill_shelver_v1',
  'JOB_SKILL_ASSESSMENT',
  'SUPERMARKET_SHELVER',
  '理货员专业岗位示范测评 v1',
  18, 6, 48, 80, 60, 0.5, 3,
  '{"schema_version":"question-policy-v1.2","bank_domain":"JOB_SPECIFIC","selection_mode":"FIXED_SET","job_module_quotas":{"M1":{"online":3,"offline":1},"M2":{"online":3,"offline":1},"M3":{"online":3,"offline":1},"M4":{"online":3,"offline":1},"M5":{"online":3,"offline":1},"M6":{"online":3,"offline":1}},"fixed_scored_question_ids":["M1_SC_001","M1_SC_004","M1_SC_007","M1_OP_033","M2_SC_002","M2_SC_003","M2_SC_005","M2_OP_027","M3_SC_001","M3_SC_005","M3_SC_019","M3_OP_043","M4_SC_001","M4_SC_003","M4_SC_005","M4_OP_029","M5_SC_001","M5_SC_002","M5_SC_009","M5_OP_039","M6_SC_003","M6_SC_009","M6_SC_012","M6_OP_035"],"embedded_observation_question_ids":[],"fallback_strategy":"BLOCK"}',
  '{"schema_version":"scoring-policy-v1.2","assessment_scope":"JOB_SKILL","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","module_veto_mode":"DISABLED_RECORD_ONLY","training_focus_threshold":0.6,"safety_override_enabled":true,"placement_advice_enabled":false}',
  1, 1, 1, 1, 1
);

-- ----------------------------------------------------------------------------
-- 19. M5B v2.2 durable command ledger and event-batch apply cursors
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS command_log (
  command_id          TEXT PRIMARY KEY,
  idempotency_key     TEXT NOT NULL,
  client_instance_id  TEXT NOT NULL,
  command_type        TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  device_id           TEXT,
  auth_session_id     TEXT,
  request_hash        TEXT NOT NULL,
  event_batch_id      TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  result_json         TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code          TEXT,
  error_message       TEXT,
  lease_owner         TEXT,
  current_lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at    TEXT,
  worker_id           TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TEXT,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applied_event_batch (
  batch_id            TEXT PRIMARY KEY,
  batch_sequence      INTEGER NOT NULL UNIQUE,
  segment_id          TEXT NOT NULL,
  command_id          TEXT,
  event_count         INTEGER NOT NULL CHECK (event_count >= 1),
  previous_batch_hash TEXT NOT NULL,
  events_hash         TEXT NOT NULL,
  batch_hash          TEXT NOT NULL,
  prepared_lease_generation INTEGER NOT NULL DEFAULT 0,
  worker_id           TEXT,
  jsonl_offset_start  INTEGER NOT NULL,
  jsonl_offset_end    INTEGER NOT NULL,
  batch_status        TEXT NOT NULL DEFAULT 'APPLIED'
                       CHECK (batch_status IN ('APPLIED','CONFIRMED')),
  applied_at          TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at        TEXT
);

CREATE TABLE IF NOT EXISTS processed_event (
  event_id            TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES applied_event_batch(batch_id),
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  processed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projector_cursor (
  projector_name      TEXT PRIMARY KEY,
  last_batch_id       TEXT NOT NULL,
  last_batch_sequence INTEGER NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_command_idempotency
  ON command_log(client_instance_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_applied_event_batch_segment
  ON applied_event_batch(segment_id, batch_sequence);
CREATE INDEX IF NOT EXISTS idx_processed_event_batch ON processed_event(batch_id);

-- Record the baseline only after every table, index, trigger, and seed above succeeded.
INSERT OR IGNORE INTO schema_migration (
  migration_id, schema_version, description
) VALUES
(
  '2026-07-14_mvp_schema_v0_1_13_multi_device_m1_identity',
  '0.1.13-multi-device-m1-identity',
  'M1: identity+topology tables and student_profile.user_id'
),
(
  '2026-07-15_mvp_schema_v0_1_14_multi_device_m2_session_foundation',
  '0.1.14-multi-device-m2-session-foundation',
  'Full baseline: v0.1.12 MVP closure + M1 identity/topology + M2 business session foundation'
),
(
  '2026-07-15_mvp_schema_v0_1_15_multi_device_m3_grant_assignment',
  '0.1.15-multi-device-m3-grant-assignment',
  'M3: grant assignment tables and delivery phase forward-only guards'
),
(
  '2026-07-20_job_skill_phase4_asset_roles',
  '0.1.15-multi-device-m3-grant-assignment',
  'Job skill phase 4: add role-play, sealed-admin and offline-setup asset roles'
),
(
  '2026-07-23_f4_assessment_sitting',
  '0.1.15-multi-device-m3-grant-assignment',
  'F4: assessment sitting projection for pause, resume and collapse history'
),
(
  '2026-07-24_f6_offline_score_scope_required',
  '0.1.15-multi-device-m3-grant-assignment',
  'F6: require explicit offline_score_record.score_scope'
),
(
  '2026-07-24_f7_report_framework',
  '0.1.16-report-framework',
  'F7: task closure, report lineage, contract state, and legacy report backfill'
),
(
  '2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey',
  '0.1.17-multi-device-m4-safety-rekey',
  'M4: re-key safety aggregation from student/task to student/job/task'
),
(
  '2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2',
  '0.1.18-event-batch-v2.2',
  'M5B: durable command ledger and event batch apply cursors'
);

-- ============================================================================
-- End of schema.sql v0.1.18-event-batch-v2.2
-- ============================================================================

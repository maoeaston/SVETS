import { createHash } from 'node:crypto'
import type { DBAdapter } from './interface'
import {
  EVENT_BATCH_MIGRATION_ID,
  EVENT_BATCH_SCHEMA_VERSION,
  inspectEventBatchStructure
} from './event-batch-migration'
import { m4SafetyRekeyPreviewAwareObjectSql } from './safety-rekey-migration'
import { PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_VERSION } from '../../shared/types/preview-contract'
import type { PreviewContractReadiness } from '../../shared/types/preview-contract'

export const PREVIEW_CONTRACT_SCHEMA_VERSION = '0.1.19-job-skill-preview-contract-v1'
export const PREVIEW_CONTRACT_MIGRATION_DESCRIPTION = 'PREVIEW_CONTRACT_V1 additive preview, principal and feedback projections'

export type PreviewContractMigrationState = 'ABSENT' | 'INSTALLING' | 'CURRENT' | 'PARTIAL_OR_DRIFTED'

export class PreviewContractMigrationError extends Error {
  constructor(
    public readonly code:
      | 'PREVIEW_CONTRACT_MIGRATION_REQUIRED'
      | 'PREVIEW_CONTRACT_BACKUP_REQUIRED'
      | 'PREVIEW_CONTRACT_SCHEMA_DRIFT'
      | 'PREVIEW_CONTRACT_LEDGER_DRIFT'
      | 'PREVIEW_CONTRACT_INTEGRITY_FAILED'
      | 'PREVIEW_CONTRACT_RECOVERY_REQUIRED',
    message: string,
    public readonly issues: readonly string[] = [],
    public readonly cause?: unknown
  ) {
    super(`[preview-contract-migration] ${message}`)
    this.name = 'PreviewContractMigrationError'
  }
}

export const PREVIEW_CONTRACT_TABLE_NAMES = Object.freeze([
  'preview_contract_registry',
  'preview_bootstrap_replay_projection',
  'preview_event_projection',
  'preview_release_projection',
  'principal_binding_projection',
  'preview_session_projection',
  'preview_session_question_projection',
  'preview_safety_incident_projection',
  'preview_feedback_reference_projection',
  'preview_feedback_tombstone_projection'
])

export const PREVIEW_CONTRACT_INDEX_NAMES = Object.freeze([
  'ux_preview_release_source_ref',
  'ux_preview_release_binding',
  'ux_principal_active_user',
  'ux_principal_active_principal',
  'idx_preview_session_status',
  'idx_preview_session_question_order',
  'ux_preview_safety_open_triplet',
  'ux_feedback_reference_commit',
  'ux_feedback_tombstone_commit'
])

export const PREVIEW_CONTRACT_TRIGGER_NAMES = Object.freeze([
  'trg_preview_principal_no_overlap_insert',
  'trg_preview_principal_no_overlap_update',
  'trg_preview_session_shell_match_insert',
  'trg_preview_session_shell_match_update',
  'trg_preview_session_snapshot_immutable',
  'trg_preview_result_suppression_insert',
  'trg_preview_result_suppression_update',
  'trg_preview_report_suppression_insert',
  'trg_preview_report_suppression_update',
  'trg_preview_safety_scope'
])

export const PREVIEW_CONTRACT_OBJECT_NAMES = Object.freeze([
  ...PREVIEW_CONTRACT_TABLE_NAMES.map((name) => `table:${name}`),
  ...PREVIEW_CONTRACT_INDEX_NAMES.map((name) => `index:${name}`),
  ...PREVIEW_CONTRACT_TRIGGER_NAMES.map((name) => `trigger:${name}`)
].sort())

export const PREVIEW_CONTRACT_OBJECT_DIGEST = createHash('sha256')
  .update(PREVIEW_CONTRACT_OBJECT_NAMES.join('\n'))
  .digest('hex')

type PreviewContractIndexContract = Readonly<{
  table: string
  unique: boolean
  partial: boolean
  columns: readonly string[]
  where?: string
}>

type PreviewContractForeignKeyContract = Readonly<{
  table: string
  from: string
  toTable: string
  to: string
  onUpdate: string
  onDelete: string
  match: string
}>

const PREVIEW_CONTRACT_COLUMN_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  preview_contract_registry: [
    'registry_id', 'contract_version', 'schema_version', 'migration_id', 'status',
    'event_registry_digest', 'projection_digest', 'query_digest', 'recovery_digest',
    'error_map_digest', 'installed_at', 'updated_at'
  ],
  preview_bootstrap_replay_projection: [
    'replay_key', 'target_installation_id', 'certificate_id', 'challenge_id',
    'nonce_hash', 'enrollment_id', 'enrollment_package_hash', 'mapping_id', 'accepted_at'
  ],
  preview_event_projection: [
    'event_id', 'contract_registry_id', 'aggregate_type', 'aggregate_id', 'event_type',
    'event_sequence', 'payload_json', 'checksum', 'source_batch_id', 'source_batch_hash',
    'created_at'
  ],
  preview_release_projection: [
    'release_id', 'source_ref_id', 'delivery_mode', 'question_id', 'question_version',
    'semantic_hash', 'pack_id', 'pack_version', 'pack_hash', 'strategy_id',
    'strategy_version', 'policy_hash', 'approval_id', 'approval_hash', 'manifest_id',
    'manifest_hash', 'references_json', 'status', 'effective_at', 'expires_at',
    'revoked_at', 'created_event_id', 'audit_ref', 'created_at'
  ],
  principal_binding_projection: [
    'mapping_id', 'target_installation_id', 'organization_id', 'user_id', 'principal_id',
    'mapping_version', 'mapping_hash', 'source_manifest_id', 'source_manifest_hash',
    'effective_at', 'expires_at', 'revoked_at', 'status', 'signer_key_id', 'signature',
    'created_event_id', 'created_at'
  ],
  preview_session_projection: [
    'preview_session_id', 'assessment_session_id', 'contract_registry_id', 'contract_version',
    'delivery_mode', 'student_id', 'job_code', 'task_code', 'pack_id', 'pack_version',
    'pack_hash', 'source_ref_id', 'strategy_id', 'strategy_version', 'snapshot_json',
    'content_root_hash', 'scoring_root_hash', 'renderer_root_hash', 'snapshot_root_hash',
    'assignment_id', 'grant_id', 'status', 'result_suppressed', 'preview_redline_ref',
    'created_event_id', 'last_event_id', 'created_at', 'updated_at'
  ],
  preview_session_question_projection: [
    'session_question_id', 'preview_session_id', 'question_id', 'question_version',
    'semantic_hash', 'question_order', 'question_phase', 'snapshot_json', 'content_hash',
    'scoring_hash', 'renderer_hash', 'safety_ref'
  ],
  preview_safety_incident_projection: [
    'incident_id', 'preview_session_id', 'student_id', 'job_code', 'task_code', 'reason_code',
    'status', 'preview_redline_ref', 'occurred_at', 'created_event_id', 'created_at'
  ],
  preview_feedback_reference_projection: [
    'feedback_id', 'revision_no', 'feedback_commit_id', 'proof_hash', 'session_id',
    'organization_id', 'status', 'body_hash', 'session_export_ref', 'subject_export_ref',
    'created_event_id', 'created_at'
  ],
  preview_feedback_tombstone_projection: [
    'tombstone_id', 'feedback_id', 'revision_no', 'feedback_commit_id', 'proof_hash',
    'reason_code', 'tombstoned_by', 'tombstoned_at', 'audit_ref', 'created_event_id'
  ]
})

const PREVIEW_CONTRACT_INDEX_CONTRACTS: Readonly<Record<string, PreviewContractIndexContract>> = Object.freeze({
  ux_preview_release_source_ref: {
    table: 'preview_release_projection', unique: true, partial: false, columns: ['source_ref_id']
  },
  ux_preview_release_binding: {
    table: 'preview_release_projection', unique: true, partial: false,
    columns: ['delivery_mode', 'question_id', 'question_version', 'semantic_hash', 'pack_id', 'pack_version', 'approval_id']
  },
  ux_principal_active_user: {
    table: 'principal_binding_projection', unique: true, partial: true,
    columns: ['target_installation_id', 'organization_id', 'user_id'], where: "status = 'ACTIVE'"
  },
  ux_principal_active_principal: {
    table: 'principal_binding_projection', unique: true, partial: true,
    columns: ['target_installation_id', 'organization_id', 'principal_id'], where: "status = 'ACTIVE'"
  },
  idx_preview_session_status: {
    table: 'preview_session_projection', unique: false, partial: false,
    columns: ['student_id', 'job_code', 'task_code', 'status']
  },
  idx_preview_session_question_order: {
    table: 'preview_session_question_projection', unique: false, partial: false,
    columns: ['preview_session_id', 'question_order']
  },
  ux_preview_safety_open_triplet: {
    table: 'preview_safety_incident_projection', unique: true, partial: true,
    columns: ['student_id', 'job_code', 'task_code'], where: "status = 'OPEN'"
  },
  ux_feedback_reference_commit: {
    table: 'preview_feedback_reference_projection', unique: true, partial: false,
    columns: ['feedback_commit_id']
  },
  ux_feedback_tombstone_commit: {
    table: 'preview_feedback_tombstone_projection', unique: true, partial: false,
    columns: ['feedback_commit_id']
  }
})

const PREVIEW_CONTRACT_UNIQUE_CONSTRAINTS: ReadonlyArray<Readonly<{
  table: string
  columns: readonly string[]
}>> = Object.freeze([
  { table: 'preview_contract_registry', columns: ['registry_id'] },
  { table: 'preview_bootstrap_replay_projection', columns: ['replay_key'] },
  { table: 'preview_bootstrap_replay_projection', columns: ['target_installation_id', 'enrollment_id'] },
  { table: 'preview_bootstrap_replay_projection', columns: ['target_installation_id', 'nonce_hash'] },
  { table: 'preview_event_projection', columns: ['event_id'] },
  { table: 'preview_event_projection', columns: ['aggregate_type', 'aggregate_id', 'event_sequence'] },
  { table: 'preview_release_projection', columns: ['release_id'] },
  { table: 'preview_release_projection', columns: ['source_ref_id'] },
  { table: 'preview_release_projection', columns: ['delivery_mode', 'question_id', 'question_version', 'semantic_hash', 'pack_id', 'pack_version', 'approval_id'] },
  { table: 'principal_binding_projection', columns: ['mapping_id'] },
  { table: 'preview_session_projection', columns: ['preview_session_id'] },
  { table: 'preview_session_projection', columns: ['assessment_session_id'] },
  { table: 'preview_session_question_projection', columns: ['session_question_id'] },
  { table: 'preview_session_question_projection', columns: ['preview_session_id', 'question_order'] },
  { table: 'preview_session_question_projection', columns: ['preview_session_id', 'question_id', 'question_version', 'semantic_hash'] },
  { table: 'preview_safety_incident_projection', columns: ['incident_id'] },
  { table: 'preview_safety_incident_projection', columns: ['preview_redline_ref'] },
  { table: 'preview_feedback_reference_projection', columns: ['feedback_id', 'revision_no', 'status'] },
  { table: 'preview_feedback_reference_projection', columns: ['feedback_commit_id'] },
  { table: 'preview_feedback_tombstone_projection', columns: ['tombstone_id'] },
  { table: 'preview_feedback_tombstone_projection', columns: ['feedback_commit_id'] },
  { table: 'preview_feedback_tombstone_projection', columns: ['feedback_id', 'revision_no'] }
])

const PREVIEW_CONTRACT_FOREIGN_KEYS: readonly PreviewContractForeignKeyContract[] = Object.freeze([
  { table: 'preview_event_projection', from: 'contract_registry_id', toTable: 'preview_contract_registry', to: 'registry_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_event_projection', from: 'source_batch_id', toTable: 'applied_event_batch', to: 'batch_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_release_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'principal_binding_projection', from: 'user_id', toTable: 'user_account', to: 'user_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'principal_binding_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_projection', from: 'assessment_session_id', toTable: 'assessment_session', to: 'session_id', onUpdate: 'NO ACTION', onDelete: 'RESTRICT', match: 'NONE' },
  { table: 'preview_session_projection', from: 'contract_registry_id', toTable: 'preview_contract_registry', to: 'registry_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_projection', from: 'student_id', toTable: 'student_profile', to: 'student_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_projection', from: 'source_ref_id', toTable: 'preview_release_projection', to: 'source_ref_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_projection', from: 'last_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_session_question_projection', from: 'preview_session_id', toTable: 'preview_session_projection', to: 'preview_session_id', onUpdate: 'NO ACTION', onDelete: 'RESTRICT', match: 'NONE' },
  { table: 'preview_safety_incident_projection', from: 'preview_session_id', toTable: 'preview_session_projection', to: 'preview_session_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_safety_incident_projection', from: 'student_id', toTable: 'student_profile', to: 'student_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_safety_incident_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_feedback_reference_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
  { table: 'preview_feedback_tombstone_projection', from: 'created_event_id', toTable: 'preview_event_projection', to: 'event_id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' }
])

const PREVIEW_CONTRACT_TABLE_MARKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  preview_contract_registry: [
    "registry_id TEXT PRIMARY KEY CHECK (registry_id = 'PREVIEW_CONTRACT_V1')",
    "status TEXT NOT NULL CHECK (status IN ('INSTALLING','READY','DISABLED'))"
  ],
  preview_bootstrap_replay_projection: [
    'replay_key TEXT PRIMARY KEY',
    'nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64)',
    'UNIQUE (target_installation_id, enrollment_id)',
    'UNIQUE (target_installation_id, nonce_hash)'
  ],
  preview_event_projection: [
    "aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('PREVIEW_RELEASE','PREVIEW_SESSION','PREVIEW_FEEDBACK','PRINCIPAL_BINDING'))",
    'payload_json TEXT NOT NULL CHECK (json_valid(payload_json))',
    'checksum TEXT NOT NULL CHECK (length(checksum) = 64)',
    'UNIQUE (aggregate_type, aggregate_id, event_sequence)'
  ],
  preview_release_projection: [
    "delivery_mode TEXT NOT NULL CHECK (delivery_mode = 'PREVIEW_ONLY')",
    'references_json TEXT NOT NULL CHECK (json_valid(references_json))',
    "status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','REVOKED','SUPERSEDED','DISABLED','ARCHIVED'))"
  ],
  principal_binding_projection: [
    "status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','SUPERSEDED'))",
    'mapping_hash TEXT NOT NULL CHECK (length(mapping_hash) = 64)',
    'signature TEXT NOT NULL'
  ],
  preview_session_projection: [
    "contract_version TEXT NOT NULL CHECK (contract_version = 'PREVIEW_CONTRACT_V1')",
    "delivery_mode TEXT NOT NULL CHECK (delivery_mode = 'PREVIEW_ONLY')",
    'snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))',
    'result_suppressed INTEGER NOT NULL DEFAULT 1 CHECK (result_suppressed = 1)'
  ],
  preview_session_question_projection: [
    "question_phase TEXT NOT NULL CHECK (question_phase IN ('ONLINE','OFFLINE','OBSERVATION'))",
    'snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))'
  ],
  preview_safety_incident_projection: [
    "status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','VOIDED'))",
    'preview_redline_ref TEXT NOT NULL UNIQUE'
  ],
  preview_feedback_reference_projection: [
    "status TEXT NOT NULL CHECK (status IN ('DRAFT','VAULT_PREPARED','RECONCILE_REQUIRED','RECONCILED_SUBMITTED','RECONCILED_DELETED','PURGED','TOMBSTONED'))",
    'body_hash TEXT NOT NULL CHECK (length(body_hash) = 64)'
  ],
  preview_feedback_tombstone_projection: [
    'proof_hash TEXT NOT NULL CHECK (length(proof_hash) = 64)',
    'UNIQUE (feedback_id, revision_no)'
  ]
})

const PREVIEW_CONTRACT_TRIGGER_MARKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  trg_preview_principal_no_overlap_insert: [
    'BEFORE INSERT ON principal_binding_projection',
    "NEW.status = 'ACTIVE'",
    'old.user_id = NEW.user_id OR old.principal_id = NEW.principal_id',
    'old.effective_at < NEW.expires_at AND NEW.effective_at < old.expires_at',
    "RAISE(ABORT, 'active principal binding window overlaps')"
  ],
  trg_preview_principal_no_overlap_update: [
    'BEFORE UPDATE OF status, user_id, principal_id, effective_at, expires_at ON principal_binding_projection',
    'old.mapping_id <> NEW.mapping_id',
    "RAISE(ABORT, 'active principal binding window overlaps')"
  ],
  trg_preview_session_shell_match_insert: [
    'BEFORE INSERT ON preview_session_projection',
    "s.session_contract_kind = 'PREVIEW_SHELL'",
    "s.preview_contract_version = 'PREVIEW_CONTRACT_V1'",
    's.student_id = NEW.student_id',
    "RAISE(ABORT, 'preview session requires a matching PREVIEW_SHELL')"
  ],
  trg_preview_session_shell_match_update: [
    'BEFORE UPDATE OF assessment_session_id, student_id, job_code, task_code ON preview_session_projection',
    "s.session_contract_kind = 'PREVIEW_SHELL'",
    "RAISE(ABORT, 'preview session requires a matching PREVIEW_SHELL')"
  ],
  trg_preview_session_snapshot_immutable: [
    'BEFORE UPDATE OF preview_session_id, assessment_session_id, contract_registry_id, contract_version, delivery_mode, student_id, job_code, task_code, pack_id, pack_version, pack_hash, source_ref_id, strategy_id, strategy_version, snapshot_json, content_root_hash, scoring_root_hash, renderer_root_hash, snapshot_root_hash, assignment_id, grant_id, created_event_id, created_at ON preview_session_projection',
    'OLD.preview_session_id <> NEW.preview_session_id',
    'OLD.assessment_session_id <> NEW.assessment_session_id',
    'OLD.contract_registry_id <> NEW.contract_registry_id',
    'OLD.contract_version <> NEW.contract_version',
    'OLD.delivery_mode <> NEW.delivery_mode',
    'OLD.student_id <> NEW.student_id',
    'OLD.job_code <> NEW.job_code',
    'OLD.task_code <> NEW.task_code',
    'OLD.pack_id <> NEW.pack_id',
    'OLD.pack_version <> NEW.pack_version',
    'OLD.pack_hash <> NEW.pack_hash',
    'OLD.source_ref_id <> NEW.source_ref_id',
    'OLD.strategy_id <> NEW.strategy_id',
    'OLD.strategy_version <> NEW.strategy_version',
    'OLD.snapshot_json <> NEW.snapshot_json',
    'OLD.content_root_hash <> NEW.content_root_hash',
    'OLD.scoring_root_hash <> NEW.scoring_root_hash',
    'OLD.renderer_root_hash <> NEW.renderer_root_hash',
    'OLD.snapshot_root_hash <> NEW.snapshot_root_hash',
    'OLD.assignment_id <> NEW.assignment_id',
    'OLD.grant_id <> NEW.grant_id',
    'OLD.created_event_id <> NEW.created_event_id',
    'OLD.created_at <> NEW.created_at',
    "RAISE(ABORT, 'preview session frozen snapshot is immutable')"
  ],
  trg_preview_result_suppression_insert: [
    'BEFORE INSERT ON result_record',
    "NEW.source_aggregate_type = 'ASSESSMENT_SESSION'",
    'p.assessment_session_id = NEW.source_aggregate_id',
    "RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal result_record')"
  ],
  trg_preview_result_suppression_update: [
    'BEFORE UPDATE ON result_record',
    "NEW.source_aggregate_type = 'ASSESSMENT_SESSION'",
    "RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal result_record')"
  ],
  trg_preview_report_suppression_insert: [
    'BEFORE INSERT ON task_report',
    "NEW.source_aggregate_type = 'ASSESSMENT_SESSION'",
    'p.assessment_session_id = NEW.source_aggregate_id',
    "RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal task_report')"
  ],
  trg_preview_report_suppression_update: [
    'BEFORE UPDATE ON task_report',
    "NEW.source_aggregate_type = 'ASSESSMENT_SESSION'",
    "RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal task_report')"
  ],
  trg_preview_safety_scope: [
    'BEFORE INSERT ON preview_safety_incident_projection',
    'p.student_id = NEW.student_id',
    'p.job_code = NEW.job_code',
    'p.task_code = NEW.task_code',
    "RAISE(ABORT, 'preview safety incident scope mismatch')"
  ]
})

export const PREVIEW_CONTRACT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS preview_contract_registry (
  registry_id             TEXT PRIMARY KEY CHECK (registry_id = 'PREVIEW_CONTRACT_V1'),
  contract_version        TEXT NOT NULL CHECK (contract_version = 'PREVIEW_CONTRACT_V1'),
  schema_version          TEXT NOT NULL,
  migration_id            TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('INSTALLING','READY','DISABLED')),
  event_registry_digest   TEXT NOT NULL,
  projection_digest       TEXT NOT NULL,
  query_digest            TEXT NOT NULL,
  recovery_digest         TEXT NOT NULL,
  error_map_digest        TEXT NOT NULL,
  installed_at            TEXT,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preview_bootstrap_replay_projection (
  replay_key              TEXT PRIMARY KEY,
  target_installation_id TEXT NOT NULL,
  certificate_id          TEXT NOT NULL,
  challenge_id            TEXT NOT NULL,
  nonce_hash              TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  enrollment_id           TEXT NOT NULL,
  enrollment_package_hash TEXT NOT NULL CHECK (length(enrollment_package_hash) = 64),
  mapping_id              TEXT NOT NULL,
  accepted_at             TEXT NOT NULL,
  UNIQUE (target_installation_id, enrollment_id),
  UNIQUE (target_installation_id, nonce_hash)
);

CREATE TABLE IF NOT EXISTS preview_event_projection (
  event_id                TEXT PRIMARY KEY,
  contract_registry_id    TEXT NOT NULL REFERENCES preview_contract_registry(registry_id),
  aggregate_type          TEXT NOT NULL CHECK (aggregate_type IN ('PREVIEW_RELEASE','PREVIEW_SESSION','PREVIEW_FEEDBACK','PRINCIPAL_BINDING')),
  aggregate_id            TEXT NOT NULL,
  event_type              TEXT NOT NULL CHECK (event_type IN (
    'PRINCIPAL_BINDING_ENROLLMENT','PRINCIPAL_BINDING_ROTATION',
    'PREVIEW_PACK_RELEASED','PREVIEW_PACK_REVOKED',
    'PREVIEW_SESSION_STARTED','PREVIEW_SESSION_COMPLETED','PREVIEW_SESSION_ABORTED',
    'PREVIEW_SESSION_TECHNICAL_INTERRUPTION','PREVIEW_SAFETY_INCIDENT_CREATED',
    'PREVIEW_FEEDBACK_DRAFT_SAVED','PREVIEW_FEEDBACK_REFERENCE_COMMITTED',
    'PREVIEW_FEEDBACK_RECONCILED','PREVIEW_FEEDBACK_TOMBSTONE_COMMITTED',
    'PREVIEW_FEEDBACK_PURGED','PREVIEW_FEEDBACK_REPAIRED','PREVIEW_FEEDBACK_EXPORT_COMMITTED'
  )),
  event_sequence          INTEGER NOT NULL CHECK (event_sequence >= 1),
  payload_json            TEXT NOT NULL CHECK (json_valid(payload_json)),
  checksum                TEXT NOT NULL CHECK (length(checksum) = 64),
  source_batch_id         TEXT REFERENCES applied_event_batch(batch_id),
  source_batch_hash       TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (aggregate_type, aggregate_id, event_sequence)
);

CREATE TABLE IF NOT EXISTS preview_release_projection (
  release_id              TEXT PRIMARY KEY,
  source_ref_id           TEXT NOT NULL UNIQUE,
  delivery_mode           TEXT NOT NULL CHECK (delivery_mode = 'PREVIEW_ONLY'),
  question_id             TEXT NOT NULL,
  question_version        INTEGER NOT NULL CHECK (question_version >= 1),
  semantic_hash           TEXT NOT NULL CHECK (length(semantic_hash) = 64),
  pack_id                 TEXT NOT NULL,
  pack_version            TEXT NOT NULL,
  pack_hash               TEXT NOT NULL CHECK (length(pack_hash) = 64),
  strategy_id             TEXT NOT NULL,
  strategy_version        INTEGER NOT NULL CHECK (strategy_version >= 1),
  policy_hash             TEXT NOT NULL CHECK (length(policy_hash) = 64),
  approval_id             TEXT NOT NULL,
  approval_hash           TEXT NOT NULL CHECK (length(approval_hash) = 64),
  manifest_id             TEXT NOT NULL,
  manifest_hash           TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  references_json         TEXT NOT NULL CHECK (json_valid(references_json)),
  status                  TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','REVOKED','SUPERSEDED','DISABLED','ARCHIVED')),
  effective_at            TEXT NOT NULL,
  expires_at              TEXT NOT NULL,
  revoked_at              TEXT,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  audit_ref               TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (delivery_mode, question_id, question_version, semantic_hash, pack_id, pack_version, approval_id)
);

CREATE TABLE IF NOT EXISTS principal_binding_projection (
  mapping_id              TEXT PRIMARY KEY,
  target_installation_id TEXT NOT NULL,
  organization_id         TEXT NOT NULL,
  user_id                 TEXT NOT NULL REFERENCES user_account(user_id),
  principal_id            TEXT NOT NULL,
  mapping_version         INTEGER NOT NULL CHECK (mapping_version >= 1),
  mapping_hash            TEXT NOT NULL CHECK (length(mapping_hash) = 64),
  source_manifest_id      TEXT NOT NULL,
  source_manifest_hash    TEXT NOT NULL CHECK (length(source_manifest_hash) = 64),
  effective_at            TEXT NOT NULL,
  expires_at              TEXT NOT NULL,
  revoked_at              TEXT,
  status                  TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','SUPERSEDED')),
  signer_key_id           TEXT NOT NULL,
  signature               TEXT NOT NULL,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preview_session_projection (
  preview_session_id      TEXT PRIMARY KEY,
  assessment_session_id   TEXT NOT NULL UNIQUE REFERENCES assessment_session(session_id) ON DELETE RESTRICT,
  contract_registry_id    TEXT NOT NULL REFERENCES preview_contract_registry(registry_id),
  contract_version        TEXT NOT NULL CHECK (contract_version = 'PREVIEW_CONTRACT_V1'),
  delivery_mode           TEXT NOT NULL CHECK (delivery_mode = 'PREVIEW_ONLY'),
  student_id              TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                TEXT NOT NULL,
  task_code               TEXT NOT NULL,
  pack_id                 TEXT NOT NULL,
  pack_version            TEXT NOT NULL,
  pack_hash               TEXT NOT NULL CHECK (length(pack_hash) = 64),
  source_ref_id           TEXT NOT NULL REFERENCES preview_release_projection(source_ref_id),
  strategy_id             TEXT NOT NULL,
  strategy_version        INTEGER NOT NULL CHECK (strategy_version >= 1),
  snapshot_json           TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  content_root_hash       TEXT NOT NULL CHECK (length(content_root_hash) = 64),
  scoring_root_hash       TEXT NOT NULL CHECK (length(scoring_root_hash) = 64),
  renderer_root_hash      TEXT NOT NULL CHECK (length(renderer_root_hash) = 64),
  snapshot_root_hash      TEXT NOT NULL CHECK (length(snapshot_root_hash) = 64),
  assignment_id           TEXT NOT NULL,
  grant_id                TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('PREPARED','ACTIVE','COMPLETED','ABORTED','TECHNICAL_INTERRUPTED','REDLINE_HALTED')),
  result_suppressed       INTEGER NOT NULL DEFAULT 1 CHECK (result_suppressed = 1),
  preview_redline_ref     TEXT,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  last_event_id           TEXT REFERENCES preview_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preview_session_question_projection (
  session_question_id     TEXT PRIMARY KEY,
  preview_session_id      TEXT NOT NULL REFERENCES preview_session_projection(preview_session_id) ON DELETE RESTRICT,
  question_id             TEXT NOT NULL,
  question_version        INTEGER NOT NULL CHECK (question_version >= 1),
  semantic_hash           TEXT NOT NULL CHECK (length(semantic_hash) = 64),
  question_order          INTEGER NOT NULL CHECK (question_order >= 1),
  question_phase          TEXT NOT NULL CHECK (question_phase IN ('ONLINE','OFFLINE','OBSERVATION')),
  snapshot_json           TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  content_hash            TEXT NOT NULL CHECK (length(content_hash) = 64),
  scoring_hash            TEXT NOT NULL CHECK (length(scoring_hash) = 64),
  renderer_hash           TEXT NOT NULL CHECK (length(renderer_hash) = 64),
  safety_ref              TEXT NOT NULL,
  UNIQUE (preview_session_id, question_order),
  UNIQUE (preview_session_id, question_id, question_version, semantic_hash)
);

CREATE TABLE IF NOT EXISTS preview_safety_incident_projection (
  incident_id             TEXT PRIMARY KEY,
  preview_session_id      TEXT NOT NULL REFERENCES preview_session_projection(preview_session_id),
  student_id              TEXT NOT NULL REFERENCES student_profile(student_id),
  job_code                TEXT NOT NULL,
  task_code               TEXT NOT NULL,
  reason_code             TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','VOIDED')),
  preview_redline_ref     TEXT NOT NULL UNIQUE,
  occurred_at             TEXT NOT NULL,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preview_feedback_reference_projection (
  feedback_id             TEXT NOT NULL,
  revision_no             INTEGER NOT NULL CHECK (revision_no >= 1),
  feedback_commit_id      TEXT NOT NULL UNIQUE,
  proof_hash              TEXT NOT NULL CHECK (length(proof_hash) = 64),
  session_id              TEXT NOT NULL,
  organization_id         TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('DRAFT','VAULT_PREPARED','RECONCILE_REQUIRED','RECONCILED_SUBMITTED','RECONCILED_DELETED','PURGED','TOMBSTONED')),
  body_hash               TEXT NOT NULL CHECK (length(body_hash) = 64),
  session_export_ref      TEXT NOT NULL,
  subject_export_ref      TEXT NOT NULL,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (feedback_id, revision_no, status)
);

CREATE TABLE IF NOT EXISTS preview_feedback_tombstone_projection (
  tombstone_id            TEXT PRIMARY KEY,
  feedback_id             TEXT NOT NULL,
  revision_no             INTEGER NOT NULL CHECK (revision_no >= 1),
  feedback_commit_id      TEXT NOT NULL UNIQUE,
  proof_hash              TEXT NOT NULL CHECK (length(proof_hash) = 64),
  reason_code             TEXT NOT NULL,
  tombstoned_by           TEXT NOT NULL,
  tombstoned_at           TEXT NOT NULL,
  audit_ref               TEXT NOT NULL,
  created_event_id        TEXT NOT NULL REFERENCES preview_event_projection(event_id),
  UNIQUE (feedback_id, revision_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_preview_release_source_ref
  ON preview_release_projection(source_ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_preview_release_binding
  ON preview_release_projection(delivery_mode, question_id, question_version, semantic_hash, pack_id, pack_version, approval_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_principal_active_user
  ON principal_binding_projection(target_installation_id, organization_id, user_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_principal_active_principal
  ON principal_binding_projection(target_installation_id, organization_id, principal_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_preview_session_status
  ON preview_session_projection(student_id, job_code, task_code, status);
CREATE INDEX IF NOT EXISTS idx_preview_session_question_order
  ON preview_session_question_projection(preview_session_id, question_order);
CREATE UNIQUE INDEX IF NOT EXISTS ux_preview_safety_open_triplet
  ON preview_safety_incident_projection(student_id, job_code, task_code) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS ux_feedback_reference_commit
  ON preview_feedback_reference_projection(feedback_commit_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_feedback_tombstone_commit
  ON preview_feedback_tombstone_projection(feedback_commit_id);

CREATE TRIGGER IF NOT EXISTS trg_preview_principal_no_overlap_insert
BEFORE INSERT ON principal_binding_projection
FOR EACH ROW WHEN NEW.status = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM principal_binding_projection old
  WHERE old.status = 'ACTIVE'
    AND old.target_installation_id = NEW.target_installation_id
    AND old.organization_id = NEW.organization_id
    AND (old.user_id = NEW.user_id OR old.principal_id = NEW.principal_id)
    AND old.effective_at < NEW.expires_at AND NEW.effective_at < old.expires_at
)
BEGIN SELECT RAISE(ABORT, 'active principal binding window overlaps'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_principal_no_overlap_update
BEFORE UPDATE OF status, user_id, principal_id, effective_at, expires_at ON principal_binding_projection
FOR EACH ROW WHEN NEW.status = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM principal_binding_projection old
  WHERE old.mapping_id <> NEW.mapping_id
    AND old.status = 'ACTIVE'
    AND old.target_installation_id = NEW.target_installation_id
    AND old.organization_id = NEW.organization_id
    AND (old.user_id = NEW.user_id OR old.principal_id = NEW.principal_id)
    AND old.effective_at < NEW.expires_at AND NEW.effective_at < old.expires_at
)
BEGIN SELECT RAISE(ABORT, 'active principal binding window overlaps'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_session_shell_match_insert
BEFORE INSERT ON preview_session_projection
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM assessment_session s
  WHERE s.session_id = NEW.assessment_session_id
    AND s.session_contract_kind = 'PREVIEW_SHELL'
    AND s.preview_contract_version = 'PREVIEW_CONTRACT_V1'
    AND s.student_id = NEW.student_id
    AND s.job_code = NEW.job_code
    AND s.task_code = NEW.task_code
)
BEGIN SELECT RAISE(ABORT, 'preview session requires a matching PREVIEW_SHELL'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_session_shell_match_update
BEFORE UPDATE OF assessment_session_id, student_id, job_code, task_code ON preview_session_projection
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM assessment_session s
  WHERE s.session_id = NEW.assessment_session_id
    AND s.session_contract_kind = 'PREVIEW_SHELL'
    AND s.preview_contract_version = 'PREVIEW_CONTRACT_V1'
    AND s.student_id = NEW.student_id
    AND s.job_code = NEW.job_code
    AND s.task_code = NEW.task_code
)
BEGIN SELECT RAISE(ABORT, 'preview session requires a matching PREVIEW_SHELL'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_session_snapshot_immutable
BEFORE UPDATE OF preview_session_id, assessment_session_id, contract_registry_id, contract_version, delivery_mode, student_id, job_code, task_code, pack_id, pack_version, pack_hash, source_ref_id, strategy_id, strategy_version, snapshot_json, content_root_hash, scoring_root_hash, renderer_root_hash, snapshot_root_hash, assignment_id, grant_id, created_event_id, created_at ON preview_session_projection
FOR EACH ROW WHEN OLD.preview_session_id <> NEW.preview_session_id
  OR OLD.assessment_session_id <> NEW.assessment_session_id
  OR OLD.contract_registry_id <> NEW.contract_registry_id
  OR OLD.contract_version <> NEW.contract_version
  OR OLD.delivery_mode <> NEW.delivery_mode
  OR OLD.student_id <> NEW.student_id
  OR OLD.job_code <> NEW.job_code
  OR OLD.task_code <> NEW.task_code
  OR OLD.pack_id <> NEW.pack_id
  OR OLD.pack_version <> NEW.pack_version
  OR OLD.pack_hash <> NEW.pack_hash
  OR OLD.source_ref_id <> NEW.source_ref_id
  OR OLD.strategy_id <> NEW.strategy_id
  OR OLD.strategy_version <> NEW.strategy_version
  OR OLD.snapshot_json <> NEW.snapshot_json
  OR OLD.content_root_hash <> NEW.content_root_hash
  OR OLD.scoring_root_hash <> NEW.scoring_root_hash
  OR OLD.renderer_root_hash <> NEW.renderer_root_hash
  OR OLD.snapshot_root_hash <> NEW.snapshot_root_hash
  OR OLD.assignment_id <> NEW.assignment_id
  OR OLD.grant_id <> NEW.grant_id
  OR OLD.created_event_id <> NEW.created_event_id
  OR OLD.created_at <> NEW.created_at
BEGIN SELECT RAISE(ABORT, 'preview session frozen snapshot is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_result_suppression_insert
BEFORE INSERT ON result_record
FOR EACH ROW WHEN NEW.source_aggregate_type = 'ASSESSMENT_SESSION' AND EXISTS (
  SELECT 1 FROM preview_session_projection p WHERE p.assessment_session_id = NEW.source_aggregate_id
)
BEGIN SELECT RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal result_record'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_result_suppression_update
BEFORE UPDATE ON result_record
FOR EACH ROW WHEN NEW.source_aggregate_type = 'ASSESSMENT_SESSION' AND EXISTS (
  SELECT 1 FROM preview_session_projection p WHERE p.assessment_session_id = NEW.source_aggregate_id
)
BEGIN SELECT RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal result_record'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_report_suppression_insert
BEFORE INSERT ON task_report
FOR EACH ROW WHEN NEW.source_aggregate_type = 'ASSESSMENT_SESSION' AND EXISTS (
  SELECT 1 FROM preview_session_projection p WHERE p.assessment_session_id = NEW.source_aggregate_id
)
BEGIN SELECT RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal task_report'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_report_suppression_update
BEFORE UPDATE ON task_report
FOR EACH ROW WHEN NEW.source_aggregate_type = 'ASSESSMENT_SESSION' AND EXISTS (
  SELECT 1 FROM preview_session_projection p WHERE p.assessment_session_id = NEW.source_aggregate_id
)
BEGIN SELECT RAISE(ABORT, 'PREVIEW_ONLY session cannot create formal task_report'); END;

CREATE TRIGGER IF NOT EXISTS trg_preview_safety_scope
BEFORE INSERT ON preview_safety_incident_projection
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM preview_session_projection p
  WHERE p.preview_session_id = NEW.preview_session_id
    AND p.student_id = NEW.student_id
    AND p.job_code = NEW.job_code
    AND p.task_code = NEW.task_code
)
BEGIN SELECT RAISE(ABORT, 'preview safety incident scope mismatch'); END;

INSERT OR IGNORE INTO preview_contract_registry (
  registry_id, contract_version, schema_version, migration_id, status,
  event_registry_digest, projection_digest, query_digest, recovery_digest, error_map_digest
) VALUES (
  'PREVIEW_CONTRACT_V1', 'PREVIEW_CONTRACT_V1', '${PREVIEW_CONTRACT_SCHEMA_VERSION}',
  '${PREVIEW_CONTRACT_MIGRATION_ID}', 'INSTALLING', '', '', '', '', ''
);
`

const PREVIEW_CONTRACT_COLUMN_SQL = [
  `ALTER TABLE assessment_session ADD COLUMN session_contract_kind TEXT NOT NULL DEFAULT 'FORMAL_SHELL' CHECK (session_contract_kind IN ('FORMAL_SHELL','PREVIEW_SHELL'))`,
  `ALTER TABLE assessment_session ADD COLUMN preview_contract_version TEXT CHECK (preview_contract_version IS NULL OR preview_contract_version = 'PREVIEW_CONTRACT_V1')`,
  'ALTER TABLE assessment_session ADD COLUMN preview_redline_ref TEXT'
] as const

const FORMAL_ONLY_TRIGGER_SQL = `
DROP TRIGGER IF EXISTS trg_assessment_delivery_phase_forward_only;
CREATE TRIGGER trg_assessment_delivery_phase_forward_only
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL'
  AND OLD.delivery_phase IS NOT NULL AND NEW.delivery_phase IS NOT NULL
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
DROP TRIGGER IF EXISTS trg_assessment_delivery_phase_insert_prepared;
CREATE TRIGGER trg_assessment_delivery_phase_insert_prepared
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL'
  AND NEW.delivery_phase IS NOT NULL AND NEW.delivery_phase <> 'PREPARED'
BEGIN SELECT RAISE(ABORT, 'new assessment_session delivery_phase must start at PREPARED'); END;
DROP TRIGGER IF EXISTS trg_assessment_delivery_phase_frozen_on_abnormal;
CREATE TRIGGER trg_assessment_delivery_phase_frozen_on_abnormal
BEFORE UPDATE OF delivery_phase ON assessment_session
FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL'
  AND OLD.status IN ('REDLINE_HALTED','ABORTED')
  AND ((OLD.delivery_phase IS NULL) <> (NEW.delivery_phase IS NULL) OR OLD.delivery_phase <> NEW.delivery_phase)
BEGIN SELECT RAISE(ABORT, 'delivery_phase of REDLINE_HALTED/ABORTED session is frozen'); END;
DROP TRIGGER IF EXISTS trg_assessment_finalized_completed_consistency_insert;
CREATE TRIGGER trg_assessment_finalized_completed_consistency_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL'
  AND ((NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
    OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED')))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;
DROP TRIGGER IF EXISTS trg_assessment_finalized_completed_consistency_update;
CREATE TRIGGER trg_assessment_finalized_completed_consistency_update
BEFORE UPDATE OF delivery_phase, status ON assessment_session
FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL'
  AND ((NEW.delivery_phase='FINALIZED' AND NEW.status<>'COMPLETED')
    OR (NEW.status='COMPLETED' AND (NEW.delivery_phase IS NULL OR NEW.delivery_phase<>'FINALIZED')))
BEGIN SELECT RAISE(ABORT, 'FINALIZED must correspond to COMPLETED and vice versa'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_redline_requires_fail_by_safety;
CREATE TRIGGER trg_assessment_session_redline_requires_fail_by_safety
BEFORE INSERT ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
  AND COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
BEGIN SELECT RAISE(ABORT, 'REDLINE_HALTED requires LEVEL_FAIL_BY_SAFETY'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_redline_update_requires_fail_by_safety;
CREATE TRIGGER trg_assessment_session_redline_update_requires_fail_by_safety
BEFORE UPDATE ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
  AND COALESCE(NEW.level_result, '') <> 'LEVEL_FAIL_BY_SAFETY'
BEGIN SELECT RAISE(ABORT, 'REDLINE_HALTED requires LEVEL_FAIL_BY_SAFETY'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_redline_incident_same_student_job_task_insert;
CREATE TRIGGER trg_assessment_session_redline_incident_same_student_job_task_insert
BEFORE INSERT ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
  AND NOT EXISTS (SELECT 1 FROM safety_incident si WHERE si.incident_id = NEW.redline_incident_id AND si.student_id = NEW.student_id AND si.job_code = NEW.job_code AND si.task_code = NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id, job_code and task_code'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_redline_incident_same_student_job_task_update;
CREATE TRIGGER trg_assessment_session_redline_incident_same_student_job_task_update
BEFORE UPDATE ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
  AND NOT EXISTS (SELECT 1 FROM safety_incident si WHERE si.incident_id = NEW.redline_incident_id AND si.student_id = NEW.student_id AND si.job_code = NEW.job_code AND si.task_code = NEW.task_code)
BEGIN SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id, job_code and task_code'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_no_insert_redline_status;
CREATE TRIGGER trg_assessment_session_no_insert_redline_status
BEFORE INSERT ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
BEGIN SELECT RAISE(ABORT, 'assessment_session cannot be inserted directly as REDLINE_HALTED'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_explicit_redline_paths;
CREATE TRIGGER trg_assessment_session_explicit_redline_paths
BEFORE UPDATE OF status ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND NEW.status = 'REDLINE_HALTED'
  AND OLD.status NOT IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING')
BEGIN SELECT RAISE(ABORT, 'invalid assessment_session redline path'); END;
DROP TRIGGER IF EXISTS trg_assessment_session_block_unresolved_safety_incident;
CREATE TRIGGER trg_assessment_session_block_unresolved_safety_incident
BEFORE INSERT ON assessment_session FOR EACH ROW
WHEN NEW.session_contract_kind = 'FORMAL_SHELL' AND EXISTS (
  SELECT 1 FROM safety_incident si WHERE si.student_id = NEW.student_id AND si.job_code = NEW.job_code AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1 AND si.status IN ('PENDING_DETAIL','CONFIRMED')
)
BEGIN SELECT RAISE(ABORT, 'unresolved safety incident blocks new assessment_session'); END;
`

const PREVIEW_AWARE_M4_TRIGGER_SQL = m4SafetyRekeyPreviewAwareObjectSql()
  .filter((sql) => sql.startsWith('CREATE TRIGGER'))

function triggerName(sql: string): string {
  const name = sql.match(/^CREATE TRIGGER\s+([a-z_]+)/i)?.[1]
  if (!name) throw new PreviewContractMigrationError(
    'PREVIEW_CONTRACT_SCHEMA_DRIFT',
    `M4 preview trigger has no stable name: ${sql.slice(0, 80)}`
  )
  return name
}

function installPreviewAwareM4Triggers(database: DBAdapter): void {
  for (const sql of PREVIEW_AWARE_M4_TRIGGER_SQL) {
    database.exec(`DROP TRIGGER IF EXISTS ${triggerName(sql)}`)
    database.exec(sql)
  }
}

type PreviewTableObjectRow = {
  type: 'index' | 'trigger'
  name: string
  sql: string
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      `invalid SQLite identifier during assessment_session rebuild: ${value}`
    )
  }
  return `"${value}"`
}

function buildPreviewAssessmentSessionTableSql(existingSql: string): string {
  const renamed = existingSql.replace(
    /^CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?assessment_session"?\s*\(/i,
    'CREATE TABLE assessment_session__preview_rebuild ('
  )
  if (renamed === existingSql) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      'assessment_session DDL is not the known v0.1.18 table shape'
    )
  }

  const withColumns = renamed.replace(
    /(CREATE TABLE assessment_session__preview_rebuild\s*\(\s*session_id\s+TEXT\s+PRIMARY KEY\s*,)/i,
    `$1
  session_contract_kind TEXT NOT NULL DEFAULT 'FORMAL_SHELL'
    CHECK (session_contract_kind IN ('FORMAL_SHELL', 'PREVIEW_SHELL')),
  preview_contract_version TEXT
    CHECK (preview_contract_version IS NULL OR preview_contract_version = 'PREVIEW_CONTRACT_V1'),
  preview_redline_ref TEXT,`
  )
  if (withColumns === renamed) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      'assessment_session DDL has no recognized session_id anchor'
    )
  }

  const oldRedlineCheck = /  CHECK\s*\(\s*status\s*<>\s*'REDLINE_HALTED'\s*OR\s*\(\s*COALESCE\(level_result,\s*''\)\s*=\s*'LEVEL_FAIL_BY_SAFETY'\s*AND\s*redline_incident_id\s+IS\s+NOT\s+NULL\s*AND\s*length\(trim\(redline_incident_id\)\)\s*>\s*0\s*\)\s*\),?/i
  const rebuilt = withColumns.replace(oldRedlineCheck, `  CHECK (
    status <> 'REDLINE_HALTED'
    OR (
      session_contract_kind = 'FORMAL_SHELL'
      AND COALESCE(level_result, '') = 'LEVEL_FAIL_BY_SAFETY'
      AND redline_incident_id IS NOT NULL
      AND length(trim(redline_incident_id)) > 0
    )
    OR (
      session_contract_kind = 'PREVIEW_SHELL'
      AND preview_redline_ref IS NOT NULL
      AND length(trim(preview_redline_ref)) > 0
    )
  ),
  CHECK (
    session_contract_kind = 'FORMAL_SHELL'
    OR (
      preview_contract_version = 'PREVIEW_CONTRACT_V1'
      AND level_result IS NULL
      AND redline_incident_id IS NULL
    )
  ),`)
  if (rebuilt === withColumns || !rebuilt.includes("session_contract_kind = 'PREVIEW_SHELL'")) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      'assessment_session redline CHECK is not the known formal-only shape'
    )
  }
  return rebuilt
}

function assessmentSessionRebuildObjects(database: DBAdapter): PreviewTableObjectRow[] {
  const indexes = database.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'assessment_session' AND sql IS NOT NULL
    ORDER BY name
  `).all() as PreviewTableObjectRow[]
  const triggers = database.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `).all() as PreviewTableObjectRow[]
  return [
    ...indexes,
    ...triggers.filter((object) => /\bassessment_session\b/i.test(object.sql))
  ]
}

function rebuildAssessmentSessionForPreview(database: DBAdapter): void {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessment_session'"
  ).get() as { sql?: string } | undefined
  if (!table?.sql) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      'assessment_session table is missing before rebuild'
    )
  }

  const columns = columnNames(database, 'assessment_session')
  if (columns.has('session_contract_kind')) return
  const rebuiltSql = buildPreviewAssessmentSessionTableSql(table.sql)
  const oldColumns = [...columns]
  if (oldColumns.length === 0) {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_SCHEMA_DRIFT',
      'assessment_session has no columns before rebuild'
    )
  }
  const columnList = oldColumns.map(quoteIdentifier).join(', ')
  const objects = assessmentSessionRebuildObjects(database)
  // SQLite rejects dropping a table while an external trigger still resolves
  // against it. Keep those triggers in the same frozen object set as the
  // table-local ones, then restore them after the replacement table exists.
  for (const object of objects) {
    if (object.type === 'trigger') database.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(object.name)}`)
  }
  database.exec(rebuiltSql)
  database.exec(`
    INSERT INTO assessment_session__preview_rebuild (${columnList})
    SELECT ${columnList} FROM assessment_session
  `)
  database.exec('DROP TABLE assessment_session')
  database.exec('ALTER TABLE assessment_session__preview_rebuild RENAME TO assessment_session')
  for (const object of objects) database.exec(object.sql)
}

function tableExists(database: DBAdapter, name: string): boolean {
  return Boolean((database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(name) as { present?: number } | undefined)?.present)
}

function objectSql(database: DBAdapter, type: 'table' | 'index' | 'trigger', name: string): string | null {
  const row = database.prepare(
    'SELECT sql FROM sqlite_master WHERE type=? AND name=?'
  ).get(type, name) as { sql?: string | null } | undefined
  return row?.sql ?? null
}

function columnNames(database: DBAdapter, tableName: string): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) => row.name))
}

function normalizePreviewSql(sql: string | null): string {
  return (sql ?? '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .trim()
    .toLowerCase()
}

function previewColumnIssues(database: DBAdapter, table: string): string[] {
  if (!tableExists(database, table)) return []
  const actual = (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>).map((row) => row.name)
  const expected = PREVIEW_CONTRACT_COLUMN_NAMES[table]
  return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [`columns:${table}`]
}

function previewTableMarkerIssues(database: DBAdapter, table: string): string[] {
  const sql = objectSql(database, 'table', table)
  if (!sql) return [`table-sql:${table}`]
  const normalized = normalizePreviewSql(sql)
  return (PREVIEW_CONTRACT_TABLE_MARKERS[table] ?? [])
    .filter((marker) => !normalized.includes(normalizePreviewSql(marker)))
    .map((marker) => `table-sql:${table}:${normalizePreviewSql(marker)}`)
}

function indexList(database: DBAdapter, table: string): Array<{ name?: string; unique?: number; partial?: number }> {
  return database.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name?: string; unique?: number; partial?: number }>
}

function indexColumns(database: DBAdapter, name: string): string[] {
  return (database.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name?: string }>)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string')
}

function previewIndexIssues(database: DBAdapter, name: string): string[] {
  const contract = PREVIEW_CONTRACT_INDEX_CONTRACTS[name]
  if (!contract) return [`index-contract:${name}`]
  const row = indexList(database, contract.table).find((entry) => entry.name === name)
  if (!row) return [`index:${name}`]
  const issues: string[] = []
  if (row.unique !== Number(contract.unique)) issues.push(`unique:index:${name}`)
  if (row.partial !== Number(contract.partial)) issues.push(`partial:index:${name}`)
  if (JSON.stringify(indexColumns(database, name)) !== JSON.stringify(contract.columns)) issues.push(`columns:index:${name}`)
  const where = contract.where ? ` WHERE ${contract.where}` : ''
  const expectedSql = `CREATE ${contract.unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${contract.table}(${contract.columns.join(', ')})${where}`
  if (normalizePreviewSql(objectSql(database, 'index', name)) !== normalizePreviewSql(expectedSql)) issues.push(`sql:index:${name}`)
  return issues
}

function previewUniqueConstraintIssues(database: DBAdapter): string[] {
  const issues: string[] = []
  for (const constraint of PREVIEW_CONTRACT_UNIQUE_CONSTRAINTS) {
    if (!tableExists(database, constraint.table)) continue
    const found = indexList(database, constraint.table)
      .filter((entry) => entry.unique === 1)
      .some((entry) => JSON.stringify(indexColumns(database, entry.name ?? '')) === JSON.stringify(constraint.columns))
    if (!found) issues.push(`unique:${constraint.table}:${constraint.columns.join(',')}`)
  }
  return issues
}

function foreignKeySignature(row: {
  table?: string
  from?: string
  to?: string
  on_update?: string
  on_delete?: string
  match?: string
}): string {
  return [row.table, row.from, row.to, row.on_update, row.on_delete, row.match].map((value) => String(value ?? '')).join('|')
}

function previewForeignKeyIssues(database: DBAdapter): string[] {
  const issues: string[] = []
  for (const table of PREVIEW_CONTRACT_TABLE_NAMES) {
    if (!tableExists(database, table)) continue
    const actual = (database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table?: string
      from?: string
      to?: string
      on_update?: string
      on_delete?: string
      match?: string
    }>).map(foreignKeySignature).sort()
    const expected = PREVIEW_CONTRACT_FOREIGN_KEYS
      .filter((contract) => contract.table === table)
      .map((contract) => foreignKeySignature({
        table: contract.toTable,
        from: contract.from,
        to: contract.to,
        on_update: contract.onUpdate,
        on_delete: contract.onDelete,
        match: contract.match
      }))
      .sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`foreign-key:${table}`)
  }
  return issues
}

function previewTriggerIssues(database: DBAdapter): string[] {
  const issues: string[] = []
  for (const trigger of PREVIEW_CONTRACT_TRIGGER_NAMES) {
    const sql = objectSql(database, 'trigger', trigger)
    if (!sql) {
      issues.push(`trigger:${trigger}`)
      continue
    }
    const normalized = normalizePreviewSql(sql)
    for (const marker of PREVIEW_CONTRACT_TRIGGER_MARKERS[trigger] ?? []) {
      if (!normalized.includes(normalizePreviewSql(marker))) issues.push(`trigger-sql:${trigger}:${normalizePreviewSql(marker)}`)
    }
  }
  return issues
}

function previewContractStructureParts(database: DBAdapter): string[] {
  const parts: string[] = []
  for (const table of PREVIEW_CONTRACT_TABLE_NAMES) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name?: string
      type?: string
      notnull?: number
      dflt_value?: unknown
      pk?: number
    }>
    parts.push(`table:${table}:${normalizePreviewSql(objectSql(database, 'table', table))}`)
    parts.push(`columns:${table}:${JSON.stringify(columns.map((column) => [
      column.name ?? null,
      column.type ?? null,
      column.notnull ?? null,
      column.dflt_value ?? null,
      column.pk ?? null
    ]))}`)
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table?: string
      from?: string
      to?: string
      on_update?: string
      on_delete?: string
      match?: string
    }>
    parts.push(`foreign-keys:${table}:${foreignKeys.map(foreignKeySignature).sort().join(',')}`)
  }
  for (const name of PREVIEW_CONTRACT_INDEX_NAMES) {
    const contract = PREVIEW_CONTRACT_INDEX_CONTRACTS[name]
    const row = indexList(database, contract.table).find((entry) => entry.name === name)
    parts.push(`index:${name}:${row?.unique ?? ''}:${row?.partial ?? ''}:${indexColumns(database, name).join(',')}:${normalizePreviewSql(objectSql(database, 'index', name))}`)
  }
  for (const name of PREVIEW_CONTRACT_TRIGGER_NAMES) {
    parts.push(`trigger:${name}:${normalizePreviewSql(objectSql(database, 'trigger', name))}`)
  }
  return parts
}

export function previewContractStructureDigest(database: DBAdapter): string {
  return createHash('sha256').update(previewContractStructureParts(database).join('\n')).digest('hex')
}

export function previewContractIntegrityIssues(database: DBAdapter): string[] {
  const foreignKeyIssues = database.prepare('PRAGMA foreign_key_check').all()
  const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  return [
    ...(foreignKeyIssues.length > 0 ? [`foreign-key-check:${foreignKeyIssues.length}`] : []),
    ...(integrity?.integrity_check !== 'ok' ? [`integrity-check:${integrity?.integrity_check ?? 'missing'}`] : [])
  ]
}

function hasLedger(database: DBAdapter, migrationId: string, schemaVersion: string): boolean {
  return Boolean(database.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id=? AND schema_version=?').get(migrationId, schemaVersion))
}

export function previewContractMigrationState(database: DBAdapter): PreviewContractMigrationState {
  if (!tableExists(database, 'preview_contract_registry')) return 'ABSENT'
  if (!hasLedger(database, PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_SCHEMA_VERSION)) return 'INSTALLING'
  if (!hasLedger(database, EVENT_BATCH_MIGRATION_ID, EVENT_BATCH_SCHEMA_VERSION)) return 'PARTIAL_OR_DRIFTED'
  if (inspectEventBatchStructure(database) !== 'CURRENT') return 'PARTIAL_OR_DRIFTED'
  const issues = inspectPreviewContractStructure(database)
  return issues.length === 0 ? 'CURRENT' : 'PARTIAL_OR_DRIFTED'
}

export function inspectPreviewContractStructure(database: DBAdapter): string[] {
  const issues: string[] = []
  for (const table of PREVIEW_CONTRACT_TABLE_NAMES) {
    if (!tableExists(database, table)) {
      issues.push(`table:${table}`)
      continue
    }
    issues.push(...previewColumnIssues(database, table))
    issues.push(...previewTableMarkerIssues(database, table))
  }
  const assessmentColumns = tableExists(database, 'assessment_session') ? columnNames(database, 'assessment_session') : new Set<string>()
  for (const column of ['session_contract_kind', 'preview_contract_version', 'preview_redline_ref']) {
    if (!assessmentColumns.has(column)) issues.push(`column:assessment_session.${column}`)
  }
  const assessmentSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessment_session'"
  ).get() as { sql?: string } | undefined
  const normalizedAssessmentSql = (assessmentSql?.sql ?? '').replace(/\s+/g, ' ').toLowerCase()
  for (const marker of [
    "session_contract_kind text not null default 'formal_shell'",
    "session_contract_kind = 'preview_shell'",
    'preview_redline_ref is not null',
    'level_result is null',
    'redline_incident_id is null'
  ]) {
    if (!normalizedAssessmentSql.includes(marker)) issues.push(`table-sql:assessment_session:${marker}`)
  }
  for (const index of PREVIEW_CONTRACT_INDEX_NAMES) issues.push(...previewIndexIssues(database, index))
  issues.push(...previewUniqueConstraintIssues(database))
  issues.push(...previewForeignKeyIssues(database))
  issues.push(...previewTriggerIssues(database))
  if (tableExists(database, 'preview_contract_registry')) {
    const row = database.prepare('SELECT contract_version, schema_version, migration_id, status FROM preview_contract_registry WHERE registry_id=?').get('PREVIEW_CONTRACT_V1') as { contract_version?: string; schema_version?: string; migration_id?: string; status?: string } | undefined
    if (!row) issues.push('registry:PREVIEW_CONTRACT_V1')
    else {
      if (row.contract_version !== PREVIEW_CONTRACT_VERSION) issues.push('registry:contract_version')
      if (row.schema_version !== PREVIEW_CONTRACT_SCHEMA_VERSION) issues.push('registry:schema_version')
      if (row.migration_id !== PREVIEW_CONTRACT_MIGRATION_ID) issues.push('registry:migration_id')
      if (!['INSTALLING', 'READY', 'DISABLED'].includes(row.status ?? '')) issues.push('registry:status')
    }
  }
  return issues
}

export function assertPreviewContractStructure(database: DBAdapter): void {
  const issues = inspectPreviewContractStructure(database)
  if (issues.length > 0) throw new PreviewContractMigrationError('PREVIEW_CONTRACT_SCHEMA_DRIFT', 'preview contract structure is incomplete or drifted', issues)
}

export function applyPreviewContractMigration(database: DBAdapter, options: {
  fresh?: boolean
  createVerifiedBackupBeforeDdl?: () => void
} = {}): { source: 'FRESH' | 'EXACT_M5B' | 'ALREADY_TARGET'; applied: boolean } {
  if (!tableExists(database, 'schema_migration')) throw new PreviewContractMigrationError('PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'base schema ledger is missing')
  if (!hasLedger(database, EVENT_BATCH_MIGRATION_ID, EVENT_BATCH_SCHEMA_VERSION)) {
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_LEDGER_DRIFT', 'M5B predecessor ledger is not current')
  }
  const state = previewContractMigrationState(database)
  if (state === 'CURRENT') return { source: 'ALREADY_TARGET', applied: false }
  if (state === 'PARTIAL_OR_DRIFTED') throw new PreviewContractMigrationError('PREVIEW_CONTRACT_SCHEMA_DRIFT', 'partial preview contract objects require verified rollback', inspectPreviewContractStructure(database))
  if (!options.fresh && !options.createVerifiedBackupBeforeDdl) {
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_BACKUP_REQUIRED', 'upgraded preview migration requires a verified DB/action-log pair')
  }
  if (!options.fresh) options.createVerifiedBackupBeforeDdl?.()
  const needsAssessmentRebuild = !options.fresh
    && tableExists(database, 'assessment_session')
    && !columnNames(database, 'assessment_session').has('session_contract_kind')
  const foreignKeysWereEnabled = needsAssessmentRebuild
    && Number((database.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined)?.foreign_keys ?? 1) === 1
  try {
    // SQLite cannot toggle foreign_keys while a transaction is active. Disable
    // it before the single migration transaction and restore it only after the
    // transaction has committed or rolled back.
    if (foreignKeysWereEnabled) database.exec('PRAGMA foreign_keys = OFF')
    const apply = database.transaction(() => {
      if (needsAssessmentRebuild) rebuildAssessmentSessionForPreview(database)
      for (const sql of PREVIEW_CONTRACT_COLUMN_SQL) {
        const table = 'assessment_session'
        const column = sql.match(/ADD COLUMN\s+([a-z_]+)/i)?.[1]
        if (!column || !columnNames(database, table).has(column)) database.exec(sql)
      }
      installPreviewAwareM4Triggers(database)
      database.exec(FORMAL_ONLY_TRIGGER_SQL)
      database.exec(PREVIEW_CONTRACT_SCHEMA_SQL)
      database.prepare(
        `INSERT OR IGNORE INTO schema_migration (migration_id, schema_version, description)
         VALUES (?, ?, ?)`
      ).run(PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_SCHEMA_VERSION, PREVIEW_CONTRACT_MIGRATION_DESCRIPTION)
    })
    apply()
    assertPreviewContractStructure(database)
    const integrityIssues = previewContractIntegrityIssues(database)
    if (integrityIssues.length > 0) {
      throw new PreviewContractMigrationError('PREVIEW_CONTRACT_INTEGRITY_FAILED', 'preview contract integrity checks failed', integrityIssues)
    }
    return { source: options.fresh ? 'FRESH' : 'EXACT_M5B', applied: true }
  } catch (error) {
    if (error instanceof PreviewContractMigrationError) throw error
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_RECOVERY_REQUIRED', 'preview contract migration failed and requires verified rollback', [], error)
  } finally {
    if (foreignKeysWereEnabled) database.exec('PRAGMA foreign_keys = ON')
  }
}

export function previewContractObjectDigest(): string {
  return PREVIEW_CONTRACT_OBJECT_DIGEST
}

/**
 * Promotes the installed schema only after the application-side registry has
 * supplied every digest.  Migration itself deliberately leaves this row in
 * INSTALLING so a partial binary cannot enable preview writes.
 */
export function promotePreviewContractReadyWithProvider(
  database: DBAdapter,
  readinessProvider: () => PreviewContractReadiness,
  installedAt: string
): void {
  const readiness = readinessProvider()
  if (readiness.registry_id !== 'PREVIEW_CONTRACT_V1' || readiness.contract_version !== PREVIEW_CONTRACT_VERSION || readiness.schema_version !== PREVIEW_CONTRACT_SCHEMA_VERSION || readiness.migration_id !== PREVIEW_CONTRACT_MIGRATION_ID || readiness.status !== 'READY') {
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_SCHEMA_DRIFT', 'preview readiness descriptor does not match the installed migration')
  }
  const migrationState = previewContractMigrationState(database)
  if (migrationState !== 'CURRENT') {
    throw new PreviewContractMigrationError(
      'PREVIEW_CONTRACT_MIGRATION_REQUIRED',
      `preview contract migration is not current: ${migrationState}`
    )
  }
  assertPreviewContractStructure(database)
  const integrityIssues = previewContractIntegrityIssues(database)
  if (integrityIssues.length > 0) {
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_INTEGRITY_FAILED', 'preview contract integrity checks failed', integrityIssues)
  }
  const row = database.prepare('SELECT status FROM preview_contract_registry WHERE registry_id = ?').get('PREVIEW_CONTRACT_V1') as { status?: string } | undefined
  if (!row || (row.status !== 'INSTALLING' && row.status !== 'READY')) {
    throw new PreviewContractMigrationError('PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'preview contract registry is not promotable')
  }
  database.transaction(() => {
    database.prepare(
      `UPDATE preview_contract_registry
          SET status = 'READY', event_registry_digest = ?, projection_digest = ?,
              query_digest = ?, recovery_digest = ?, error_map_digest = ?,
              installed_at = ?, updated_at = ?
        WHERE registry_id = ? AND status IN ('INSTALLING', 'READY')`
    ).run(
      readiness.event_registry_digest,
      readiness.projection_digest,
      readiness.query_digest,
      readiness.recovery_digest,
      readiness.error_map_digest,
      installedAt,
      installedAt,
      'PREVIEW_CONTRACT_V1'
    )
  })()
}

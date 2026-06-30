// 对应 doc/xc-career-guide-event-payload-schema-v1.0.0.md

export type AggregateType =
  | 'ASSESSMENT_SESSION'
  | 'TRAINING_SESSION'
  | 'SAFETY_INCIDENT'
  | 'TASK_REPORT'
  | 'SYSTEM'

export type ActorRole = 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM'

export type EventType =
  | 'SESSION_STARTED'
  | 'ANSWER_SUBMITTED'
  | 'EMOTION_INTERRUPTED'
  | 'EMOTION_RESUMED'
  | 'OFFLINE_SCORE_SUBMITTED'
  | 'REDLINE_TRIGGERED'
  | 'SESSION_COMPLETED'
  | 'SESSION_ABORTED'
  | 'TRAINING_STARTED'
  | 'TRAINING_STEP_STARTED'
  | 'TRAINING_STEP_COMPLETED'
  | 'TRAINING_STEP_SKIPPED'
  | 'TRAINING_STEP_FAILED'
  | 'TRAINING_COMPLETED'
  | 'RESULT_CALCULATED'
  | 'REPORT_GENERATED'
  | 'REPORT_EXPORTED'
  | 'REPORT_LOCKED'
  | 'SAFETY_INCIDENT_CREATED'
  | 'SAFETY_INCIDENT_DETAIL_CONFIRMED'
  | 'SAFETY_INCIDENT_RESOLVED'
  | 'SAFETY_INCIDENT_VOIDED'
  | 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
  | 'SNAPSHOT_COMMITTED'
  | 'RECOVERY_REPLAYED'
  | 'RECOVERY_LOG_TRUNCATED'

export interface ActionLogEntry {
  event_id: string
  aggregate_type: AggregateType
  aggregate_id: string
  event_type: EventType
  event_sequence: number
  payload: Record<string, unknown>
  checksum: string
  schema_version: number
  created_at: string
  actor_id: string
  actor_role: ActorRole
  app_version: string
  correlation_id?: string
}

// ---------------------------------------------------------------------------
// Payload 类型 — 每个事件对应一个 interface
// 详细字段说明见 doc/xc-career-guide-event-payload-schema-v1.0.0.md
// ---------------------------------------------------------------------------

export interface SessionStartedPayload {
  session_id: string
  student_id: string
  strategy_id: string
  strategy_type: 'BASELINE_ASSESSMENT' | 'MOCK_EXAM'
  strategy_version: number
  job_code: string
  task_code: string
  online_question_count: number
  offline_question_count: number
  question_ids: string[]
}

export type AnswerPayloadDetail =
  | { question_type: 'TRUE_FALSE'; selected: boolean }
  | { question_type: 'SINGLE_CHOICE'; selected: string }
  | { question_type: 'DRAG'; placements: { item_id: string; zone_id: string }[] }

export interface AnswerSubmittedPayload {
  session_id: string
  answer_id: string
  question_id: string
  question_type: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
  answer_payload: AnswerPayloadDetail
  is_correct: boolean
  score: 0 | 1 | 2
  question_order: number
  submitted_at: string
}

export interface EmotionInterruptedPayload {
  session_id: string
  interrupted_at: string
  current_question_order?: number | null
  reason?: string | null
}

export interface EmotionResumedPayload {
  session_id: string
  resumed_at: string
  resume_from_question_order?: number | null
}

export interface CriterionScore {
  criterion_id: string
  score: 0 | 1 | 2
}

export interface OfflineScoreSubmittedPayload {
  session_id: string
  offline_score_id: string
  question_id: string
  criterion_scores: CriterionScore[]
  total_score: number
  scored_by: string
  scored_at: string
}

export interface RedlineTriggeredPayload {
  session_id: string
  incident_id: string
  reason_code: string
  context_phase: string
  triggered_at: string
}

export interface SessionCompletedPayload {
  session_id: string
  completed_at: string
  total_online_answered: number
  total_offline_scored: number
  has_pending_offline: boolean
}

export interface SessionAbortedPayload {
  session_id: string
  aborted_at: string
  aborted_by: string
  reason?: string | null
}

export interface TrainingStartedPayload {
  training_session_id: string
  student_id: string
  strategy_id: string
  strategy_type: 'TRAINING_PRACTICE'
  strategy_version: number
  job_code: string
  task_code: string
  total_steps: number
  step_order: string[]
}

export interface TrainingStepPayload {
  training_session_id: string
  step_record_id: string
  step_type: 'WATCH' | 'LEARN' | 'PRACTICE' | 'DO'
  step_order: number
  started_at?: string
  completed_at?: string
  skipped_at?: string
  failed_at?: string
  duration_seconds?: number | null
  reason?: string | null
}

export interface TrainingCompletedPayload {
  training_session_id: string
  completed_at: string
  total_steps: number
  completed_steps: number
  skipped_steps: number
  failed_steps: number
  completion_rate: number
}

export interface ResultCalculatedPayload {
  result_id: string
  result_type: 'ABILITY_SCORE' | 'TRAINING_COMPLETION' | 'OPERATION_PASS_RATE'
  source_type: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION'
  source_id: string
  student_id: string
  job_code: string
  task_code: string
  raw_score?: number | null
  max_score?: number | null
  normalized_score: number
  level_result: string
  calculated_at: string
  calculated_by: string
}

export interface ReportGeneratedPayload {
  report_id: string
  student_id: string
  job_code: string
  task_code: string
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  result_ids: string[]
  incident_ids?: string[]
  generated_at: string
  generated_by: string
}

export interface ReportExportedPayload {
  report_id: string
  export_format: 'PDF' | 'HTML' | 'JSON'
  export_path: string
  exported_at: string
  exported_by: string
}

export interface ReportLockedPayload {
  report_id: string
  locked_at: string
  locked_by: string
  lock_reason?: string | null
}

export interface SafetyIncidentCreatedPayload {
  incident_id: string
  student_id: string
  job_code: string
  task_code: string
  reason_code: string
  context_phase: string
  occurred_at: string
  reported_by: string
  brief_description?: string | null
}

export interface SafetyIncidentDetailConfirmedPayload {
  incident_id: string
  confirmed_at: string
  confirmed_by: string
  full_description: string
}

export interface SafetyIncidentResolvedPayload {
  incident_id: string
  resolved_at: string
  resolved_by: string
  resolution_notes: string
  follow_up_required: boolean
}

export interface SafetyIncidentVoidedPayload {
  incident_id: string
  voided_at: string
  voided_by: string
  void_reason: 'FALSE_TRIGGER' | 'DUPLICATE_RECORD' | 'NON_SAFETY_EVENT' | 'FACTUAL_CORRECTION'
  void_notes?: string | null
}

export interface SafetyIncidentReplacedPayload {
  old_incident_id: string
  new_incident_id: string
  replaced_at: string
  replaced_by: string
  correction_reason: string
}

export interface SnapshotCommittedPayload {
  snapshot_id: string
  last_event_id: string
  last_event_sequence: number
  projection_timestamp: string
  event_count: number
}

export interface RecoveryReplayedPayload {
  recovery_session_id: string
  started_at: string
  completed_at: string
  total_events_replayed: number
  last_event_id: string
  consistency_check_passed: boolean
}

export interface RecoveryLogTruncatedPayload {
  truncated_at: string
  truncated_by: string
  archive_path: string
  archived_event_count: number
  retained_event_count: number
  oldest_retained_event_id: string
}

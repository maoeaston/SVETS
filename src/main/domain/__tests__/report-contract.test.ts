import { describe, expect, it } from 'vitest'
import {
  parseF7EventPayload,
  parseGenerateReportParams,
  parseReportContent,
  validateReportSourceResultIds
} from '../report-contract'
import { sha256CanonicalJson } from '../report-canonical'

const iso = '2026-07-25T10:00:00.000Z'
const hash = 'a'.repeat(64)

function baseSnapshots() {
  return [
    {
      result_id: 'ability-1',
      result_type: 'ABILITY_SCORE',
      source_aggregate_type: 'ASSESSMENT_SESSION',
      source_aggregate_id: 'assessment-1',
      generated_at: iso,
      strategy_id: 'strategy-base-1',
      strategy_type: 'BASELINE_ASSESSMENT',
      raw_score: 12,
      max_score: 20,
      normalized_score: 60,
      completion_ratio: 1,
      level_result: 'LEVEL_CONDITIONAL',
      safety_overridden: false,
      redline_incident_id: null,
      source_started_at: iso,
      source_completed_at: iso,
      details: {
        result_type: 'ABILITY_SCORE',
        module_scores: [{ module_type: 'COGNITION', raw_score: 2, max_score: 4, normalized_score: 50 }],
        online_raw_score: 8,
        offline_raw_score: 4,
        question_count: 10,
        answered_count: 10,
        completion_ratio: 1,
        emotion_collapse_count: 0,
        module_veto_triggered_by: null,
        level_forced_by: null
      }
    },
    {
      result_id: 'training-1',
      result_type: 'TRAINING_COMPLETION',
      source_aggregate_type: 'TRAINING_SESSION',
      source_aggregate_id: 'training-session-1',
      generated_at: iso,
      strategy_id: 'strategy-training-1',
      strategy_type: 'TRAINING_PRACTICE',
      raw_score: null,
      max_score: null,
      normalized_score: 100,
      completion_ratio: 1,
      level_result: 'LEVEL_COMPETENT',
      safety_overridden: false,
      redline_incident_id: null,
      source_started_at: iso,
      source_completed_at: iso,
      details: {
        total_steps: 4,
        completed_steps: 4,
        skipped_steps: 0,
        failed_steps: 0,
        completion_rate: 100,
        completed_at: iso
      }
    },
    {
      result_id: 'operation-1',
      result_type: 'OPERATION_PASS_RATE',
      source_aggregate_type: 'ASSESSMENT_SESSION',
      source_aggregate_id: 'assessment-1',
      generated_at: iso,
      strategy_id: 'strategy-base-1',
      strategy_type: 'BASELINE_ASSESSMENT',
      raw_score: 18,
      max_score: 18,
      normalized_score: 100,
      completion_ratio: 1,
      level_result: 'LEVEL_COMPETENT',
      safety_overridden: false,
      redline_incident_id: null,
      source_started_at: iso,
      source_completed_at: iso,
      details: {
        result_type: 'OPERATION_PASS_RATE',
        raw_score: 18,
        max_score: 18,
        total_items: 9,
        scored_at: iso,
        items: [
          'IDENTIFY_BOX',
          'CHECK_BOX_DAMAGE',
          'OPEN_PACKAGE_SAFELY',
          'TAKE_OUT_GOODS',
          'CHECK_GOODS_APPEARANCE',
          'IDENTIFY_SHELF_POSITION',
          'PLACE_BY_RULE',
          'TIDY_SHELF_FACE',
          'CONFIRM_COMPLETION'
        ].map((task_operation_code) => ({ task_operation_code, score: 2 }))
      }
    }
  ]
}

function baseReport(options: { pilot?: boolean; completionRatio?: number; placementEnabled?: boolean } = {}) {
  const snapshots = baseSnapshots()
  const pilot = options.pilot ?? false
  const completionRatio = options.completionRatio ?? 1
  const placementEnabled = options.placementEnabled ?? false
  const sourceMeta = {
    task_closure_id: 'closure-1',
    cycle_no: 1,
    closure_revision: 1,
    task_result_snapshots: snapshots
  }
  return {
    report_schema_version: 'task-report-v1.1',
    report_scope: 'BASE_ABILITY',
    report_type: 'FULL_REPORT',
    generated_at: iso,
    assessment_meta: {
      session_id: 'assessment-1',
      strategy_id: 'strategy-base-1',
      strategy_version: 1,
      question_bank_version: 1,
      import_batch_ids: ['base-batch-1'],
      asset_references: [{ asset_id: 'asset-1', file_hash: hash, content_pack_version: null }],
      scoring_engine_version: 'score-v1',
      content_schema_version: 'content-v1',
      scoring_schema_version: 'scoring-v1',
      sitting_count: 1,
      sittings: [{ sitting_no: 1, started_at: iso, ended_at: iso, duration_seconds: 30, end_reason: 'COMPLETED_NORMALLY' }],
      completion_ratio: completionRatio,
      termination_reason: null,
      pilot_mode: pilot,
      report_usage: pilot ? 'PILOT_ONLY' : 'FORMAL'
    },
    score_summary: {
      ability_score: {
        result_id: snapshots[0].result_id,
        raw_score: snapshots[0].raw_score,
        max_score: snapshots[0].max_score,
        normalized_score: snapshots[0].normalized_score,
        completion_ratio: snapshots[0].completion_ratio,
        level_result: snapshots[0].level_result
      },
      training_completion: {
        result_id: snapshots[1].result_id,
        raw_score: snapshots[1].raw_score,
        max_score: snapshots[1].max_score,
        normalized_score: snapshots[1].normalized_score,
        completion_ratio: snapshots[1].completion_ratio,
        level_result: snapshots[1].level_result
      },
      operation_pass_rate: {
        result_id: snapshots[2].result_id,
        raw_score: snapshots[2].raw_score,
        max_score: snapshots[2].max_score,
        normalized_score: snapshots[2].normalized_score,
        completion_ratio: snapshots[2].completion_ratio,
        level_result: snapshots[2].level_result
      }
    },
    module_profiles: snapshots[0].details.module_scores,
    training: { result_id: snapshots[1].result_id, ...snapshots[1].details },
    operation: { result_id: snapshots[2].result_id, ...snapshots[2].details },
    evidence_summary: { evidence_types: ['DIRECT_PERFORMANCE'], observations: [] },
    support_summary: { prompt_level_distribution: {}, accommodations_used: [], instruction_replay_count: 0 },
    administration_status: { status: 'COMPLETED', observation_completion_ratio: 1 },
    behavior_observations: [],
    validity_limitations: [],
    safety_summary: { safety_incidents: [], safety_overridden: false },
    placement_advice: placementEnabled
      ? { enabled: true, recommendation: { recommendation_code: 'REC-1', recommendation_text: 'Supported placement', conditions: [] }, reason_disabled: null }
      : { enabled: false, recommendation: null, reason_disabled: 'NOT_ELIGIBLE' },
    source_meta: {
      ...sourceMeta,
      source_set_hash: sha256CanonicalJson(sourceMeta)
    }
  }
}

function jobReport() {
  const profile = (code: string) => ({
    job_module_code: code,
    module_name: code,
    online_raw_score: 4,
    online_max_score: 6,
    offline_raw_score: 1,
    offline_max_score: 2,
    score_rate: 0.625,
    response_status_distribution: {},
    key_observations: []
  })
  const snapshot = {
    result_id: 'job-result-1',
    result_type: 'JOB_SKILL_SCORE',
    source_aggregate_type: 'ASSESSMENT_SESSION',
    source_aggregate_id: 'job-session-1',
    generated_at: iso,
    strategy_id: 'strategy-job-1',
    strategy_type: 'JOB_SKILL_ASSESSMENT',
    raw_score: 36,
    max_score: 48,
    normalized_score: 75,
    completion_ratio: 1,
    level_result: 'LEVEL_COMPETENT',
    safety_overridden: false,
    redline_incident_id: null,
    source_started_at: iso,
    source_completed_at: iso,
    details: {
      result_schema_version: 'job-skill-result-v1.0',
      overall: { raw_score: 36, max_score: 48, normalized_score: 75, completion_ratio: 1 },
      job_module_profiles: Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((code) => [code, {
        online_raw: 4,
        online_max: 6,
        offline_raw: 1,
        offline_max: 2,
        score_rate: 0.625,
        response_status_summary: {}
      }]))
    }
  }
  return {
    report_schema_version: 'job-skill-report-v1.0',
    report_scope: 'JOB_SKILL',
    report_type: 'FULL_REPORT',
    generated_at: iso,
    assessment_meta: {
      session_id: 'job-session-1', strategy_id: 'strategy-job-1', strategy_version: 1,
      scoring_engine_version: 'score-v1', content_schema_version: 'content-v1',
      scoring_schema_version: 'job-skill-result-v1.0', report_schema_version: 'job-skill-report-v1.0',
      job_code: 'SUPERMARKET_SHELVER', sitting_count: 1, completion_ratio: 1, observation_completion_ratio: 1
    },
    overall_summary: { raw_score: 36, max_score: 48, normalized_score: 75, level_result: 'LEVEL_COMPETENT', safety_overridden: false, emotion_collapse_triggered: false },
    job_module_profiles: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map(profile),
    support_summary: { prompt_level_distribution: {}, accommodations_used: [], instruction_replay_count: 0 },
    teacher_observations: [],
    safety_summary: { safety_incidents: [], safety_overridden: false },
    validity_limitations: [],
    recommended_training_focus: [],
    recommended_training_tasks: [],
    online_knowledge_summary: { raw_score: 24, max_score: 36, normalized_score: 66.7, response_status_distribution: {} },
    offline_performance_summary: { raw_score: 12, max_score: 12, normalized_score: 100, completed_item_count: 6, total_item_count: 6 },
    administration_summary: { report_usage: 'MVP_DEMO_PROFILE_ONLY', observation_completion_ratio: 1, completion_ratio: 1, sittings: [], termination_reason: null },
    source_meta: { result_snapshot: snapshot, question_bank_version: 1, import_batch_ids: ['job-batch-1'], asset_references: [] },
    placement_advice: { enabled: false, recommendation: null, reason_disabled: 'MVP_DEMO_PROFILE_ONLY' }
  }
}

function safetyReport() {
  return {
    report_schema_version: 'safety-termination-report-v1.0',
    report_scope: 'SAFETY',
    source_scope: 'NO_BOUND_SESSION',
    report_type: 'SAFETY_TERMINATION_REPORT',
    generated_at: iso,
    incident_snapshot: {
      incident_id: 'incident-1', student_id: 'student-1', job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
      status_at_generation: 'CONFIRMED', reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_ASSESSMENT',
      description: 'Safety stop', occurred_at: iso, triggered_by: 'teacher-1', confirmed_by: 'teacher-1', confirmed_at: iso
    },
    binding_snapshots: [],
    pre_redline_records: { result_ids: [], answer_summary: {}, offline_score_summary: {}, training_step_summary: {} },
    safety_summary: { level_result: 'LEVEL_FAIL_BY_SAFETY', ordinary_report_blocked: true },
    validity_limitations: [],
    correction_lineage: { root_incident_id: 'incident-1', replaces_incident_id: null, supersedes_report_id: null },
    source_meta: { metadata_availability: 'NO_BOUND_SESSION', binding_metadata: [] },
    placement_advice: { enabled: false, recommendation: null, reason_disabled: 'SAFETY_TERMINATION' }
  }
}

function trainingSafetyReport() {
  const report = safetyReport()
  return {
    ...report,
    source_scope: 'TRAINING',
    binding_snapshots: [
      {
        aggregate_type: 'TRAINING_SESSION',
        aggregate_id: 'training-session-1',
        pre_status: 'ACTIVE',
        post_status: 'REDLINE_HALTED'
      }
    ],
    source_meta: {
      metadata_availability: 'BY_BINDING',
      binding_metadata: [
        {
          aggregate_type: 'TRAINING_SESSION',
          aggregate_id: 'training-session-1',
          strategy_availability: 'NOT_CONFIGURED',
          strategy_id: null,
          strategy_version: null,
          asset_references: [],
          started_at: iso,
          completed_at: null,
          step_status_summary: {},
          pre_redline_steps: []
        }
      ]
    }
  }
}

describe('F7 report contracts', () => {
  it('accepts complete BASE, JOB_SKILL, and SAFETY report branches', () => {
    expect(parseReportContent(baseReport()).valid).toBe(true)
    expect(parseReportContent(jobReport()).valid).toBe(true)
    expect(parseReportContent(safetyReport()).valid).toBe(true)
  })

  it('requires BASE source IDs in fixed snapshot order', () => {
    const parsed = parseReportContent(baseReport())
    expect(parsed.valid).toBe(true)
    if (!parsed.valid) return
    expect(validateReportSourceResultIds(parsed.value, ['ability-1', 'training-1', 'operation-1']).valid).toBe(true)
    expect(validateReportSourceResultIds(parsed.value, ['training-1', 'ability-1', 'operation-1'])).toMatchObject({
      valid: false,
      errors: [{ code: 'MISMATCH', path: '$' }]
    })
  })

  it('rejects duplicate snapshots, mismatched hash, and presentation drift', () => {
    const duplicate = baseReport()
    duplicate.source_meta.task_result_snapshots[2].result_id = 'ability-1'
    expect(parseReportContent(duplicate)).toMatchObject({ valid: false })

    const badHash = baseReport()
    badHash.source_meta.source_set_hash = hash
    expect(parseReportContent(badHash)).toMatchObject({ valid: false, errors: expect.arrayContaining([{ code: 'MISMATCH', path: '$.source_meta.source_set_hash' }]) })

    const drift = baseReport()
    drift.score_summary.ability_score.normalized_score = 99
    expect(parseReportContent(drift)).toMatchObject({ valid: false, errors: expect.arrayContaining([{ code: 'MISMATCH', path: '$.score_summary.ability_score.normalized_score' }]) })
  })

  it('blocks placement advice for pilot and incomplete BASE reports and all JOB_SKILL reports', () => {
    expect(parseReportContent(baseReport({ pilot: true, placementEnabled: true }))).toMatchObject({ valid: false })
    expect(parseReportContent(baseReport({ completionRatio: 0.9, placementEnabled: true }))).toMatchObject({ valid: false })
    const job = jobReport()
    ;(job as { placement_advice: unknown }).placement_advice = {
      enabled: true,
      recommendation: { recommendation_code: 'REC', recommendation_text: 'x', conditions: [] },
      reason_disabled: null
    }
    expect(parseReportContent(job)).toMatchObject({ valid: false })
  })

  it('rejects fabricated safety metadata for NO_BOUND_SESSION', () => {
    const report = safetyReport()
    ;(report as { source_meta: unknown }).source_meta = {
      metadata_availability: 'NO_BOUND_SESSION',
      binding_metadata: [{ aggregate_type: 'TRAINING_SESSION', aggregate_id: 'training-1' }]
    }
    expect(parseReportContent(report)).toMatchObject({ valid: false })
  })

  it('accepts training-only safety metadata without assessment fields', () => {
    expect(parseReportContent(trainingSafetyReport()).valid).toBe(true)
  })

  it('accepts only one source field for reports:generate', () => {
    expect(parseGenerateReportParams({ callerUserId: 'teacher-1', callerRole: 'TEACHER', reportScope: 'BASE_ABILITY', taskClosureId: 'closure-1' }).valid).toBe(true)
    expect(parseGenerateReportParams({ callerUserId: 'teacher-1', callerRole: 'TEACHER', reportScope: 'JOB_SKILL', resultId: 'result-1', incidentId: 'incident-1' })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([{ code: 'EXTRA_FIELD', path: '$.incidentId' }])
    })
  })

  it('validates a schema v2 factual correction as a single complete event', () => {
    const payload = {
      root_incident_id: 'incident-root', old_incident_id: 'incident-old', new_incident_id: 'incident-new',
      student_id: 'student-1', job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
      reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_ASSESSMENT', full_description: 'Corrected fact',
      occurred_at: iso, triggered_by: 'teacher-1', confirmed_by: 'teacher-1', confirmed_at: iso,
      old_status: 'CONFIRMED', old_status_after: 'VOIDED', void_reason: 'FACTUAL_CORRECTION',
      correction_reason: 'Wrong context', replaced_by: 'teacher-1', replaced_at: iso, superseded_report_ids: ['report-old']
    }
    const result = parseF7EventPayload('SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', payload)
    expect(result.valid).toBe(true)
    expect(parseF7EventPayload('SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', {
      ...payload,
      old_status: 'RESOLVED'
    })).toMatchObject({ valid: false })
  })

  it('rejects F7 lifecycle combinations that a reducer cannot replay', () => {
    const exported = {
      report_id: 'report-1', export_format: 'HTML', export_path: '/tmp/report.html', exported_at: iso,
      exported_by: 'teacher-1', file_asset_id: 'asset-1', file_hash: hash, file_size_bytes: 1,
      mime_type: 'text/html', content_hash: hash
    }
    for (const [status_before, status_after] of [
      ['GENERATED', 'EXPORTED'], ['EXPORTED', 'EXPORTED'], ['LOCKED', 'LOCKED']
    ]) {
      expect(parseF7EventPayload('REPORT_EXPORTED', { ...exported, status_before, status_after }).valid).toBe(true)
    }
    for (const [status_before, status_after] of [
      ['GENERATED', 'LOCKED'], ['EXPORTED', 'LOCKED'], ['LOCKED', 'EXPORTED']
    ]) {
      expect(parseF7EventPayload('REPORT_EXPORTED', { ...exported, status_before, status_after }).valid).toBe(false)
    }
    expect(parseF7EventPayload('SAFETY_INCIDENT_VOIDED', {
      incident_id: 'incident-1', voided_at: iso, voided_by: 'admin-1', void_reason: 'FACTUAL_CORRECTION',
      void_notes: null, replacement_incident_id: null, archived_report_ids: [], superseded_report_ids: [], primary_incident_id: null
    }).valid).toBe(false)
  })

  it('validates REPORT_GENERATED against its frozen BASE snapshot', () => {
    const report = baseReport()
    const result = parseF7EventPayload('REPORT_GENERATED', {
      report_id: 'report-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK',
      report_type: 'FULL_REPORT',
      report_scope: 'BASE_ABILITY',
      source_aggregate_type: 'ASSESSMENT_SESSION',
      source_aggregate_id: 'assessment-1',
      result_ids: ['ability-1', 'training-1', 'operation-1'],
      incident_ids: [],
      report_title: 'Base report',
      report_content: report,
      generated_at: iso,
      generated_by: 'teacher-1',
      report_revision: 1,
      report_schema_version: 'task-report-v1.1',
      report_builder_version: 'f7-v1',
      lineage_key: hash,
      source_set_hash: report.source_meta.source_set_hash,
      content_hash: sha256CanonicalJson(report),
      generation_key: hash,
      generation_reason: 'NORMAL',
      task_closure_id: 'closure-1',
      repair_of_report_id: null,
      superseded_report_ids: []
    })
    expect(result.valid).toBe(true)
  })
})

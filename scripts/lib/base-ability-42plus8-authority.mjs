import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertWorkbookMatchesSql,
  loadBaseAbilityCandidates,
  fileSha256,
  MODULE_TYPES
} from './base-ability-42plus8-source.mjs'

const AUTHORITY_PATH = 'doc/features/base-ability-42plus8-authority-v1.json'
const INPUT_PATH = 'doc/features/base-ability-42plus8-contract-input-v1.json'
const SOURCE_PATH = 'doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx'
const IMPORT_SQL_PATH = 'doc/features/question-bank-import-base-ability-v02.sql'
const SCHEMA_PATH = './base-ability-42plus8-authority-v1.schema.json'
const AUTHORITY_VERSION = 'base-ability-42plus8-authority-v1'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

export function hashRecord(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function fileReference(projectRoot, relativePath) {
  return { path: relativePath, sha256: fileSha256(projectRoot, relativePath) }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`[base-ability-authority] ${label} must be non-empty`)
  return value.trim()
}

function uniqueTerms(value, fallback) {
  const terms = String(value ?? '')
    .split(/[；;、，,。]/u)
    .map((term) => term.trim())
    .filter(Boolean)
  return [...new Set(terms)].slice(0, 3).length > 0 ? [...new Set(terms)].slice(0, 3) : [fallback]
}

function presentationType(raw) {
  if (raw.presentation_way === '实物操作') return 'OFFLINE_MATERIAL'
  if (raw.presentation_way.includes('音频')) return 'AUDIO_PROMPT'
  if (raw.presentation_way === '屏幕图片') return 'IMAGE_CARD'
  return 'INTERACTIVE_SCENE'
}

function evidenceType(raw, questionType) {
  if (questionType === 'OFFLINE_OPERATION') return 'DIRECT_PERFORMANCE'
  if (raw.evidence_type.includes('自我')) return 'SELF_REPORT_PLUS_BEHAVIOR'
  if (raw.evidence_type.includes('情境')) return 'SITUATIONAL_JUDGMENT'
  return 'SOFTWARE_BEHAVIOR'
}

function responseShape(interactionType) {
  const shapes = {
    SINGLE_SELECT: '{ selected_option_id: string }',
    DRAG_DROP: '{ placements: [{ item_id, zone_id }] }',
    ORDERING: '{ ordered_item_ids: string[] }',
    GESTURE_TASK: '{ outcome, metrics }',
    TIMED_TASK: '{ actions, metrics, final_state }',
    TASK_SEQUENCE: '{ completed_steps, step_order, metrics }',
    BRANCHING_TASK: '{ path, messages, final_state }',
    OFFLINE_RUBRIC: '教师按审核通过的线下 rubric 提交 0/1/2 分'
  }
  return shapes[interactionType]
}

function requiredReviewTracks(row) {
  const tracks = ['CONTENT_AND_MEASUREMENT']
  if (row.question_type === 'OFFLINE_OPERATION' || row.safety_sensitive === 1) {
    tracks.push('SAFETY_REHABILITATION', 'SPECIAL_EDUCATION_ACCESSIBILITY')
  }
  return tracks
}

function baseContent(row, selection) {
  const raw = row.raw
  return {
    schema_version: 'question-content-v1.2',
    question_type: row.question_type,
    prompt: raw.prompt,
    assessment_point: raw.target_construct,
    ability_tags: [row.module_type],
    sub_module: raw.sub_dimension,
    target_construct: raw.target_construct,
    presentation: {
      presentation_type: presentationType(raw),
      prompt: raw.prompt,
      standard_instruction: raw.standard_instruction,
      instruction_repeat_limit: 1,
      assets: []
    },
    expected_evidence: {
      primary_evidence_type: evidenceType(raw, row.question_type),
      observable_indicators: uniqueTerms(raw.scoring_points, raw.target_construct),
      validity_boundary: raw.validity_boundary
    },
    support_policy: {
      allowed_prompt_levels: ['P0', 'P1'],
      max_prompt_level_for_valid_score: 'P1',
      allowed_accommodations: [],
      prohibited_support: ['不得提示关键答案', '不得替代受测者完成操作'],
      source_support_text: raw.allowed_support
    },
    termination_policy: {
      allow_pause_on_distress: true,
      technical_failure_is_not_zero: true,
      safety_stop_codes: ['DISTRESS_OR_RISK_REVIEW_REQUIRED'],
      source_termination_text: raw.termination_condition
    },
    log_metrics: uniqueTerms(raw.system_log_indicators, 'task_completed'),
    professional_review: {
      required: requiredReviewTracks(row).length > 1,
      review_type: requiredReviewTracks(row).join('+'),
      status: 'PENDING',
      reviewed_by: null,
      reviewed_at: null
    },
    review: {
      answer_key_status: 'PENDING',
      answer_key_reviewed_by: null,
      answer_key_reviewed_at: null,
      answer_key_review_note: null
    },
    source: {
      ...row.source,
      source_sha256: selection.source_sha256,
      digitalization_level: raw.digitalization_level,
      candidate_status: raw.candidate_status,
      source_notes: raw.notes
    }
  }
}

function buildAutomaticContract(row, selection, sourceBinding) {
  const raw = row.raw
  const content = baseContent(row, { source_sha256: sourceBinding.source_sha256 })
  const evidence = uniqueTerms(raw.correct_response, raw.target_construct)

  if (selection.scoring_type === 'EXACT_MATCH') {
    content.interaction = {
      interaction_type: 'SINGLE_SELECT',
      config: {
        option_ids: ['approved_action', 'continue_without_check', 'no_action'],
        response_shape: responseShape('SINGLE_SELECT')
      }
    }
    content.options = [
      { key: 'approved_action', text: '按题目要求采取合适的安全或任务处理。' },
      { key: 'continue_without_check', text: '不确认要求，直接继续当前操作。' },
      { key: 'no_action', text: '不处理，也不报告。' }
    ]
    return {
      content_json: content,
      scoring_rule_json: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'EXACT_MATCH',
        scoring_mode: 'AUTOMATIC',
        expected_answer: 'approved_action',
        expected_response_evidence: evidence,
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: 'base-ability-draft-v1'
      }
    }
  }

  if (selection.scoring_type === 'MAPPING_MATCH') {
    const items = evidence.slice(0, 2).map((label, index) => ({ item_id: `evidence_${index + 1}`, label }))
    content.interaction = {
      interaction_type: 'DRAG_DROP',
      config: {
        response_shape: responseShape('DRAG_DROP'),
        scoring_contract_state: 'PENDING_PROFESSIONAL_REVIEW'
      }
    }
    content.drag_items = items
    content.drop_zones = [{ zone_id: 'approved_response_zone', label: '符合题目要求的处理', accepts: items.map((item) => item.item_id) }]
    return {
      content_json: content,
      scoring_rule_json: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'MAPPING_MATCH',
        scoring_mode: 'AUTOMATIC',
        expected_mapping: items.map((item) => ({ item_id: item.item_id, zone_id: 'approved_response_zone' })),
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: 'base-ability-draft-v1'
      }
    }
  }

  if (selection.scoring_type === 'ORDER_MATCH') {
    const items = uniqueTerms(raw.correct_response, raw.target_construct).map((label, index) => ({ item_id: `step_${index + 1}`, label }))
    if (items.length < 2) items.push({ item_id: 'step_2', label: '完成后进行复核' })
    content.interaction = {
      interaction_type: 'ORDERING',
      config: { response_shape: responseShape('ORDERING'), scoring_contract_state: 'PENDING_PROFESSIONAL_REVIEW' }
    }
    content.drag_items = items
    content.drop_zones = [{ zone_id: 'sequence', label: '操作顺序', accepts: items.map((item) => item.item_id) }]
    return {
      content_json: content,
      scoring_rule_json: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'ORDER_MATCH',
        scoring_mode: 'AUTOMATIC',
        expected_order: items.map((item) => item.item_id),
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: 'base-ability-draft-v1'
      }
    }
  }

  if (selection.scoring_type === 'METRIC_THRESHOLD') {
    content.interaction = {
      interaction_type: selection.interaction_type,
      config: { response_shape: responseShape(selection.interaction_type), scoring_contract_state: 'PENDING_PROFESSIONAL_REVIEW' }
    }
    return {
      content_json: content,
      scoring_rule_json: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'METRIC_THRESHOLD',
        scoring_mode: 'AUTOMATIC',
        criteria_logic: 'ALL',
        criteria: [{ metric: 'candidate_task_outcome', operator: 'EQ', value: 'PASS' }],
        source_expected_response_evidence: evidence,
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: 'base-ability-draft-v1'
      }
    }
  }

  if (selection.scoring_type === 'EVENT_RULE') {
    const requiredEvents = uniqueTerms(raw.scoring_points, 'task_completed')
      .map((_, index) => `candidate_step_${index + 1}`)
    content.interaction = {
      interaction_type: selection.interaction_type,
      config: {
        response_shape: responseShape(selection.interaction_type),
        required_event_ids: requiredEvents,
        scoring_contract_state: 'PENDING_PROFESSIONAL_REVIEW'
      }
    }
    return {
      content_json: content,
      scoring_rule_json: {
        schema_version: 'scoring-rule-v1.1',
        scoring_type: 'EVENT_RULE',
        scoring_mode: 'AUTOMATIC',
        required_events: requiredEvents,
        required_order: true,
        required_final_state: 'COMPLETED',
        source_expected_response_evidence: evidence,
        pass_score: 2,
        fail_score: 0,
        scoring_engine_version: 'base-ability-draft-v1'
      }
    }
  }

  throw new Error(`[base-ability-authority] unsupported automatic scoring type ${selection.scoring_type}`)
}

function buildOfflineContract(row, selection, sourceBinding) {
  const content = baseContent(row, { source_sha256: sourceBinding.source_sha256 })
  const rubric = selection.offline_rubric
  if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new Error(`[base-ability-authority] ${row.question_id} requires an item-specific offline rubric`)
  }
  content.interaction = { interaction_type: 'OFFLINE_RUBRIC', config: { response_shape: responseShape('OFFLINE_RUBRIC') } }
  content.offline_tool_brief = row.raw.materials
  content.offline_setup = { setup_id: rubric.setup_id, item_ids: rubric.item_ids, asset_ids: [] }
  content.rubric_criteria = rubric.criteria.map((criterion) => ({
    criterion_id: criterion.criterion_id,
    description: `${criterion.description_0} / ${criterion.description_1} / ${criterion.description_2}`
  }))
  return {
    content_json: content,
    scoring_rule_json: {
      schema_version: 'scoring-rule-v1.1',
      scoring_type: 'OFFLINE_RUBRIC',
      scoring_mode: 'TEACHER',
      max_score: 2,
      criteria: rubric.criteria,
      score_labels: { '0': '未达到可观察标准', '1': '部分达到或需标准支持', '2': '达到可观察标准' },
      scoring_engine_version: 'base-ability-draft-v1'
    }
  }
}

function deferredReason(row) {
  if (row.item_usage === 'OBSERVATION_ONLY') return 'OBSERVATION_ONLY 观察项不计入 42+8 计分集合。'
  if (row.question_type === 'OFFLINE_OPERATION') return '本版本保留全部 8 道线下题；若此处出现，说明输入清单错误。'
  return '当前版本已固定本模块 7 道线上 DRAFT 候选；本题保留为后续经专业复审后方可替换的候选，不删除也不激活。'
}

function readInput(projectRoot) {
  const inputPath = join(projectRoot, INPUT_PATH)
  if (!existsSync(inputPath)) throw new Error(`[base-ability-authority] missing structured input: ${INPUT_PATH}`)
  return JSON.parse(readFileSync(inputPath, 'utf8'))
}

function assertInput(input, projectRoot) {
  if (input.schema_version !== 'base-ability-42plus8-contract-input-v1') {
    throw new Error('[base-ability-authority] structured input schema version is invalid')
  }
  if (!Array.isArray(input.selected_question_contracts)) {
    throw new Error('[base-ability-authority] selected_question_contracts must be an array')
  }
  if (input.source_bindings?.source_sha256 !== fileSha256(projectRoot, SOURCE_PATH)) {
    throw new Error('[base-ability-authority] source workbook hash drifted from structured input')
  }
  if (input.source_bindings?.import_sql_sha256 !== fileSha256(projectRoot, IMPORT_SQL_PATH)) {
    throw new Error('[base-ability-authority] import SQL hash drifted from structured input')
  }
  const seen = new Set()
  for (const selection of input.selected_question_contracts) {
    requireText(selection.question_id, 'selected question ID')
    requireText(selection.selection_reason, `${selection.question_id}.selection_reason`)
    requireText(selection.renderer_key, `${selection.question_id}.renderer_key`)
    requireText(selection.interaction_type, `${selection.question_id}.interaction_type`)
    requireText(selection.scoring_type, `${selection.question_id}.scoring_type`)
    if (seen.has(selection.question_id)) throw new Error(`[base-ability-authority] duplicate selected question: ${selection.question_id}`)
    seen.add(selection.question_id)
  }
}

function buildQuestionRecord(row, selection, sourceBinding) {
  const sourceRecord = {
    question_id: row.question_id,
    job_code: row.job_code,
    bank_domain: row.bank_domain,
    module_type: row.module_type,
    job_module_code: row.job_module_code,
    question_type: row.question_type,
    item_usage: row.item_usage,
    difficulty_level: row.difficulty_level,
    safety_sensitive: row.safety_sensitive,
    status: row.status,
    version: row.version,
    source: row.source,
    raw: row.raw
  }
  const base = {
    source_question_id: row.question_id,
    source_record_hash: hashRecord(sourceRecord),
    bank_domain: row.bank_domain,
    job_code: row.job_code,
    module_type: row.module_type,
    question_type: row.question_type,
    item_usage: row.item_usage,
    runtime_status: 'DRAFT',
    activation_authority: 'NONE',
    source: row.source
  }
  if (!selection) {
    return {
      ...base,
      selection: { disposition: 'DEFERRED', reason: deferredReason(row) }
    }
  }

  const contract = selection.scoring_type === 'OFFLINE_RUBRIC'
    ? buildOfflineContract(row, selection, sourceBinding)
    : buildAutomaticContract(row, selection, sourceBinding)
  const rendererRequirement = {
    renderer_key: selection.renderer_key,
    interaction_type: selection.interaction_type,
    response_shape: responseShape(selection.interaction_type),
    implementation_status: 'PENDING_IMPLEMENTATION',
    required_before_session_start: true
  }
  return {
    ...base,
    selection: { disposition: 'SELECTED', reason: selection.selection_reason },
    contract_state: 'DRAFT_PENDING_PROFESSIONAL_REVIEW',
    required_review_tracks: requiredReviewTracks(row),
    content_json: contract.content_json,
    scoring_rule_json: contract.scoring_rule_json,
    renderer_requirement: rendererRequirement,
    content_hash: hashRecord(contract.content_json),
    scoring_hash: hashRecord(contract.scoring_rule_json),
    renderer_requirement_hash: hashRecord(rendererRequirement)
  }
}

function selectedSummary(questions) {
  const selected = questions.filter((question) => question.selection.disposition === 'SELECTED')
  const online = selected.filter((question) => question.question_type !== 'OFFLINE_OPERATION')
  const offline = selected.filter((question) => question.question_type === 'OFFLINE_OPERATION')
  return {
    selected,
    summary: {
      source_total: questions.length,
      selected_total: selected.length,
      selected_online_total: online.length,
      selected_offline_total: offline.length,
      deferred_total: questions.length - selected.length,
      observation_selected_total: selected.filter((question) => question.item_usage === 'OBSERVATION_ONLY').length,
      job_specific_selected_total: selected.filter((question) => question.bank_domain === 'JOB_SPECIFIC').length,
      active_total: questions.filter((question) => question.runtime_status === 'ACTIVE').length,
      draft_total: questions.filter((question) => question.runtime_status === 'DRAFT').length,
      online_by_module: Object.fromEntries(MODULE_TYPES.map((moduleType) => [
        moduleType,
        online.filter((question) => question.module_type === moduleType).length
      ]))
    }
  }
}

function withoutAuthorityHash(document) {
  const { authority_hash: _authorityHash, ...body } = document
  return body
}

export function validateBaseAbilityAuthority(document) {
  if (document?.$schema !== SCHEMA_PATH || document.schema_version !== AUTHORITY_VERSION) {
    throw new Error('[base-ability-authority] authority schema metadata is invalid')
  }
  if (document.status !== 'DRAFT_FROZEN_PENDING_PROFESSIONAL_REVIEW') {
    throw new Error('[base-ability-authority] authority must remain DRAFT pending professional review')
  }
  if (document.boundaries?.runtime_database_write_allowed !== false || document.boundaries?.activation_authority_granted !== false) {
    throw new Error('[base-ability-authority] authority must not permit runtime writes or activation')
  }
  if (!Array.isArray(document.questions) || document.questions.length !== 96) {
    throw new Error('[base-ability-authority] authority must cover exactly 96 source questions')
  }
  const questionIds = document.questions.map((question) => question.source_question_id)
  if (new Set(questionIds).size !== questionIds.length) throw new Error('[base-ability-authority] authority question IDs must be unique')
  const { selected, summary } = selectedSummary(document.questions)
  if (summary.selected_total !== 50 || summary.selected_online_total !== 42 || summary.selected_offline_total !== 8 || summary.deferred_total !== 46) {
    throw new Error('[base-ability-authority] authority must reconcile 96=50+46 and 42+8')
  }
  if (summary.observation_selected_total !== 0 || summary.job_specific_selected_total !== 0 || summary.active_total !== 0 || summary.draft_total !== 96) {
    throw new Error('[base-ability-authority] authority violates DRAFT, observation, or domain boundary')
  }
  for (const moduleType of MODULE_TYPES) {
    if (summary.online_by_module[moduleType] !== 7) {
      throw new Error(`[base-ability-authority] ${moduleType} must have exactly seven selected online questions`)
    }
  }
  for (const question of document.questions) {
    if (question.runtime_status !== 'DRAFT' || question.activation_authority !== 'NONE') {
      throw new Error(`[base-ability-authority] ${question.source_question_id} is not fail-closed`)
    }
    if (question.selection?.disposition === 'DEFERRED') {
      requireText(question.selection.reason, `${question.source_question_id}.deferred reason`)
      if (question.content_json || question.scoring_rule_json || question.renderer_requirement) {
        throw new Error(`[base-ability-authority] deferred question ${question.source_question_id} must not carry a selected contract`)
      }
      continue
    }
    if (question.selection?.disposition !== 'SELECTED') {
      throw new Error(`[base-ability-authority] ${question.source_question_id} has an invalid disposition`)
    }
    requireText(question.selection.reason, `${question.source_question_id}.selection reason`)
    if (question.item_usage !== 'SCORED_ITEM') throw new Error(`[base-ability-authority] ${question.source_question_id} selects an observation item`)
    if (!question.content_json?.presentation || !question.content_json?.interaction || !question.content_json?.expected_evidence || !question.content_json?.support_policy || !question.content_json?.termination_policy) {
      throw new Error(`[base-ability-authority] ${question.source_question_id} lacks a full question-content-v1.2 contract`)
    }
    if (!question.scoring_rule_json || !question.renderer_requirement) {
      throw new Error(`[base-ability-authority] ${question.source_question_id} lacks scoring or renderer requirements`)
    }
    if (question.content_hash !== hashRecord(question.content_json)
      || question.scoring_hash !== hashRecord(question.scoring_rule_json)
      || question.renderer_requirement_hash !== hashRecord(question.renderer_requirement)) {
      throw new Error(`[base-ability-authority] ${question.source_question_id} contract hash drifted`)
    }
    if (question.content_json.review?.answer_key_status !== 'PENDING') {
      throw new Error(`[base-ability-authority] ${question.source_question_id} may not self-report an answer-key review`)
    }
    if (question.question_type === 'OFFLINE_OPERATION' && question.scoring_rule_json.scoring_type !== 'OFFLINE_RUBRIC') {
      throw new Error(`[base-ability-authority] ${question.source_question_id} must use OFFLINE_RUBRIC`)
    }
  }
  if (document.summary.source_total !== 96 || document.summary.selected_total !== 50 || document.summary.selected_online_total !== 42 || document.summary.selected_offline_total !== 8) {
    throw new Error('[base-ability-authority] published summary is inconsistent')
  }
  const expectedAuthorityHash = hashRecord(withoutAuthorityHash(document))
  if (document.authority_hash !== expectedAuthorityHash) throw new Error('[base-ability-authority] authority hash drifted')
  return true
}

export async function buildBaseAbilityAuthority(projectRoot) {
  const input = readInput(projectRoot)
  assertInput(input, projectRoot)
  await assertWorkbookMatchesSql(projectRoot)
  const candidateRows = await loadBaseAbilityCandidates(projectRoot)
  const sourceBinding = input.source_bindings
  const selectedById = new Map(input.selected_question_contracts.map((selection) => [selection.question_id, selection]))
  const sourceById = new Map(candidateRows.map((row) => [row.question_id, row]))
  for (const questionId of selectedById.keys()) {
    if (!sourceById.has(questionId)) throw new Error(`[base-ability-authority] selected question not found in workbook: ${questionId}`)
  }

  const questions = candidateRows.map((row) => buildQuestionRecord(row, selectedById.get(row.question_id), sourceBinding))
  const { selected, summary } = selectedSummary(questions)
  const document = {
    $schema: SCHEMA_PATH,
    schema_version: AUTHORITY_VERSION,
    authority_id: AUTHORITY_VERSION,
    status: 'DRAFT_FROZEN_PENDING_PROFESSIONAL_REVIEW',
    generated_at: input.generated_at,
    generator: {
      script: 'scripts/build-base-ability-42plus8-authority.mjs',
      version: '1',
      runtime_database_write: false
    },
    source_files: {
      workbook: fileReference(projectRoot, SOURCE_PATH),
      import_sql: fileReference(projectRoot, IMPORT_SQL_PATH),
      derivation: 'import_sql 是 seed-base-ability-v02.mjs 读取同名 xlsx 的确定性派生产物；本权威构建会先逐字段核验 workbook↔SQL，再按 import_sql 复算候选并绑定两文件 sha256。'
    },
    structured_input: fileReference(projectRoot, INPUT_PATH),
    selection: {
      status: 'MACHINE_PRESELECTED_PENDING_PROFESSIONAL_REVIEW',
      policy: input.selection_policy
    },
    boundaries: {
      runtime_database_write_allowed: false,
      activation_authority_granted: false,
      activation_sql_generated: false,
      professional_review_completed: false
    },
    summary,
    content_root_hash: hashRecord(selected.map((question) => ({ question_id: question.source_question_id, content_hash: question.content_hash }))),
    scoring_root_hash: hashRecord(selected.map((question) => ({ question_id: question.source_question_id, scoring_hash: question.scoring_hash }))),
    renderer_requirements_root_hash: hashRecord(selected.map((question) => ({ question_id: question.source_question_id, renderer_requirement_hash: question.renderer_requirement_hash }))),
    release_gate: {
      status: 'BLOCKED',
      blockers: [
        { code: 'PROFESSIONAL_REVIEW_PENDING', count: 50, message: '50 道 DRAFT 候选尚未取得必需的内容或专业审核原件。' },
        { code: 'RENDERER_IMPLEMENTATION_PENDING', count: 42, message: '42 道线上题的 renderer requirement 尚未实现和验收。' },
        { code: 'ACTIVATION_AUTHORITY_NOT_GRANTED', count: 50, message: '本权威不授予题目激活权限。' }
      ]
    },
    questions
  }
  document.authority_hash = hashRecord(withoutAuthorityHash(document))
  validateBaseAbilityAuthority(document)
  return document
}

export function serializeBaseAbilityAuthority(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

export async function writeOrCheckBaseAbilityAuthority(projectRoot, { check = false } = {}) {
  const outputPath = join(projectRoot, AUTHORITY_PATH)
  const document = await buildBaseAbilityAuthority(projectRoot)
  const content = serializeBaseAbilityAuthority(document)
  if (check) {
    return { ok: existsSync(outputPath) && readFileSync(outputPath, 'utf8') === content, outputPath, document }
  }
  writeFileSync(outputPath, content, 'utf8')
  return { ok: true, outputPath, document }
}

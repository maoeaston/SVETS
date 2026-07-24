import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { mapImportRow } from './question-bank-import.mjs'
import { expectedAnswer, loadRetainedQuestions } from './job-skill-delivery-contract.mjs'

const REQUIRED_GATE_NAMES = ['technical', 'visual', 'vocational', 'special_education', 'assessment']
const LIFECYCLE_VALUES = new Set(['planned', 'generated', 'composited', 'reviewing', 'approved', 'retired'])
const CATEGORY_VALUES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DELIVERY', 'REFERENCE'])
const PRIORITY_VALUES = new Set(['P0', 'P1', 'P2', 'REFERENCE'])
const ASSET_TYPE_VALUES = new Set([
  'product_photo', 'scene', 'damaged', 'icon_svg', 'aac_svg', 'emotion_svg', 'character',
  'video', 'bg', 'step_illustration', 'avatar', 'app_icon', 'reference', 'software_task',
  'tool_card', 'process_strip', 'answer_image', 'role_play_script', 'audio',
  'offline_setup_guide', 'sealed_config'
])
const ASSET_ROLE_VALUES = new Set([
  'QUESTION_MEDIA', 'UI_ASSET', 'TOOL_CHECKLIST', 'ROLE_PLAY_SCRIPT',
  'SEALED_ADMIN_CONFIG', 'OFFLINE_SETUP_GUIDE', 'OTHER'
])
const USAGE_MODE_VALUES = new Set(['training', 'assessment', 'both', 'system', 'production'])
const DELIVERY_FORMAT_VALUES = new Set(['png', 'webp', 'svg', 'css', 'mp4', 'mp3', 'json', 'pdf'])
const PRODUCTION_METHOD_VALUES = new Set(['ai_direct', 'ai_plus_overlay', 'programmatic', 'composite', 'authored'])
const REVIEW_LEVEL_VALUES = new Set(['standard', 'assessment_critical', 'safety_critical'])
const GATE_STATUS_VALUES = new Set(['pending', 'passed', 'rejected', 'waived', 'revision_required'])
const REVIEWER_KIND_VALUES = new Set(['human', 'script', 'ai_advisory'])
const IMAGE_FALLBACK_REASONS = ['primary_unavailable', 'manual_override']
const IMAGE_PARAM_KEYS = new Set(['size', 'resolution', 'n'])
const VIDEO_PARAM_KEYS = new Set(['size', 'resolution', 'duration', 'generate_audio'])
const EXPECTED_COUNTS = { A: 68, B: 14, C: 32, D: 11, E: 30, F: 52, G: 24, DELIVERY: 33, REFERENCE: 6 }
const ASSET_MANIFEST_VERSION = '0.5.0'
const ASSET_PLAN_VERSION = 'v1.3.0-298-runtime-authority+delivery-lock-v1'
const QUESTION_AUTHORITY_FIELDS = new Set([
  'job_skill_runtime_authority_path',
  'job_skill_runtime_status',
  'job_skill_question_total',
  'phase4_gate_path',
  'phase4_gate_status',
  'delivery_lock_path',
  'offline_toolkit_manifest_path',
  'offline_toolkit_status',
  'binding_policy',
  'activation_policy'
])
const MIME_BY_FORMAT = {
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  css: 'text/css',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  json: 'application/json',
  pdf: 'application/pdf'
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '' || isAbsolute(value)) return false
  const normalized = normalize(value).replace(/\\/g, '/')
  return normalized !== '..' && !normalized.startsWith('../')
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sourceQuestionId(questionId) {
  return typeof questionId === 'string' ? questionId.replace(/_V\d+$/, '') : questionId
}

function loadQuestionContracts(projectRoot) {
  const sourceContracts = new Map()
  const currentContracts = new Map()
  const sourceToCurrent = new Map()
  const jobSourcePath = join(
    projectRoot,
    'doc',
    'reference',
    '专业岗位能力测评题库-M1-M6-数据库导出-298条.json'
  )
  const rawRows = JSON.parse(readFileSync(jobSourcePath, 'utf8'))
  for (const rawRow of rawRows) {
    const row = mapImportRow(rawRow)
    sourceContracts.set(row.question_id, {
      questionType: row.question_type,
      expectedAnswer: row.scoring_rule_json.correct_answer ?? null
    })
  }

  const { retained } = loadRetainedQuestions(projectRoot)
  for (const question of retained) {
    sourceContracts.set(question.source_question_id, {
      questionType: question.question_type,
      expectedAnswer: expectedAnswer(question)
    })
  }

  const baseSqlPath = join(projectRoot, 'doc', 'features', 'question-bank-import-base-ability-v02.sql')
  const baseSql = readFileSync(baseSqlPath, 'utf8')
  for (const match of baseSql.matchAll(/VALUES\('((?:GA-[A-Z0-9-]+|Q_BASE_[A-Z0-9_]+))'/g)) {
    sourceContracts.set(match[1], { questionType: null, expectedAnswer: null })
    currentContracts.set(match[1], { sourceQuestionId: match[1], runtimeStatus: 'DRAFT_BASE_ABILITY' })
  }

  const runtimeAuthorityPath = join(projectRoot, 'doc', 'features', 'job-skill-shelver-runtime-authority-v1.json')
  const runtimeAuthority = JSON.parse(readFileSync(runtimeAuthorityPath, 'utf8'))
  for (const question of runtimeAuthority.questions ?? []) {
    currentContracts.set(question.current_question_id, {
      sourceQuestionId: question.source_question_id,
      runtimeStatus: question.runtime_status
    })
    sourceToCurrent.set(question.source_question_id, question.current_question_id)
  }

  return { sourceContracts, currentContracts, sourceToCurrent }
}

export function validateVisualAssetManifest(manifest, {
  projectRoot,
  enforceBaselineCounts = true,
  checkFiles = true
}) {
  const errors = []
  const warnings = []
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : []
  if (manifest?.version !== ASSET_MANIFEST_VERSION) {
    errors.push(`manifest.version must be ${ASSET_MANIFEST_VERSION}`)
  }
  if (manifest?.plan_version !== ASSET_PLAN_VERSION) {
    errors.push(`manifest.plan_version must be ${ASSET_PLAN_VERSION}`)
  }
  if (!manifest?.question_authority || typeof manifest.question_authority !== 'object') {
    errors.push('manifest.question_authority is required')
  } else {
    const authority = manifest.question_authority
    for (const key of Object.keys(authority)) {
      if (!QUESTION_AUTHORITY_FIELDS.has(key)) errors.push(`manifest.question_authority has unknown field ${key}`)
    }
    if (authority.job_skill_runtime_status !== 'DRAFT_COMPILED_NOT_ACTIVATABLE') {
      errors.push('manifest.question_authority.job_skill_runtime_status must be DRAFT_COMPILED_NOT_ACTIVATABLE')
    }
    if (authority.job_skill_question_total !== 298) {
      errors.push('manifest.question_authority.job_skill_question_total must be 298')
    }
    if (authority.phase4_gate_status !== 'BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE') {
      errors.push('manifest.question_authority.phase4_gate_status must be BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE')
    }
    if (authority.offline_toolkit_status !== 'LOCKED_FOR_PRODUCTION') {
      errors.push('manifest.question_authority.offline_toolkit_status must be LOCKED_FOR_PRODUCTION')
    }
    if (projectRoot) {
      for (const pathField of [
        'job_skill_runtime_authority_path',
        'phase4_gate_path',
        'delivery_lock_path',
        'offline_toolkit_manifest_path'
      ]) {
        const relPath = authority[pathField]
        if (!isSafeRelativePath(relPath) || !existsSync(join(projectRoot, relPath))) {
          errors.push(`manifest.question_authority.${pathField} must point to an existing repo-relative file`)
        }
      }
    }
  }
  if (assets.length === 0) errors.push('manifest.assets must contain at least one asset')

  const byId = new Map()
  for (const [index, item] of assets.entries()) {
    const prefix = `assets[${index}]`
    if (!/^asset_[a-z0-9_]+$/.test(item.asset_id ?? '')) {
      errors.push(`${prefix}.asset_id must match ^asset_[a-z0-9_]+$`)
    }
    if (!/^[a-z][a-z0-9_]*$/.test(item.plan_key ?? '')) {
      errors.push(`${prefix}.plan_key must be lowercase ASCII snake_case`)
    }
    if (item.asset_id !== `asset_${item.plan_key}`) {
      errors.push(`${prefix}.asset_id must equal asset_ + plan_key`)
    }
    if (byId.has(item.asset_id)) errors.push(`duplicate asset_id: ${item.asset_id}`)
    byId.set(item.asset_id, item)
    if (!CATEGORY_VALUES.has(item.category)) errors.push(`${item.asset_id}: invalid category ${item.category}`)
    if (!PRIORITY_VALUES.has(item.priority)) errors.push(`${item.asset_id}: invalid priority ${item.priority}`)
    if (item.category === 'REFERENCE' && item.priority !== 'REFERENCE') {
      errors.push(`${item.asset_id}: reference asset priority must be REFERENCE`)
    }
    if (item.category !== 'REFERENCE' && item.priority === 'REFERENCE') {
      errors.push(`${item.asset_id}: delivery asset cannot use REFERENCE priority`)
    }
    if (typeof item.description !== 'string' || item.description.trim() === '') {
      errors.push(`${item.asset_id}: description is required`)
    }
    if (!ASSET_TYPE_VALUES.has(item.asset_type)) errors.push(`${item.asset_id}: invalid asset_type ${item.asset_type}`)
    if (!ASSET_ROLE_VALUES.has(item.asset_role)) errors.push(`${item.asset_id}: invalid asset_role ${item.asset_role}`)
    if (!USAGE_MODE_VALUES.has(item.usage_mode)) errors.push(`${item.asset_id}: invalid usage_mode ${item.usage_mode}`)
    if (!DELIVERY_FORMAT_VALUES.has(item.delivery_format)) {
      errors.push(`${item.asset_id}: invalid delivery_format ${item.delivery_format}`)
    }
    if (!PRODUCTION_METHOD_VALUES.has(item.production_method)) {
      errors.push(`${item.asset_id}: invalid production_method ${item.production_method}`)
    }
    if (!REVIEW_LEVEL_VALUES.has(item.review_level)) {
      errors.push(`${item.asset_id}: invalid review_level ${item.review_level}`)
    }
    if (!LIFECYCLE_VALUES.has(item.lifecycle_status)) {
      errors.push(`${item.asset_id}: invalid lifecycle_status ${item.lifecycle_status}`)
    }
    if (!Array.isArray(item.question_ids) || new Set(item.question_ids).size !== item.question_ids.length) {
      errors.push(`${item.asset_id}: question_ids must be a unique array`)
    }
    if (!Array.isArray(item.current_question_ids) || new Set(item.current_question_ids).size !== item.current_question_ids.length) {
      errors.push(`${item.asset_id}: current_question_ids must be a unique array`)
    }
    if (item.answer_contract_hash !== null && !/^sha256:[a-f0-9]{64}$/.test(item.answer_contract_hash ?? '')) {
      errors.push(`${item.asset_id}: answer_contract_hash must be a prefixed SHA-256 hash or null`)
    }
    if (!Array.isArray(item.fallback_allowed_when)) {
      errors.push(`${item.asset_id}: fallback_allowed_when must be an array`)
    }
    if (typeof item.fallback_used !== 'boolean') {
      errors.push(`${item.asset_id}: fallback_used must be boolean`)
    } else if (item.fallback_used && !item.fallback_allowed_when?.includes(item.fallback_reason)) {
      errors.push(`${item.asset_id}: fallback_used requires an allowed fallback_reason`)
    } else if (!item.fallback_used && item.fallback_reason !== null) {
      errors.push(`${item.asset_id}: fallback_reason must be null when fallback_used=false`)
    }
    if (!Array.isArray(item.reference_asset_ids)) {
      errors.push(`${item.asset_id}: reference_asset_ids must be an array`)
    } else if (['ai_direct', 'ai_plus_overlay', 'composite'].includes(item.production_method)
      && item.category !== 'REFERENCE' && item.reference_asset_ids.length === 0) {
      errors.push(`${item.asset_id}: AI delivery asset must cite at least one core reference asset`)
    }
    if (item.runtime_path !== null) {
      if (!isSafeRelativePath(item.runtime_path)) errors.push(`${item.asset_id}: runtime_path must be repo-relative`)
      if (item.runtime_path !== item.runtime_path.toLowerCase()) errors.push(`${item.asset_id}: runtime_path must be lowercase`)
    }
    if (item.source_path !== null && !isSafeRelativePath(item.source_path)) {
      errors.push(`${item.asset_id}: source_path must be repo-relative`)
    }
    if (!item.gate_reviews || typeof item.gate_reviews !== 'object') {
      errors.push(`${item.asset_id}: gate_reviews is required`)
    } else {
      for (const gateName of REQUIRED_GATE_NAMES) {
        const gate = item.gate_reviews[gateName]
        if (!gate) {
          errors.push(`${item.asset_id}: missing gate ${gateName}`)
          continue
        }
        if (!GATE_STATUS_VALUES.has(gate.status)) {
          errors.push(`${item.asset_id}: invalid gate status ${gateName}=${gate.status}`)
        }
        if (!REVIEWER_KIND_VALUES.has(gate.reviewer_kind)) {
          errors.push(`${item.asset_id}: invalid reviewer_kind ${gateName}=${gate.reviewer_kind}`)
        }
        if (gate.required && gate.status === 'waived') {
          errors.push(`${item.asset_id}: required gate ${gateName} cannot be waived`)
        }
        if (!gate.required && gate.status !== 'waived') {
          errors.push(`${item.asset_id}: non-required gate ${gateName} must be waived`)
        }
        if (gate.status === 'passed' && gate.reviewer_kind === 'ai_advisory') {
          errors.push(`${item.asset_id}: AI advisory cannot sign a passed gate`)
        }
      }
    }
    const isAiAsset = ['ai_direct', 'ai_plus_overlay', 'composite'].includes(item.production_method)
    if (isAiAsset) {
      if (!item.prompt_template_id) errors.push(`${item.asset_id}: AI/composite asset requires prompt_template_id`)
      if (item.lifecycle_status !== 'planned'
        && (typeof item.prompt_text !== 'string' || item.prompt_text.trim() === '')) {
        errors.push(`${item.asset_id}: AI/composite asset requires prompt_text before leaving planned`)
      }
      if (item.prompt_template_id && checkFiles) {
        const promptPath = join(projectRoot, 'doc', 'assets', 'prompt-templates', `${item.prompt_template_id}.txt`)
        if (!existsSync(promptPath)) errors.push(`${item.asset_id}: prompt template missing: ${item.prompt_template_id}`)
      }
      if (item.provider !== 'apimart') errors.push(`${item.asset_id}: AI assets must use provider apimart`)
      if (!item.generation_params || typeof item.generation_params !== 'object') {
        errors.push(`${item.asset_id}: AI assets require generation_params`)
      } else if (item.asset_type === 'video') {
        if (item.model !== 'doubao-seedance-2.0') {
          errors.push(`${item.asset_id}: video model must be doubao-seedance-2.0`)
        }
        if (item.route !== '/v1/videos/generations') {
          errors.push(`${item.asset_id}: video route must be /v1/videos/generations`)
        }
        if (item.fallback_model !== null || item.fallback_route !== null || (item.fallback_allowed_when?.length ?? 0) > 0) {
          errors.push(`${item.asset_id}: video assets must not use the GPT image fallback policy`)
        }
        if (item.fallback_used || item.fallback_reason !== null) {
          errors.push(`${item.asset_id}: video assets cannot mark image fallback as used`)
        }
        if (item.generation_params.size !== '16:9') errors.push(`${item.asset_id}: video size must be 16:9`)
        if (item.generation_params.resolution !== '720p') errors.push(`${item.asset_id}: video resolution must be 720p`)
        if (!Number.isInteger(item.generation_params.duration)
          || item.generation_params.duration < 5
          || item.generation_params.duration > 15) {
          errors.push(`${item.asset_id}: video duration must be an integer from 5 to 15 seconds`)
        }
        if (item.generation_params.generate_audio !== false) {
          errors.push(`${item.asset_id}: assessment/training videos must set generate_audio=false`)
        }
        for (const key of Object.keys(item.generation_params)) {
          if (!VIDEO_PARAM_KEYS.has(key)) errors.push(`${item.asset_id}: unsupported video generation param ${key}`)
        }
      } else {
        if (item.model !== 'gpt-image-2') errors.push(`${item.asset_id}: primary image model must be gpt-image-2`)
        if (item.route !== '/v1/images/generations') {
          errors.push(`${item.asset_id}: image route must be /v1/images/generations`)
        }
        if (item.fallback_model !== 'gpt-image-2-official') {
          errors.push(`${item.asset_id}: image fallback model must be gpt-image-2-official`)
        }
        if (item.fallback_route !== '/v1/images/generations') {
          errors.push(`${item.asset_id}: image fallback route must be /v1/images/generations`)
        }
        if (JSON.stringify(item.fallback_allowed_when) !== JSON.stringify(IMAGE_FALLBACK_REASONS)) {
          errors.push(`${item.asset_id}: official image fallback is allowed only for primary_unavailable or manual_override`)
        }
        if (item.generation_params.resolution !== '2k') errors.push(`${item.asset_id}: image resolution must be 2k`)
        if (item.generation_params.n !== 1) errors.push(`${item.asset_id}: image n must be 1`)
        for (const key of Object.keys(item.generation_params)) {
          if (!IMAGE_PARAM_KEYS.has(key)) errors.push(`${item.asset_id}: unsupported gpt-image-2 generation param ${key}`)
        }
      }
    } else {
      if (item.model !== null || item.route !== null || item.generation_params !== null) {
        errors.push(`${item.asset_id}: programmatic assets cannot declare AI model, route, or generation_params`)
      }
      if (item.fallback_model !== null || item.fallback_route !== null || (item.fallback_allowed_when?.length ?? 0) > 0) {
        errors.push(`${item.asset_id}: programmatic assets cannot declare an AI fallback`)
      }
    }
    if (!item.rights || typeof item.rights !== 'object') {
      errors.push(`${item.asset_id}: rights is required`)
    } else if (typeof item.rights.commercial_use_cleared !== 'boolean') {
      errors.push(`${item.asset_id}: rights.commercial_use_cleared must be boolean`)
    }
    for (const arrayField of ['distractors', 'forbidden_visual_cues', 'required_overlay', 'qa_record_paths']) {
      if (!Array.isArray(item[arrayField])) errors.push(`${item.asset_id}: ${arrayField} must be an array`)
    }
    if (checkFiles) {
      for (const qaPath of item.qa_record_paths ?? []) {
        if (!isSafeRelativePath(qaPath) || !existsSync(join(projectRoot, qaPath))) {
          errors.push(`${item.asset_id}: QA record missing or unsafe: ${qaPath}`)
        }
      }
    }
    if (item.production_method === 'ai_plus_overlay' && item.required_overlay.length === 0) {
      errors.push(`${item.asset_id}: ai_plus_overlay requires required_overlay`)
    }
    if (['ai_plus_overlay', 'composite'].includes(item.production_method) && !item.overlay_spec) {
      errors.push(`${item.asset_id}: ${item.production_method} requires overlay_spec`)
    }
    if (['generated', 'composited', 'reviewing', 'approved'].includes(item.lifecycle_status)) {
      if (!item.source_path) errors.push(`${item.asset_id}: ${item.lifecycle_status} requires source_path`)
      if (!/^[a-f0-9]{64}$/.test(item.file_hash ?? '')) {
        errors.push(`${item.asset_id}: ${item.lifecycle_status} requires a SHA-256 file_hash`)
      }
    }
    if (item.lifecycle_status === 'approved') {
      if (!item.runtime_path) errors.push(`${item.asset_id}: approved asset requires runtime_path`)
      if (!item.rights?.commercial_use_cleared) {
        errors.push(`${item.asset_id}: approved asset requires commercial_use_cleared=true`)
      }
      for (const gateName of REQUIRED_GATE_NAMES) {
        const gate = item.gate_reviews?.[gateName]
        if (gate?.required && gate.status !== 'passed') {
          errors.push(`${item.asset_id}: approved asset has unpassed required gate ${gateName}`)
        }
      }
      if (checkFiles && item.source_path && item.runtime_path) {
        const sourcePath = join(projectRoot, item.source_path)
        const runtimePath = join(projectRoot, item.runtime_path)
        if (!existsSync(sourcePath)) errors.push(`${item.asset_id}: source file missing: ${item.source_path}`)
        if (!existsSync(runtimePath)) errors.push(`${item.asset_id}: runtime file missing: ${item.runtime_path}`)
        if (existsSync(runtimePath) && fileSha256(runtimePath) !== item.file_hash) {
          errors.push(`${item.asset_id}: runtime file hash differs from manifest`)
        }
      }
    }
  }

  for (const item of assets) {
    for (const referenceId of item.reference_asset_ids ?? []) {
      const reference = byId.get(referenceId)
      if (!reference) {
        errors.push(`${item.asset_id}: reference asset not found: ${referenceId}`)
      } else if (reference.asset_type !== 'reference') {
        errors.push(`${item.asset_id}: reference_asset_ids must point to reference assets: ${referenceId}`)
      } else if (item.lifecycle_status === 'approved' && reference.lifecycle_status !== 'approved') {
        errors.push(`${item.asset_id}: approved asset depends on unapproved reference ${referenceId}`)
      }
    }
  }

  if (projectRoot) {
    const { sourceContracts, currentContracts, sourceToCurrent } = loadQuestionContracts(projectRoot)
    for (const item of assets) {
      const expectedCurrentIds = []
      for (const questionId of item.question_ids ?? []) {
        const contract = sourceContracts.get(questionId)
        if (!contract) {
          errors.push(`${item.asset_id}: question_id not found in current question contracts: ${questionId}`)
        } else if (item.expected_answer !== null && contract.expectedAnswer !== item.expected_answer) {
          errors.push(
            `${item.asset_id}: expected_answer ${JSON.stringify(item.expected_answer)} differs from question ${questionId} (${JSON.stringify(contract.expectedAnswer)})`
          )
        }
        expectedCurrentIds.push(sourceToCurrent.get(sourceQuestionId(questionId)) ?? questionId)
      }
      for (const currentQuestionId of item.current_question_ids ?? []) {
        if (!currentContracts.has(currentQuestionId)) {
          errors.push(`${item.asset_id}: current_question_id not found in runtime question contracts: ${currentQuestionId}`)
        }
      }
      const uniqueExpectedCurrentIds = [...new Set(expectedCurrentIds)].sort()
      const actualCurrentIds = [...(item.current_question_ids ?? [])].sort()
      if ((item.question_ids?.length ?? 0) > 0) {
        if (JSON.stringify(actualCurrentIds) !== JSON.stringify(uniqueExpectedCurrentIds)) {
          errors.push(
            `${item.asset_id}: current_question_ids must exactly match question_ids mapped through current runtime authority`
          )
        }
      } else if (actualCurrentIds.length > 0) {
        errors.push(`${item.asset_id}: current_question_ids must be empty when question_ids is empty`)
      }
    }
  } else {
    warnings.push('projectRoot not provided; question and file checks skipped')
  }

  if (enforceBaselineCounts) {
    for (const [category, expected] of Object.entries(EXPECTED_COUNTS)) {
      const actual = assets.filter((item) => item.category === category).length
      if (actual !== expected) errors.push(`category ${category} expected ${expected} assets, found ${actual}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      total: assets.length,
      approved: assets.filter((item) => item.lifecycle_status === 'approved').length,
      planned: assets.filter((item) => item.lifecycle_status === 'planned').length
    }
  }
}

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function approvedAssetsToResourceRows(manifest, projectRoot) {
  return manifest.assets
    .filter((item) => item.lifecycle_status === 'approved')
    .map((item) => {
      const filePath = join(projectRoot, item.runtime_path)
      const fileSize = statSync(filePath).size
      return {
        asset_id: item.asset_id,
        asset_type: item.delivery_format === 'mp4' ? 'VIDEO'
          : item.delivery_format === 'mp3' ? 'AUDIO'
            : item.delivery_format === 'json' ? 'JSON'
              : item.delivery_format === 'pdf' ? 'PDF'
                : 'IMAGE',
        asset_role: item.asset_role,
        app_uri: `app://asset/${item.asset_id}`,
        local_path: item.runtime_path,
        mime_type: MIME_BY_FORMAT[item.delivery_format],
        file_hash: item.file_hash,
        file_size_bytes: fileSize,
        duration_ms: item.duration_ms,
        width_px: item.width_px,
        height_px: item.height_px,
        status: 'ACTIVE'
      }
    })
}

export function buildVisualAssetResourceSql(rows, isoTimestamp) {
  const managedRoles = "'QUESTION_MEDIA', 'UI_ASSET', 'TOOL_CHECKLIST', 'ROLE_PLAY_SCRIPT', 'SEALED_ADMIN_CONFIG', 'OFFLINE_SETUP_GUIDE'"
  const approvedIds = rows.map((row) => sqlStr(row.asset_id))
  const retireClause = approvedIds.length > 0 ? `AND asset_id NOT IN (${approvedIds.join(', ')})` : ''
  const statements = [
    'BEGIN;',
    'CREATE TEMP TABLE IF NOT EXISTS _asset_seed_hash_guard (conflict_count INTEGER NOT NULL CHECK (conflict_count = 0));',
    'DELETE FROM _asset_seed_hash_guard;',
    rows.length > 0
      ? `INSERT INTO _asset_seed_hash_guard (conflict_count) SELECT COUNT(*) FROM asset_resource WHERE ${rows.map((row) => `(asset_id = ${sqlStr(row.asset_id)} AND file_hash <> ${sqlStr(row.file_hash)})`).join(' OR ')};`
      : 'INSERT INTO _asset_seed_hash_guard (conflict_count) VALUES (0);',
    `UPDATE asset_resource
SET status = 'DEPRECATED', updated_at = datetime('now')
WHERE asset_role IN (${managedRoles})
  ${retireClause};`
  ]
  if (rows.length > 0) {
    const values = rows.map((row) => `  (
    ${sqlStr(row.asset_id)}, ${sqlStr(row.asset_type)}, ${sqlStr(row.asset_role)},
    ${sqlStr(row.app_uri)}, ${sqlStr(row.local_path)}, ${sqlStr(row.mime_type)},
    ${sqlStr(row.file_hash)}, ${row.file_size_bytes}, ${row.duration_ms ?? 'NULL'},
    ${row.width_px ?? 'NULL'}, ${row.height_px ?? 'NULL'}, 'ACTIVE', ${sqlStr(isoTimestamp)}
  )`).join(',\n')
    statements.push(`INSERT INTO asset_resource (
  asset_id, asset_type, asset_role, app_uri, local_path, mime_type,
  file_hash, file_size_bytes, duration_ms, width_px, height_px, status, last_verified_at
) VALUES
${values}
ON CONFLICT(asset_id) DO UPDATE SET
  asset_type = excluded.asset_type,
  asset_role = excluded.asset_role,
  app_uri = excluded.app_uri,
  local_path = excluded.local_path,
  mime_type = excluded.mime_type,
  file_hash = excluded.file_hash,
  file_size_bytes = excluded.file_size_bytes,
  duration_ms = excluded.duration_ms,
  width_px = excluded.width_px,
  height_px = excluded.height_px,
  status = 'ACTIVE',
  last_verified_at = excluded.last_verified_at,
  updated_at = datetime('now');`)
  }
  statements.push('DROP TABLE _asset_seed_hash_guard;')
  statements.push('COMMIT;')
  return statements.join('\n')
}

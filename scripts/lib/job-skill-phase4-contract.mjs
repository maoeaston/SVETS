import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashFile, hashRecord } from './job-skill-contract-hash.mjs'
import { mapImportRow } from './question-bank-import.mjs'
import { validateVisualAssetManifest } from './visual-asset-manifest.mjs'

const REL = {
  sourceAuthority: 'doc/features/job-skill-shelver-298-disposition-authority-v1.json',
  deliveryLock: 'doc/features/job-skill-shelver-question-delivery-lock-v1.json',
  assetManifest: 'doc/assets/asset-manifest.json',
  pilotCandidates: 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json',
  pilotGate: 'doc/features/job-skill-shelver-pilot-activation-manifest-v3.json',
  sourceQuestions: 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json',
  offlineToolkit: 'doc/assets/offline-toolkit-manifest-v1.json',
  v1Candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json',
  v3Candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v3.json',
  v4Candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v4.json',
  v5Candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v5.json',
  v6Candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v6.json',
  v6Gate: 'doc/features/job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1.json',
  replacementV2Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json',
  replacementV3Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json',
  replacementV4Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json',
  replacementGate: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json',
  runtimeAuthority: 'doc/features/job-skill-shelver-runtime-authority-v1.json',
  activationGate: 'doc/features/job-skill-shelver-phase4-activation-gate-v1.json',
  activationLedger: 'doc/features/job-skill-shelver-phase4-activation-ledger-v1.md'
}

function assert(condition, message) {
  if (!condition) throw new Error(`[job-skill-phase4] ${message}`)
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'))
}

function withoutHash(record, field) {
  const { [field]: ignored, ...body } = record
  return body
}

function assertRecordHash(record, field, label) {
  assert(record[field] === hashRecord(withoutHash(record, field)), `${label} ${field} mismatch`)
}

function fileRef(root, path, role) {
  return { path, sha256: hashFile(resolve(root, path)), role }
}

function addAssetId(ids, value) {
  if (typeof value === 'string' && value.length > 0) ids.add(value)
}

function addImageReferences(ids, values) {
  if (!Array.isArray(values)) return
  for (const value of values) addAssetId(ids, value?.image_asset_id ?? value?.asset_id)
}

export function collectQuestionAssetReferences(question) {
  const ids = new Set()
  const content = typeof question.content_json === 'string'
    ? JSON.parse(question.content_json)
    : question.content_json ?? {}

  addAssetId(ids, question.media_asset_id)
  addImageReferences(ids, content.presentation?.assets)
  addImageReferences(ids, content.options)
  addImageReferences(ids, content.drag_items)
  addImageReferences(ids, content.drop_zones)
  addImageReferences(ids, content.interaction?.config?.options)
  addImageReferences(ids, content.interaction?.config?.items)
  addImageReferences(ids, content.interaction?.config?.zones)

  for (const variant of content.variants ?? []) {
    addAssetId(ids, variant?.media_asset_id)
    addAssetId(ids, variant?.image_asset_id)
    addImageReferences(ids, variant?.assets)
  }

  let toolAssetIds = question.tool_asset_ids_json ?? question.tool_asset_ids ?? []
  if (typeof toolAssetIds === 'string') toolAssetIds = JSON.parse(toolAssetIds)
  if (Array.isArray(toolAssetIds)) for (const assetId of toolAssetIds) addAssetId(ids, assetId)

  addAssetId(ids, content.administration?.script_asset_id)
  addAssetId(ids, content.administration?.sealed_config_asset_id)
  for (const assetId of content.offline_setup?.asset_ids ?? []) addAssetId(ids, assetId)

  return [...ids].sort()
}

function loadInputs(root) {
  return {
    sourceAuthority: readJson(root, REL.sourceAuthority),
    deliveryLock: readJson(root, REL.deliveryLock),
    assetManifest: readJson(root, REL.assetManifest),
    pilotCandidates: readJson(root, REL.pilotCandidates),
    pilotGate: readJson(root, REL.pilotGate),
    sourceQuestions: readJson(root, REL.sourceQuestions),
    offlineToolkit: readJson(root, REL.offlineToolkit),
    candidateSets: [
      REL.v1Candidates,
      REL.v3Candidates,
      REL.v4Candidates,
      REL.v5Candidates,
      REL.v6Candidates,
      REL.replacementV2Candidates,
      REL.replacementV3Candidates,
      REL.replacementV4Candidates
    ]
      .map((path) => ({ path, value: readJson(root, path) })),
    v6Gate: readJson(root, REL.v6Gate),
    replacementGate: readJson(root, REL.replacementGate)
  }
}

function candidateIndexes(candidateSets, pilotCandidates) {
  const byQuestionId = new Map()
  const fileByQuestionId = new Map()
  for (const { path, value } of candidateSets) {
    for (const question of value.questions ?? []) {
      assert(!byQuestionId.has(question.question_id), `duplicate candidate ${question.question_id}`)
      byQuestionId.set(question.question_id, question)
      fileByQuestionId.set(question.question_id, path)
    }
  }
  for (const question of pilotCandidates.questions ?? []) {
    assert(!byQuestionId.has(question.question_id), `duplicate Pilot candidate ${question.question_id}`)
    byQuestionId.set(question.question_id, question)
    fileByQuestionId.set(question.question_id, REL.pilotCandidates)
  }
  return { byQuestionId, fileByQuestionId }
}

function questionRef(question, candidate, candidatePath, resolution) {
  return {
    source_question_id: question.source_question_id,
    source_question_version: question.source_question_version,
    source_record_hash: question.source_record_hash,
    branch: question.branch,
    module: question.module,
    question_type: question.question_type,
    resolution,
    current_question_id: candidate?.question_id ?? question.current_question_id,
    current_question_version: candidate?.question_version ?? question.current_question_version,
    semantic_hash: candidate?.new_semantic_hash ?? question.semantic_hash,
    candidate_record_hash: candidate?.candidate_record_hash ?? question.candidate_record_hash,
    candidate_source_path: candidatePath,
    runtime_status: 'DRAFT',
    activation_authority: 'NONE'
  }
}

export function buildJobSkillPhase4Contracts({ root }) {
  const input = loadInputs(root)
  assertRecordHash(input.sourceAuthority, 'authority_hash', 'source authority')
  assertRecordHash(input.deliveryLock, 'lock_hash', 'delivery lock')
  assertRecordHash(input.v6Gate, 'gate_hash', 'V6 merged gate')
  assertRecordHash(input.replacementGate, 'gate_hash', 'replacement merged gate')
  assert(input.sourceAuthority.questions?.length === 298, 'source authority must cover 298 questions')
  assert(input.sourceAuthority.summary?.retained_total === 298, 'source authority must retain 298 questions')
  assert(input.sourceAuthority.summary?.replacement_review_passed === 11, 'source authority must retain 11 passed replacements')
  assert(input.v6Gate.status === 'PASSED', 'V6 merged gate must be PASSED')
  assert(input.v6Gate.summary?.total === 145 && input.v6Gate.summary?.passed === 145, 'V6 merged gate must pass exactly 145 questions')
  assert(input.v6Gate.authority?.phase_4_allowed === true, 'V6 merged gate must allow phase 4')
  assert(input.replacementGate.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY', 'replacement merged gate must be review-only passed')
  assert(input.replacementGate.summary?.cumulative_replacement_review?.total === 11, 'replacement merged gate must cover 11 questions')
  assert(input.replacementGate.summary?.cumulative_replacement_review?.passed_review_only_no_activation_authority === 11, 'replacement merged gate must pass 11 questions')
  assert(input.replacementGate.authority?.activation_authority_granted === false, 'replacement merged gate must not grant activation authority')
  assert(input.deliveryLock.questions?.length === 181, 'delivery lock must cover 181 questions')
  const assetValidation = validateVisualAssetManifest(input.assetManifest, { projectRoot: root })
  assert(assetValidation.ok, `asset manifest validation failed: ${assetValidation.errors.join('; ')}`)

  const { byQuestionId, fileByQuestionId } = candidateIndexes(input.candidateSets, input.pilotCandidates)
  const replacementBySourceId = new Map()
  const replacementReferences = input.replacementGate.cumulative_passed_references
  assert(Array.isArray(replacementReferences) && replacementReferences.length === 11, 'replacement merged gate must list 11 passed references')
  for (const reference of replacementReferences) {
    const candidate = byQuestionId.get(reference.question_id)
    assert(candidate, `replacement candidate missing: ${reference.question_id}`)
    assert(candidate.candidate_record_hash === reference.candidate_record_hash, `${reference.question_id} replacement candidate hash drift`)
    assert(candidate.new_semantic_hash === reference.semantic_hash, `${reference.question_id} replacement semantic hash drift`)
    assert(reference.activation_authority === 'NONE', `${reference.question_id} replacement reference grants activation authority`)
    assert(!replacementBySourceId.has(candidate.source_question_id), `duplicate replacement source ${candidate.source_question_id}`)
    replacementBySourceId.set(candidate.source_question_id, candidate)
  }
  assert(replacementBySourceId.size === 11, 'replacement source coverage must equal 11')
  const v6BySourceId = new Map()
  for (const gateQuestion of input.v6Gate.questions) {
    const candidate = byQuestionId.get(gateQuestion.question_id)
    assert(candidate, `V6 passed candidate missing: ${gateQuestion.question_id}`)
    assert(candidate.candidate_record_hash === gateQuestion.candidate_record_hash, `${gateQuestion.question_id} candidate hash drift`)
    assert(candidate.new_semantic_hash === gateQuestion.semantic_hash, `${gateQuestion.question_id} semantic hash drift`)
    assert(gateQuestion.status === 'PASSED' || gateQuestion.status === 'PASSED_REFERENCE', `${gateQuestion.question_id} is not passed`)
    assert(!v6BySourceId.has(candidate.source_question_id), `duplicate V6 source ${candidate.source_question_id}`)
    v6BySourceId.set(candidate.source_question_id, { candidate, gateQuestion })
  }
  assert(v6BySourceId.size === 145, 'V6 source coverage must equal 145')

  const questions = input.sourceAuthority.questions.map((question) => {
    if (question.disposition === 'REJECTED') {
      return {
        source_question_id: question.source_question_id,
        source_question_version: question.source_question_version,
        source_record_hash: question.source_record_hash,
        branch: question.branch,
        module: question.module,
        question_type: question.question_type,
        resolution: 'REJECTED',
        current_question_id: null,
        current_question_version: null,
        semantic_hash: null,
        candidate_record_hash: null,
        candidate_source_path: null,
        runtime_status: 'EXCLUDED_REJECTED',
        activation_authority: 'NOT_APPLICABLE'
      }
    }

    if (question.disposition === 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION') {
      const candidate = replacementBySourceId.get(question.source_question_id)
      assert(candidate, `replacement candidate missing for source ${question.source_question_id}`)
      assert(candidate.question_id === question.current_question_id, `${question.source_question_id} replacement current ID drift`)
      assert(candidate.question_version === question.current_question_version, `${question.source_question_id} replacement version drift`)
      assert(candidate.candidate_record_hash === question.candidate_record_hash, `${question.source_question_id} replacement record hash drift`)
      assert(candidate.new_semantic_hash === question.semantic_hash, `${question.source_question_id} replacement semantic hash drift`)
      return questionRef(
        question,
        candidate,
        fileByQuestionId.get(candidate.question_id),
        'REJECTED_REPLACEMENT_REVIEW_PASSED'
      )
    }

    if (question.branch === 'PILOT') {
      const candidate = byQuestionId.get(question.current_question_id)
      assert(candidate, `Pilot candidate missing: ${question.current_question_id}`)
      return questionRef(question, candidate, fileByQuestionId.get(candidate.question_id), 'PILOT_GATE_PENDING')
    }

    const targeted = v6BySourceId.get(question.source_question_id)
    if (targeted) {
      return questionRef(
        question,
        targeted.candidate,
        fileByQuestionId.get(targeted.candidate.question_id),
        'TARGETED_REREVIEW_PASSED'
      )
    }

    const candidate = byQuestionId.get(question.current_question_id)
    assert(candidate, `retained candidate missing: ${question.current_question_id}`)
    const resolution = question.disposition === 'APPROVED_UNCHANGED_PENDING_ACTIVATION'
      ? 'APPROVED_UNCHANGED'
      : question.disposition === 'REVISED_REREVIEW_PASSED_PENDING_ACTIVATION'
        ? 'INITIAL_REREVIEW_PASSED'
        : 'PRESERVED_WITHOUT_SEMANTIC_CHANGE'
    return questionRef(question, candidate, fileByQuestionId.get(candidate.question_id), resolution)
  })

  const count = (resolution) => questions.filter((question) => question.resolution === resolution).length
  const summary = {
    source_total: questions.length,
    retained_total: questions.filter((question) => question.runtime_status === 'DRAFT').length,
    rejected_total: count('REJECTED'),
    pilot_pending_total: count('PILOT_GATE_PENDING'),
    approved_unchanged_total: count('APPROVED_UNCHANGED'),
    initial_rereview_passed_total: count('INITIAL_REREVIEW_PASSED'),
    preserved_without_semantic_change_total: count('PRESERVED_WITHOUT_SEMANTIC_CHANGE'),
    targeted_rereview_passed_total: count('TARGETED_REREVIEW_PASSED'),
    rejected_replacement_review_passed_total: count('REJECTED_REPLACEMENT_REVIEW_PASSED')
  }
  assert(JSON.stringify(summary) === JSON.stringify({
    source_total: 298,
    retained_total: 298,
    rejected_total: 0,
    pilot_pending_total: 24,
    approved_unchanged_total: 31,
    initial_rereview_passed_total: 21,
    preserved_without_semantic_change_total: 66,
    targeted_rereview_passed_total: 145,
    rejected_replacement_review_passed_total: 11
  }), `unexpected runtime authority summary: ${JSON.stringify(summary)}`)

  const inputs = [
    fileRef(root, REL.sourceAuthority, 'SOURCE_DISPOSITION_AUTHORITY'),
    fileRef(root, REL.deliveryLock, 'QUESTION_DELIVERY_LOCK'),
    fileRef(root, REL.assetManifest, 'ASSET_MANIFEST'),
    fileRef(root, REL.pilotCandidates, 'PILOT_CANDIDATES'),
    fileRef(root, REL.pilotGate, 'PILOT_ACTIVATION_GATE'),
    fileRef(root, REL.sourceQuestions, 'IMMUTABLE_298_SOURCE'),
    fileRef(root, REL.offlineToolkit, 'OFFLINE_TOOLKIT'),
    ...input.candidateSets.map(({ path }) => fileRef(root, path, 'QUESTION_CANDIDATES')),
    fileRef(root, REL.v6Gate, 'V6_MERGED_REVIEW_GATE'),
    fileRef(root, REL.replacementGate, 'REJECTED_REPLACEMENT_MERGED_REVIEW_GATE')
  ]
  const authorityBody = {
    schema_version: 'job-skill-shelver-runtime-authority-v1',
    authority_id: 'job-skill-shelver-runtime-authority-v1',
    status: 'DRAFT_COMPILED_NOT_ACTIVATABLE',
    generated_at: '2026-07-22T15:00:00+08:00',
    inputs,
    summary,
    questions,
    semantic_root_hash: hashRecord(questions.map((question) => ({
      source_question_id: question.source_question_id,
      current_question_id: question.current_question_id,
      semantic_hash: question.semantic_hash,
      resolution: question.resolution
    })))
  }
  const authority = { ...authorityBody, authority_hash: hashRecord(authorityBody) }

  const lifecycle = Object.fromEntries(['planned', 'generated', 'composited', 'reviewing', 'approved', 'retired']
    .map((status) => [status, input.assetManifest.assets.filter((asset) => asset.lifecycle_status === status).length]))
  const approved = lifecycle.approved ?? 0
  const unresolved = input.assetManifest.assets.length - approved
  const pilotAllowed = input.pilotGate.activation_authorized === true && input.pilotGate.manifest_status === 'PASSED'
  const blockers = []
  if (!pilotAllowed) blockers.push({ code: 'PILOT_GATE_PENDING', count: 24, message: 'Pilot 24题的独立激活门禁尚未通过。' })
  if (unresolved > 0) blockers.push({ code: 'ASSET_DELIVERY_INCOMPLETE', count: unresolved, message: `${unresolved}项资产尚未全部批准并校验文件。` })

  const gateBody = {
    schema_version: 'job-skill-shelver-phase4-activation-gate-v1',
    gate_id: 'job-skill-shelver-phase4-activation-gate-v1',
    status: blockers.length === 0 ? 'PASSED' : 'BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE',
    generated_at: '2026-07-22T15:00:00+08:00',
    runtime_authority: {
      path: REL.runtimeAuthority,
      authority_hash: authority.authority_hash,
      semantic_root_hash: authority.semantic_root_hash
    },
    delivery_lock: {
      path: REL.deliveryLock,
      file_sha256: hashFile(resolve(root, REL.deliveryLock)),
      lock_hash: input.deliveryLock.lock_hash
    },
    review_gate: {
      path: REL.v6Gate,
      file_sha256: hashFile(resolve(root, REL.v6Gate)),
      gate_hash: input.v6Gate.gate_hash,
      targeted_total: input.v6Gate.summary.total,
      passed: input.v6Gate.summary.passed,
      returned: input.v6Gate.summary.return_for_revision
    },
    replacement_review_gate: {
      path: REL.replacementGate,
      file_sha256: hashFile(resolve(root, REL.replacementGate)),
      gate_hash: input.replacementGate.gate_hash,
      replacement_total: input.replacementGate.summary.cumulative_replacement_review.total,
      passed: input.replacementGate.summary.cumulative_replacement_review.passed_review_only_no_activation_authority,
      returned: input.replacementGate.summary.cumulative_replacement_review.return_for_revision
    },
    asset_gate: {
      path: REL.assetManifest,
      file_sha256: hashFile(resolve(root, REL.assetManifest)),
      total: input.assetManifest.assets.length,
      approved,
      unresolved,
      lifecycle
    },
    pilot_gate: {
      path: REL.pilotGate,
      file_sha256: hashFile(resolve(root, REL.pilotGate)),
      status: input.pilotGate.manifest_status,
      activation_authorized: input.pilotGate.activation_authorized
    },
    authority: {
      may_compile_draft_seed: true,
      may_generate_activation_sql: blockers.length === 0,
      may_activate: blockers.length === 0,
      may_create_session: blockers.length === 0,
      phase_4_executed: true,
      runtime_database_unchanged: true
    },
    blockers
  }
  const gate = { ...gateBody, gate_hash: hashRecord(gateBody) }
  return { authority, gate }
}

function pilotProposedQuestion(candidate) {
  const content = {
    question_type: candidate.question_type,
    prompt: candidate.prompt,
    assessment_point: candidate.target_construct,
    ability_tags: [candidate.target_construct].filter((value) => [
      'FINE_MOTOR', 'COGNITION', 'RULE_EXECUTION', 'EMOTION_REGULATION',
      'BASIC_SOCIAL', 'SAFETY_OPERATION'
    ].includes(value)),
    media_brief: candidate.presentation?.media_brief ?? null,
    note: null,
    options: candidate.options ?? [],
    expected_answer: candidate.candidate_answer ?? null,
    offline_tool_brief: candidate.tools?.brief ?? '',
    rubric_criteria: candidate.rubric?.criteria ?? []
  }
  const anchors = candidate.rubric?.anchors
  const scoring_rule = candidate.question_type === 'OFFLINE_OPERATION'
    ? {
        scoring_type: 'RUBRIC_BASED',
        max_score: 2,
        score_0_description: anchors?.['0'] ?? '未达到题目行为要求',
        score_1_description: anchors?.['1'] ?? '部分达到题目行为要求',
        score_2_description: anchors?.['2'] ?? '完整达到题目行为要求'
      }
    : { scoring_type: 'EXACT_MATCH', max_score: 2, correct_score: 2, incorrect_score: 0 }
  return {
    content,
    scoring_rule,
    media_asset_id: null,
    tool_asset_ids: null,
    safety_sensitive: candidate.safety?.source_sensitive === true,
    safety_stop_conditions: candidate.safety?.proposed_stop_conditions || null,
    sensory_tags: null
  }
}

function applyDelivery(row, delivery, manifestById, setupBySourceId) {
  if (!delivery) return row
  const content = structuredClone(row.content_json)
  const mediaAssets = []
  const toolAssets = []
  for (const assetId of delivery.delivery.asset_ids) {
    const asset = manifestById.get(assetId)
    assert(asset, `delivery asset missing from manifest: ${assetId}`)
    if (asset.asset_role === 'QUESTION_MEDIA') mediaAssets.push(assetId)
    else if (asset.asset_role === 'ROLE_PLAY_SCRIPT') {
      content.administration = { ...(content.administration ?? {}), script_asset_id: assetId }
    } else if (asset.asset_role === 'SEALED_ADMIN_CONFIG') {
      content.administration = { ...(content.administration ?? {}), sealed_config_asset_id: assetId }
    } else {
      toolAssets.push(assetId)
    }
  }
  const setup = setupBySourceId.get(delivery.source_question_id)
  if (setup) {
    content.offline_setup = {
      setup_id: setup.setup_id,
      item_ids: [...setup.item_ids],
      asset_ids: [...setup.asset_ids]
    }
  }
  content.presentation = content.presentation ?? { type: 'TEXT_ONLY', assets: [] }
  content.presentation.assets = [
    ...(content.presentation.assets ?? []),
    ...mediaAssets.slice(1).map((assetId, index) => ({
      asset_key: `delivery_${index + 2}`,
      asset_id: assetId,
      role: 'PRIMARY_STIMULUS',
      required: true,
      alt_text: '题目交付素材'
    }))
  ]
  return {
    ...row,
    content_json: content,
    media_asset_id: mediaAssets[0] ?? row.media_asset_id,
    tool_asset_ids_json: toolAssets.length > 0 ? JSON.stringify([...new Set(toolAssets)].sort()) : null
  }
}

export function buildJobSkillRuntimeRows({ root }) {
  const input = loadInputs(root)
  const { authority } = buildJobSkillPhase4Contracts({ root })
  const { byQuestionId } = candidateIndexes(input.candidateSets, input.pilotCandidates)
  const sourceById = new Map(input.sourceQuestions.map((question) => [question.question_id, question]))
  const deliveryBySourceId = new Map(input.deliveryLock.questions.map((question) => [question.source_question_id, question]))
  const manifestById = new Map(input.assetManifest.assets.map((asset) => [asset.asset_id, asset]))
  const setupBySourceId = new Map(input.offlineToolkit.setups.map((setup) => [setup.source_question_id, setup]))
  const importedAt = authority.generated_at

  return authority.questions
    .filter((question) => question.runtime_status === 'DRAFT')
    .map((question, index) => {
      const source = sourceById.get(question.source_question_id)
      const candidate = byQuestionId.get(question.current_question_id)
      assert(source, `source row missing: ${question.source_question_id}`)
      assert(candidate, `runtime candidate missing: ${question.current_question_id}`)
      const proposed = candidate.proposed_question ?? pilotProposedQuestion(candidate)
      const raw = {
        ...source,
        question_id: question.current_question_id,
        question_type: candidate.question_type,
        content_json: proposed.content,
        scoring_rule_json: proposed.scoring_rule,
        safety_sensitive: proposed.safety_sensitive,
        sensory_tags_json: proposed.sensory_tags ?? null,
        version: question.current_question_version
      }
      const mapped = mapImportRow(raw, {
        sourceRow: index + 1,
        importedAt,
        importedBy: 'job-skill-phase4-contract'
      })
      mapped.version = question.current_question_version
      mapped.content_json.source = {
        ...mapped.content_json.source,
        source_question_id: question.source_question_id,
        current_question_id: question.current_question_id,
        candidate_record_hash: question.candidate_record_hash,
        semantic_hash: question.semantic_hash,
        runtime_authority_hash: authority.authority_hash
      }
      if (question.resolution !== 'PILOT_GATE_PENDING') {
        mapped.content_json.review.answer_key_status = mapped.item_usage === 'OBSERVATION_ONLY'
          ? 'NOT_REQUIRED'
          : 'VERIFIED'
      }
      return applyDelivery(
        mapped,
        deliveryBySourceId.get(question.source_question_id),
        manifestById,
        setupBySourceId
      )
    })
}

export function verifyJobSkillPhase4Contracts({ root }) {
  const built = buildJobSkillPhase4Contracts({ root })
  for (const [key, relativePath] of [['authority', REL.runtimeAuthority], ['gate', REL.activationGate]]) {
    const expected = `${JSON.stringify(built[key], null, 2)}\n`
    const actual = readFileSync(resolve(root, relativePath), 'utf8')
    assert(actual === expected, `${relativePath} is stale; run the phase 4 build command`)
  }
  const expectedLedger = buildJobSkillPhase4Ledger(built)
  const actualLedger = readFileSync(resolve(root, REL.activationLedger), 'utf8')
  assert(actualLedger === expectedLedger, `${REL.activationLedger} is stale; run the phase 4 build command`)
  return built
}

export function buildJobSkillPhase4Ledger({ authority, gate }) {
  const blockerLines = gate.blockers.length === 0
    ? '- 无。'
    : gate.blockers.map((item) => `- ${item.code}：${item.message}（${item.count}）`).join('\n')
  return `# 岗位题库阶段四统一激活门禁接线台账 v1

- 生成时间：${gate.generated_at}
- 机器权威：\`${REL.activationGate}\`
- 当前状态：\`${gate.status}\`

## 普通结论

145 道定点复审题与11道淘汰原题的替代题均已通过对应人工审核，阶段四已完成合同接线。298 道来源题均已编译为当前版本 DRAFT；替代题只获得DRAFT编译资格，未获得激活权限。当前仍不能激活题目或创建岗位测评，因为 Pilot 独立门禁尚未通过，且 270 项资产仍未完成批准和文件校验。

## 集合核对

- 来源题：${authority.summary.source_total}
- 当前保留 DRAFT：${authority.summary.retained_total}
- 淘汰原题替代题审核通过：${authority.summary.rejected_replacement_review_passed_total}
- V6 定点复审通过：${authority.summary.targeted_rereview_passed_total}
- 无语义变化保留 V2：${authority.summary.preserved_without_semantic_change_total}
- Pilot 独立门禁待完成：${authority.summary.pilot_pending_total}

## 资产与运行权限

- 资产总数：${gate.asset_gate.total}
- 已批准：${gate.asset_gate.approved}
- 未完成：${gate.asset_gate.unresolved}
- 可编译 DRAFT seed：${gate.authority.may_compile_draft_seed}
- 可生成激活 SQL：${gate.authority.may_generate_activation_sql}
- 可激活：${gate.authority.may_activate}
- 可创建 session：${gate.authority.may_create_session}
- 本轮运行数据库保持不变：${gate.authority.runtime_database_unchanged}

## 当前阻断项

${blockerLines}

> 本 Markdown 仅由机器门禁 JSON 确定性生成，用于阅读和留档；JSON 是权威。
`
}

export const jobSkillPhase4Paths = REL
